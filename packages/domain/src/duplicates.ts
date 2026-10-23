/**
 * FR-14: warns before the household gets a second copy of a recipe. Exact
 * matches only: the same name, the same source link, or the same ingredients.
 * Nothing here blocks or merges; the screens only ask.
 */

/** Why two recipes match, strongest first. */
export type DuplicateReason = 'link' | 'ingredients' | 'title';
const REASON_ORDER: readonly DuplicateReason[] = ['link', 'ingredients', 'title'];

/** The parts of an ingredient line that matching reads; notes and raw text are ignored. */
export type MatchIngredient = {
  item: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
  heading: boolean;
};

/** What is being added or saved. */
export type DuplicateCandidate = {
  title: string;
  source_url?: string | null;
  ingredients?: readonly MatchIngredient[];
};

/** One of the household's recipes, from the local database; Trash too. */
export type ExistingRecipe = DuplicateCandidate & { id: string; trashed: boolean };

export type DuplicateMatch = {
  id: string;
  title: string;
  reason: DuplicateReason;
  trashed: boolean;
};

/** Lists shorter than this match only on name or link. */
export const MIN_MATCH_INGREDIENTS = 4;

const TRACKING = /^(utm_.*|fbclid|gclid)$/i;

/** "Mom's  Chili!" and "moms chili" are the same name; null when nothing is left. */
export function titleKey(title: string): string | null {
  const key = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return key === '' ? null : key;
}

/**
 * The same page whatever the scheme, `www.`, fragment, trailing slash or
 * tracking parameters; null for no link or one that can't be read.
 */
export function sourceUrlKey(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const port = parsed.port ? `:${parsed.port}` : '';
  const path = parsed.pathname.replace(/\/+$/, '');
  for (const name of [...parsed.searchParams.keys()]) {
    if (TRACKING.test(name)) parsed.searchParams.delete(name);
  }
  const query = parsed.searchParams.toString();
  return `${host}${port}${path}${query ? `?${query}` : ''}`;
}

/**
 * The ingredient lines as one comparable key, in any order; null for lists
 * under four lines (headings don't count). A repeated item counts each time.
 */
export function ingredientsKey(ingredients: readonly MatchIngredient[] | undefined): string | null {
  const lines = (ingredients ?? [])
    .filter((line) => !line.heading)
    .map((line) =>
      JSON.stringify([
        line.item.toLowerCase().replace(/\s+/g, ' ').trim(),
        line.quantity,
        line.quantity_max,
        line.unit,
      ]),
    );
  if (lines.length < MIN_MATCH_INGREDIENTS) return null;
  return lines.sort().join('\n');
}

export type DuplicateOptions = {
  /** The recipe being edited: it never matches itself. */
  selfId?: string | null;
  /** Only these reasons; an edit checks only what it changed. */
  only?: readonly DuplicateReason[];
};

/** The household's recipes that match, link matches first, then ingredients, then name. */
export function findDuplicates(
  candidate: DuplicateCandidate,
  recipes: readonly ExistingRecipe[],
  options: DuplicateOptions = {},
): DuplicateMatch[] {
  const wanted = new Set(options.only ?? REASON_ORDER);
  const keys: Record<DuplicateReason, string | null> = {
    link: wanted.has('link') ? sourceUrlKey(candidate.source_url) : null,
    ingredients: wanted.has('ingredients') ? ingredientsKey(candidate.ingredients) : null,
    title: wanted.has('title') ? titleKey(candidate.title) : null,
  };
  const keyOf: Record<DuplicateReason, (recipe: ExistingRecipe) => string | null> = {
    link: (recipe) => sourceUrlKey(recipe.source_url),
    ingredients: (recipe) => ingredientsKey(recipe.ingredients),
    title: (recipe) => titleKey(recipe.title),
  };
  const matches: DuplicateMatch[] = [];
  for (const recipe of recipes) {
    if (recipe.id === options.selfId) continue;
    const reason = REASON_ORDER.find(
      (reason) => keys[reason] !== null && keyOf[reason](recipe) === keys[reason],
    );
    if (reason) {
      matches.push({ id: recipe.id, title: recipe.title, reason, trashed: recipe.trashed });
    }
  }
  return matches.sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason));
}

const WHY: Record<DuplicateReason, string> = {
  link: 'same link',
  ingredients: 'same ingredients',
  title: 'same name',
};

function others(matches: readonly DuplicateMatch[]): string {
  const more = matches.length - 1;
  if (more <= 0) return '';
  return ` and ${more} ${more === 1 ? 'other' : 'others'}`;
}

/** "You already have “Lemon Bars” in the Trash (same ingredients) and 2 others." */
export function duplicateMessage(matches: readonly DuplicateMatch[]): string | null {
  const first = matches[0];
  if (!first) return null;
  const where = first.trashed ? ' in the Trash' : '';
  return `You already have “${first.title}”${where} (${WHY[first.reason]})${others(matches)}.`;
}

const ALREADY: Record<DuplicateReason, string> = {
  link: 'already has this link',
  ingredients: 'already has these ingredients',
  title: 'already has this name',
};

/** For an edit: "“Banana Bread” already has this name. Save anyway?" */
export function editDuplicateMessage(matches: readonly DuplicateMatch[]): string | null {
  const first = matches[0];
  if (!first) return null;
  const where = first.trashed ? ' (in the Trash)' : '';
  return `“${first.title}”${where} ${ALREADY[first.reason]}${others(matches)}. Save anyway?`;
}

/** What an edit changed, so a recipe that already matched doesn't warn on every save. */
export function changedReasons(
  before: DuplicateCandidate,
  after: DuplicateCandidate,
): DuplicateReason[] {
  const changed: DuplicateReason[] = [];
  if (sourceUrlKey(before.source_url) !== sourceUrlKey(after.source_url)) changed.push('link');
  if (ingredientsKey(before.ingredients) !== ingredientsKey(after.ingredients)) {
    changed.push('ingredients');
  }
  if (titleKey(before.title) !== titleKey(after.title)) changed.push('title');
  return changed;
}
