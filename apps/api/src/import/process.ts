import { draftFromJsonLd } from '@recipe-app/domain';
import type { TokenClaims } from '../auth/verify';
import { AiUnavailableError, costMicroUsd, type AiConfig, type Gateway } from '../llm/gateway';
import { buildPhotoRequest } from '../llm/parsePhoto';
import {
  buildParseRequest,
  interpretToolInput,
  RECORD_RECIPE_TOOL,
  type ParseRequest,
} from '../llm/parseRecipe';
import { jpegInfo } from '../photos/jpeg';
import type { PhotoStore } from '../photos/store';
import type { FetchResult } from './fetchPage';
import { extractJsonLd, pageText } from './html';
import type { ClaimedImport, ImportStore, ParseResult } from './store';

export type ProcessDeps = {
  store: ImportStore;
  gateway: Gateway;
  fetchPage: (url: string) => Promise<FetchResult>;
  photos: Pick<PhotoStore, 'read'>;
  ai: Pick<AiConfig, 'capUsd' | 'priceInputPerMTokUsd' | 'priceOutputPerMTokUsd'>;
  log?: (event: Record<string, unknown>) => void;
};

type Meter = { microUsd: number };

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

async function parse(
  deps: ProcessDeps,
  claims: TokenClaims,
  row: ClaimedImport,
  meter: Meter,
): Promise<ParseResult> {
  let request: (tags: string[]) => ParseRequest;
  if (row.source_type === 'photo') {
    const pages = await readPages(deps, row);
    if (!pages) return { status: 'failed', error: 'photo_unreadable' };
    request = (tags) => buildPhotoRequest(pages, tags);
  } else {
    let text = row.source_text ?? '';
    const url = row.source_type === 'url' ? row.source_url : null;
    if (url) {
      const page = await deps.fetchPage(url);
      if (!page.ok) return { status: 'failed', error: page.error };
      const fromJsonLd = draftFromJsonLd(extractJsonLd(page.html));
      if (fromJsonLd) return { status: 'ready', draft: fromJsonLd };
      text = pageText(page.html);
      if (text === '') return { status: 'failed', error: 'not_a_recipe' };
    }
    request = (tags) => buildParseRequest({ text, url }, tags);
  }

  const { spentMicroUsd, tags } = await deps.store.context(claims);
  if (spentMicroUsd >= Math.round(deps.ai.capUsd * 1_000_000)) {
    return { status: 'failed', error: 'quota' };
  }

  let call;
  try {
    call = await deps.gateway.callTool(request(tags), RECORD_RECIPE_TOOL);
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error;
    deps.log?.({ event: 'ai_unavailable', id: row.id, message: error.message });
    return { status: 'failed', error: 'ai_unavailable' };
  }
  meter.microUsd += costMicroUsd(call.usage, deps.ai);
  const outcome = interpretToolInput(call.input);
  return outcome.kind === 'draft'
    ? { status: 'ready', draft: outcome.draft }
    : { status: 'failed', error: outcome.kind };
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
  const meter: Meter = { microUsd: 0 };
  let result: ParseResult;
  try {
    result = await parse(deps, claims, row, meter);
  } catch (error) {
    deps.log?.({ event: 'import_failed', id: row.id, message: String(error) });
    result = { status: 'failed', error: 'ai_unavailable' };
  }
  await deps.store.finish(claims, row, result, meter.microUsd);
}
