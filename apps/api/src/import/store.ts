import {
  PARSE_STALE_SECONDS,
  RETRYABLE_IMPORT_ERRORS,
  type ImportDraft,
  type ImportError,
} from '@recipe-app/domain';
import type { TokenClaims } from '../auth/verify';
import type { AsClaims } from '../db/asUser';
import { AI_RESERVE_MICROUSD, monthSpentMicroUsd, reserveSpend, settleSpend } from '../llm/usage';
import { json } from '../db/json';

export type ClaimedImport = {
  id: string;
  household_id: string;
  source_type: 'text' | 'url' | 'photo';
  source_text: string | null;
  source_url: string | null;
  /** parse_started_at as text: the final write lands only if no one reclaimed the row. */
  claim: string;
  /** Page photo ids in order, for a photo import; [] otherwise. */
  pages: string[];
};
export type ClaimOutcome =
  | { kind: 'claimed'; row: ClaimedImport }
  | { kind: 'busy'; status: string }
  | { kind: 'missing' }
  | { kind: 'photos_pending' }
  | { kind: 'forbidden' };
export type ParseResult =
  { status: 'ready'; draft: ImportDraft } | { status: 'failed'; error: ImportError };

export type ImportStore = {
  claim(claims: TokenClaims, id: string): Promise<ClaimOutcome>;
  context(claims: TokenClaims): Promise<{ spentMicroUsd: number; tags: string[] }>;
  /** A reservation against the monthly cap, under the household's lock (spec §3). */
  reserve(claims: TokenClaims, capMicroUsd: number): Promise<boolean>;
  /** Settles the spend (in its own transaction) against what was reserved, then writes the row. */
  finish(
    claims: TokenClaims,
    row: ClaimedImport,
    result: ParseResult,
    spentMicroUsd: number,
    reservedMicroUsd: number,
  ): Promise<void>;
  spent(claims: TokenClaims): Promise<number>;
};

export const STALE_PARSE_SECONDS = PARSE_STALE_SECONDS;
const TAGS_IN_PROMPT = 200;

/** Every statement here runs as the user, under RLS (rule 1). */
export function createImportStore(asClaims: AsClaims): ImportStore {
  return {
    claim: (claims, id) =>
      asClaims(claims, async (tx): Promise<ClaimOutcome> => {
        // A photo import is read only once every live page has its file
        // (spec §4); until then the phone tries again later.
        const [shape] = await tx<{ source_type: string; pages: number; uploaded: number }[]>`
          select i.source_type, count(p.id)::int as pages, count(p.uploaded_at)::int as uploaded
          from public.imports i
          left join public.photos p
            on p.import_id = i.id and p.kind = 'page' and p.deleted_at is null
          where i.id = ${id} and i.deleted_at is null
          group by i.source_type`;
        if (!shape) return { kind: 'missing' };
        if (shape.source_type === 'photo' && (shape.pages === 0 || shape.uploaded < shape.pages)) {
          return { kind: 'photos_pending' };
        }
        const claimed = await tx<Omit<ClaimedImport, 'pages'>[]>`
          update public.imports
          set status = 'parsing', parse_started_at = now(), error = null
          where id = ${id} and deleted_at is null
            and (status = 'pending'
              or (status = 'failed' and error in ${tx(RETRYABLE_IMPORT_ERRORS as string[])})
              or (status = 'parsing'
                and parse_started_at < now() - make_interval(secs => ${STALE_PARSE_SECONDS})))
          returning id, household_id, source_type, source_text, source_url,
                    parse_started_at::text as claim`;
        const row = claimed[0];
        if (!row) {
          const seen = await tx<{ status: string }[]>`
            select status from public.imports where id = ${id} and deleted_at is null`;
          return seen[0] ? { kind: 'busy', status: seen[0].status } : { kind: 'missing' };
        }
        const pages =
          row.source_type === 'photo'
            ? await tx<{ id: string }[]>`
                select id from public.photos
                where import_id = ${id} and kind = 'page' and deleted_at is null
                order by position`
            : [];
        return { kind: 'claimed', row: { ...row, pages: pages.map((page) => page.id) } };
      }),

    context: (claims) =>
      asClaims(claims, async (tx) => {
        const spentMicroUsd = await monthSpentMicroUsd(tx);
        const tags = await tx<{ tag: string }[]>`
          select tag from public.recipes r, unnest(r.tags) as tag
          where r.deleted_at is null
          group by tag order by count(*) desc, tag limit ${TAGS_IN_PROMPT}`;
        return { spentMicroUsd, tags: tags.map((row) => row.tag) };
      }),

    reserve: (claims, capMicroUsd) =>
      asClaims(claims, (tx) => reserveSpend(tx, capMicroUsd, AI_RESERVE_MICROUSD)),

    finish: async (claims, row, result, spentMicroUsd, reservedMicroUsd) => {
      // Spend first, in its own transaction: a failed row write never loses it.
      await asClaims(claims, (tx) => settleSpend(tx, spentMicroUsd - reservedMicroUsd));
      await asClaims(claims, async (tx) => {
        // Lands only on this claim: a reclaimed row belongs to the newer parse.
        // A dismissed row keeps its deleted_at.
        await tx`
          update public.imports
          set status = ${result.status},
              draft = ${result.status === 'ready' ? json(tx, result.draft) : null},
              error = ${result.status === 'failed' ? result.error : null}
          where id = ${row.id} and status = 'parsing' and parse_started_at::text = ${row.claim}`;
      });
    },

    spent: (claims) => asClaims(claims, (tx) => monthSpentMicroUsd(tx)),
  };
}
