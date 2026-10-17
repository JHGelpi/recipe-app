import type { ListRow } from './rows';

export type ListItem = {
  id: string;
  title: string;
  tags: string[];
  starred: boolean;
  photoId: string | null;
};

/**
 * Search results as list items. Stars come from the user's favorites set, so
 * starring a recipe recomputes only this, never the search index.
 */
export function toListItems(
  ids: string[],
  rows: Map<string, ListRow>,
  starred: Set<string>,
  favoritesOnly: boolean,
): ListItem[] {
  return ids.flatMap((id) => {
    const row = rows.get(id);
    if (!row || (favoritesOnly && !starred.has(id))) return [];
    return [
      { id, title: row.title, tags: row.tags, starred: starred.has(id), photoId: row.photoId },
    ];
  });
}

/** The distinct tags of the current tab's recipes, alphabetically. */
export function tagsForTab(
  rows: Map<string, ListRow>,
  starred: Set<string>,
  favoritesOnly: boolean,
): string[] {
  const tags = new Set<string>();
  for (const row of rows.values()) {
    if (favoritesOnly && !starred.has(row.id)) continue;
    for (const tag of row.tags) tags.add(tag);
  }
  return [...tags].sort();
}
