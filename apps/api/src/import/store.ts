import { RETRYABLE_IMPORT_ERRORS, type ImportDraft, type ImportError } from '@recipe-app/domain';
import type { TokenClaims } from '../auth/verify';
import type { AsClaims } from '../db/asUser';

export type ClaimedImport = {
  id: string;
  household_id: string;
  source_type: 'text' | 'url';
  source_text: string | null;
  source_url: string | null;
  /** parse_started_at as text: the final write lands only if no one reclaimed the row. */
  claim: string;
};
export type ClaimOutcome =
  | { kind: 'claimed'; row: ClaimedImport }
  | { kind: 'busy'; status: string }
  | { kind: 'missing' }
  | { kind: 'forbidden' };
export type ParseResult =
  { status: 'ready'; draft: ImportDraft } | { status: 'failed'; error: ImportError };

export type ImportStore = {
  claim(claims: TokenClaims, id: string): Promise<ClaimOutcome>;
  context(claims: TokenClaims): Promise<{ spentMicroUsd: number; tags: string[] }>;
  finish(
    claims: TokenClaims,
    row: ClaimedImport,
    result: ParseResult,
    spentMicroUsd: number,
  ): Promise<void>;
  spent(claims: TokenClaims): Promise<number>;
};

export const STALE_PARSE_SECONDS = 120;
const TAGS_IN_PROMPT = 200;

/** Every statement here runs as the user, under RLS (rule 1). */
export function createImportStore(asClaims: AsClaims): ImportStore {
  return {
    claim: (claims, id) =>
      asClaims(claims, async (tx): Promise<ClaimOutcome> => {
        const claimed = await tx<ClaimedImport[]>`
          update public.imports
          set status = 'parsing', parse_started_at = now(), error = null
          where id = ${id} and deleted_at is null
            and (status = 'pending'
              or (status = 'failed' and error in ${tx(RETRYABLE_IMPORT_ERRORS as string[])})
              or (status = 'parsing'
                and parse_started_at < now() - make_interval(secs => ${STALE_PARSE_SECONDS})))
          returning id, household_id, source_type, source_text, source_url,
                    parse_started_at::text as claim`;
        if (claimed[0]) return { kind: 'claimed', row: claimed[0] };
        const seen = await tx<{ status: string }[]>`
          select status from public.imports where id = ${id} and deleted_at is null`;
        return seen[0] ? { kind: 'busy', status: seen[0].status } : { kind: 'missing' };
      }),

    context: (claims) =>
      asClaims(claims, async (tx) => {
        const [usage] = await tx<{ spent: string }[]>`
          select spent_microusd::text as spent from public.ai_usage
          where household_id = (select public.auth_household_id())
            and month = date_trunc('month', now() at time zone 'utc')::date`;
        const tags = await tx<{ tag: string }[]>`
          select tag from public.recipes r, unnest(r.tags) as tag
          where r.deleted_at is null
          group by tag order by count(*) desc, tag limit ${TAGS_IN_PROMPT}`;
        return { spentMicroUsd: Number(usage?.spent ?? 0), tags: tags.map((row) => row.tag) };
      }),

    finish: (claims, row, result, spentMicroUsd) =>
      asClaims(claims, async (tx) => {
        if (spentMicroUsd > 0) {
          await tx`
            insert into public.ai_usage (household_id, month, spent_microusd)
            values ((select public.auth_household_id()),
                    date_trunc('month', now() at time zone 'utc')::date, ${spentMicroUsd})
            on conflict (household_id, month)
            do update set spent_microusd = public.ai_usage.spent_microusd + excluded.spent_microusd`;
        }
        // Lands only on this claim: a reclaimed row belongs to the newer parse.
        // A dismissed row keeps its deleted_at.
        await tx`
          update public.imports
          set status = ${result.status},
              draft = ${result.status === 'ready' ? tx.json(result.draft as never) : null},
              error = ${result.status === 'failed' ? result.error : null}
          where id = ${row.id} and status = 'parsing' and parse_started_at::text = ${row.claim}`;
      }),

    spent: (claims) =>
      asClaims(claims, async (tx) => {
        const [usage] = await tx<{ spent: string }[]>`
          select spent_microusd::text as spent from public.ai_usage
          where household_id = (select public.auth_household_id())
            and month = date_trunc('month', now() at time zone 'utc')::date`;
        return Number(usage?.spent ?? 0);
      }),
  };
}
