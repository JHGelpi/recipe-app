export type Tab = 'recipes' | 'favorites' | 'list' | 'household';

// Pages that fill the screen or are seen signed out (UI spec §4).
const HIDDEN = [
  /^\/sign-in$/,
  /^\/invite\//,
  /^\/s\//,
  /^\/photo\//,
  /^\/recipe\/[^/]+\/cook$/,
  /^\/diary\/[^/]+\/photos$/,
  /^\/welcome\//,
];

export function showTabBar(path: string, signedIn: boolean): boolean {
  return signedIn && !HIDDEN.some((pattern) => pattern.test(path));
}

export function activeTab(path: string): Tab | null {
  if (path === '/') return 'recipes';
  if (path === '/favorites') return 'favorites';
  if (path === '/list') return 'list';
  if (path === '/household' || path === '/trash' || path.startsWith('/diary')) return 'household';
  return null;
}

/** FR-31: the List tab's name says how much is left to buy. */
export function listLabel(toBuy: number): string {
  return toBuy > 0 ? `Shopping list, ${toBuy} to buy` : 'Shopping list';
}

export function addLabel(ready: number): string {
  if (ready <= 0) return 'Add a recipe';
  return `Add a recipe, ${ready} ${ready === 1 ? 'import' : 'imports'} ready`;
}

export function importLabel(ready: number): string {
  return ready > 0 ? `Import, ${ready} ready` : 'Import';
}
