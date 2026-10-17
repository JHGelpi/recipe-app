import type { ImportStatus } from '@recipe-app/domain';
import { parseTimestamp } from '../recipes/rows';
import type { ParseRequestOutcome } from './api';

export type KickRow = {
  id: string;
  status: ImportStatus | string;
  parse_started_at: string | null;
};
export type Attempt = { failures: number; nextAt: number };

/** Matches the server's reclaim rule (STALE_PARSE_SECONDS). */
export const STALE_MS = 2 * 60 * 1000;
export const TICK_MS = 5_000;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60 * 1000;

export function backoffMs(failures: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, failures - 1));
}

/** A pending import, or a parse stuck long enough for the server to reclaim it. */
export function needsKick(row: KickRow, now: number): boolean {
  if (row.status === 'pending') return true;
  if (row.status !== 'parsing') return false;
  const started = parseTimestamp(row.parse_started_at);
  return started !== null && now - started > STALE_MS;
}

export function dueKicks(
  rows: KickRow[],
  attempts: Map<string, Attempt>,
  inFlight: Set<string>,
  now: number,
): string[] {
  return rows
    .filter(
      (row) =>
        needsKick(row, now) && !inFlight.has(row.id) && (attempts.get(row.id)?.nextAt ?? 0) <= now,
    )
    .map((row) => row.id);
}

/**
 * After a start (or someone else's), the result arrives by sync; ask again
 * only if it never does. Anything else backs off: 404 usually means the
 * upload has not landed yet.
 */
export function afterKick(
  previous: Attempt | undefined,
  outcome: ParseRequestOutcome,
  now: number,
): Attempt {
  if (outcome === 'started' || outcome === 'busy') return { failures: 0, nextAt: now + STALE_MS };
  const failures = (previous?.failures ?? 0) + 1;
  return { failures, nextAt: now + backoffMs(failures) };
}
