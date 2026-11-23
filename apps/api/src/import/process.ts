import {
  draftFromJsonLd,
  isHttpUrl,
  recipeImage,
  draftImageSchema,
  type DraftImage,
  type ImportDraft,
} from '@recipe-app/domain';
import type { TokenClaims } from '../auth/verify';
import { AiUnavailableError, costMicroUsd, type AiConfig, type Gateway } from '../llm/gateway';
import { buildPhotoRequest } from '../llm/parsePhoto';
import {
  buildParseRequest,
  interpretToolInput,
  RECORD_PHOTO_RECIPE_TOOL,
  RECORD_RECIPE_TOOL,
  type ParseRequest,
} from '../llm/parseRecipe';
import { AI_RESERVE_MICROUSD, spendCaps } from '../llm/usage';
import { jpegInfo } from '../photos/jpeg';
import type { PhotoStore } from '../photos/store';
import type { FetchResult } from './fetchPage';
import { extractJsonLd, metaImage, pageText } from './html';
import type { ClaimedImport, ImportStore, ParseResult } from './store';

export type ProcessDeps = {
  store: ImportStore;
  gateway: Gateway;
  fetchPage: (url: string) => Promise<FetchResult>;
  photos: Pick<PhotoStore, 'read'>;
  ai: Pick<AiConfig, 'capUsd' | 'globalCapUsd' | 'priceInputPerMTokUsd' | 'priceOutputPerMTokUsd'>;
  log?: (event: Record<string, unknown>) => void;
};

type Meter = { microUsd: number; reserved: number };

/** The pages' bytes in order, or null when one is missing or not a JPEG. */
async function readPages(deps: ProcessDeps, row: ClaimedImport): Promise<Uint8Array[] | null> {
  if (row.pages.length === 0) return null;
  const pages: Uint8Array[] = [];
  for (const id of row.pages) {
    const bytes = await deps.photos.read(row.household_id, id);
    if (!bytes || !jpegInfo(bytes)) return null;
    pages.push(bytes);
  }
  return pages;
}

/** A page's image link made absolute, or null unless it is http(s). */
function absoluteImage(raw: string | null, base: string): DraftImage | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, base).toString();
    return isHttpUrl(url) && url.length <= 2000 ? { url } : null;
  } catch {
    return null;
  }
}

/** The model's box (#116) in draft form, kept only on one of this import's pages. */
function photoImage(input: unknown, pages: number): DraftImage | null {
  const image = (input as { image?: unknown } | null)?.image;
  if (typeof image !== 'object' || image === null) return null;
  const { page, x0, y0, x1, y1 } = image as Record<string, unknown>;
  if (typeof page !== 'number' || page > pages) return null;
  return { page, box: [x0, y0, x1, y1] as [number, number, number, number] };
}

async function parse(
  deps: ProcessDeps,
  claims: TokenClaims,
  row: ClaimedImport,
  meter: Meter,
): Promise<ParseResult> {
  let request: (tags: string[]) => ParseRequest;
  // Where the dish picture comes from (#116): the page for a link, the model for photos.
  let image: (toolInput: unknown) => DraftImage | null = () => null;
  if (row.source_type === 'photo') {
    const pages = await readPages(deps, row);
    if (!pages) return { status: 'failed', error: 'photo_unreadable' };
    request = (tags) => buildPhotoRequest(pages, tags);
    image = (toolInput) => photoImage(toolInput, pages.length);
  } else {
    let text = row.source_text ?? '';
    const url = row.source_type === 'url' ? row.source_url : null;
    if (url) {
      const page = await deps.fetchPage(url);
      if (!page.ok) return { status: 'failed', error: page.error };
      const blocks = extractJsonLd(page.html);
      const found = absoluteImage(recipeImage(blocks) ?? metaImage(page.html), page.url);
      image = () => found;
      const fromJsonLd = draftFromJsonLd(blocks);
      if (fromJsonLd) return { status: 'ready', draft: withImage(fromJsonLd, found) };
      text = pageText(page.html);
      if (text === '') return { status: 'failed', error: 'not_a_recipe' };
    }
    request = (tags) => buildParseRequest({ text, url }, tags);
  }

  const { tags } = await deps.store.context(claims);
  // A reservation under the spend locks, so parallel calls can't pass a cap.
  if (!(await deps.store.reserve(claims, spendCaps(deps.ai)))) {
    return { status: 'failed', error: 'quota' };
  }
  meter.reserved = AI_RESERVE_MICROUSD;

  let call;
  try {
    const tool = row.source_type === 'photo' ? RECORD_PHOTO_RECIPE_TOOL : RECORD_RECIPE_TOOL;
    call = await deps.gateway.callTool(request(tags), tool);
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    deps.log?.({ event: 'ai_unavailable', id: row.id, message: error.message });
    return { status: 'failed', error: 'ai_unavailable' };
  }
  meter.microUsd += costMicroUsd(call.usage, deps.ai);
  const outcome = interpretToolInput(call.input);
  return outcome.kind === 'draft'
    ? { status: 'ready', draft: withImage(outcome.draft, image(call.input)) }
    : { status: 'failed', error: outcome.kind };
}

/** The draft with this image, validated again (rule 7), or with none. */
function withImage(draft: ImportDraft, image: DraftImage | null): ImportDraft {
  const rest = { ...draft };
  delete rest.image;
  const valid = draftImageSchema.safeParse(image);
  return valid.success ? { ...rest, image: valid.data } : rest;
}

/**
 * Reads one claimed import and writes its result (spec §4). Never throws for
 * a parse problem: every failure becomes an error code on the row. Only the
 * final write can throw, and the 5-minute reclaim recovers that.
 */
export async function processImport(
  deps: ProcessDeps,
  claims: TokenClaims,
  row: ClaimedImport,
): Promise<void> {
  const meter: Meter = { microUsd: 0, reserved: 0 };
  let result: ParseResult;
  try {
    result = await parse(deps, claims, row, meter);
  } catch (error) {
    deps.log?.({ event: 'import_failed', id: row.id, message: String(error) });
    result = { status: 'failed', error: 'ai_unavailable' };
  }
  await deps.store.finish(claims, row, result, meter.microUsd, meter.reserved);
}
