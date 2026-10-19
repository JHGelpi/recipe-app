import type { UserTx } from './asUser';

type JsonValue = Parameters<UserTx['json']>[0];

/**
 * A value for a jsonb column. Drafts, answers and snapshots are typed objects
 * whose shape postgres.js cannot see as its JSONValue; they are JSON by
 * construction (zod-checked), so the cast is safe.
 */
export function json(tx: UserTx, value: unknown) {
  return tx.json(value as JsonValue);
}
