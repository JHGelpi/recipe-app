// apps/mobile/src/recipes/listRows.ts
import { listRowFrom, type ListRow } from './rows';

const COLUMNS = [
  'title',
  'tags',
  'ingredients',
  'photo_id',
  'prep_minutes',
  'cook_minutes',
  'created_at',
];

/**
 * List rows by id, reading only rows whose columns changed since the last
 * call (NFR-6): a change to one recipe no longer re-parses every row's tags.
 */
export function listRowsFrom(
  rows: Record<string, unknown>[],
  cache: Map<string, { stamp: string; row: ListRow }>,
): Map<string, ListRow> {
  const out = new Map<string, ListRow>();
  for (const raw of rows) {
    const id = String(raw.id);
    const stamp = COLUMNS.map((column) => String(raw[column] ?? '')).join('\u0000');
    const hit = cache.get(id);
    const row = hit && hit.stamp === stamp ? hit.row : listRowFrom(raw);
    if (row !== hit?.row) cache.set(id, { stamp, row });
    out.set(id, row);
  }
  for (const id of cache.keys()) if (!out.has(id)) cache.delete(id);
  return out;
}
