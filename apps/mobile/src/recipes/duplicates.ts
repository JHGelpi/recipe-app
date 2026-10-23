import type { AbstractPowerSyncDatabase } from '@powersync/web';
import {
  findDuplicates,
  type DuplicateCandidate,
  type DuplicateMatch,
  type DuplicateOptions,
  type ExistingRecipe,
  type MatchIngredient,
} from '@recipe-app/domain';
import { listOf } from './rows';

type Db = Pick<AbstractPowerSyncDatabase, 'getAll'>;

// FR-14: every recipe on this device, the Trash too. Read only when a check
// runs, so the lists and editors pay nothing for it.
export const DUPLICATE_SOURCES_SQL =
  'select id, title, source_url, ingredients, deleted_at from recipes';

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The lines matching reads; an odd line is skipped rather than failing the check. */
function matchIngredients(value: unknown): MatchIngredient[] {
  return listOf(value).flatMap((line) => {
    if (typeof line !== 'object' || line === null) return [];
    const { item, quantity, quantity_max, unit, heading } = line as Record<string, unknown>;
    if (typeof item !== 'string') return [];
    return [
      {
        item,
        quantity: numberOrNull(quantity),
        quantity_max: numberOrNull(quantity_max),
        unit: typeof unit === 'string' ? unit : null,
        heading: heading === true,
      },
    ];
  });
}

export function existingRecipeFrom(row: Record<string, unknown>): ExistingRecipe {
  return {
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : '',
    source_url: typeof row.source_url === 'string' ? row.source_url : null,
    ingredients: matchIngredients(row.ingredients),
    trashed: row.deleted_at !== null && row.deleted_at !== undefined,
  };
}

/**
 * The household's recipes on this device that match, best first. Offline it
 * works the same; a recipe not synced here yet can't match (FR-30). A check
 * that fails finds nothing: a warning must never stop a save.
 */
export async function findLocalDuplicates(
  db: Db,
  candidate: DuplicateCandidate,
  options: DuplicateOptions = {},
): Promise<DuplicateMatch[]> {
  try {
    const rows = await db.getAll<Record<string, unknown>>(DUPLICATE_SOURCES_SQL);
    return findDuplicates(candidate, rows.map(existingRecipeFrom), options);
  } catch {
    return [];
  }
}
