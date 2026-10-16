import { recipePatchSchema, recipeSchema } from '@recipe-app/domain';
import { z } from 'zod';
import type { UserTx } from '../db/asUser';

export const MAX_OPS = 500;
const ALLOWED_TABLES = new Set(['recipes']);

const opSchema = z.strictObject({
  op: z.enum(['put', 'patch', 'delete']),
  table: z.string(),
  id: z.guid(),
  data: z.record(z.string(), z.unknown()).optional(),
});
const bodySchema = z.strictObject({ ops: z.array(opSchema).max(MAX_OPS) });

export type Op = z.infer<typeof opSchema>;
export type Result =
  { id: string; status: 'applied' } | { id: string; status: 'rejected'; reason: string };

const applied = (op: Op): Result => ({ id: op.id, status: 'applied' });
const rejected = (op: Op, reason: string): Result => ({ id: op.id, status: 'rejected', reason });

/** Returns the ops, or null when the body is not the documented shape. */
export function parseBody(payload: unknown): Op[] | null {
  const parsed = bodySchema.safeParse(payload);
  return parsed.success ? parsed.data.ops : null;
}

/**
 * Errors the database raises because of what the caller sent: RLS refusal or
 * missing grant (42501), constraint violations (23xxx), bad data (22xxx).
 * Retrying cannot fix these, so they become "rejected". Anything else is
 * unexpected and fails the whole request so the client retries.
 */
function isRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === 'string' && (code === '42501' || code.startsWith('23') || code.startsWith('22'))
  );
}

async function applyOne(tx: UserTx, op: Op): Promise<Result> {
  if (!ALLOWED_TABLES.has(op.table)) return rejected(op, 'table_not_allowed');
  if (op.op === 'delete') return rejected(op, 'delete_not_allowed');

  const candidate = { ...(op.data ?? {}), id: op.id };

  if (op.op === 'put') {
    const parsed = recipeSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, household_id, title } = parsed.data;
    const deleted_at = parsed.data.deleted_at ?? null;
    // An existing row the caller may not update (another household's, or any
    // row for a viewer) makes the DO UPDATE branch raise 42501.
    await tx`
      insert into public.recipes (id, household_id, title, deleted_at)
      values (${id}, ${household_id}, ${title}, ${deleted_at})
      on conflict (id) do update
        set household_id = excluded.household_id,
            title = excluded.title,
            deleted_at = excluded.deleted_at`;
    return applied(op);
  }

  const parsed = recipePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  const rows = await tx`update public.recipes set ${tx(fields)} where id = ${id} returning id`;
  // RLS hides rows the caller may not update, so "no row" covers both cases.
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

/**
 * Applies ops in order inside the caller's transaction. Each op gets its own
 * savepoint, so a refused op is undone alone and its neighbours stand. Every
 * op is idempotent, so a client retry after a failed request is safe.
 */
export async function applyOps(tx: UserTx, ops: Op[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const op of ops) {
    try {
      results.push((await tx.savepoint((savepoint) => applyOne(savepoint, op))) as Result);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      results.push(rejected(op, 'forbidden'));
    }
  }
  return results;
}
