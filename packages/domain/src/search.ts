/** What search needs from a recipe. */
export type SearchSource = { id: string; title: string; ingredients: string[]; tags: string[] };

export type SearchEntry = {
  id: string;
  sortKey: string;
  text: { title: string; ingredients: string; tags: string };
  tags: string[];
};

type Field = keyof SearchEntry['text'];
const WEIGHT: Record<Field, number> = { title: 3, tags: 2, ingredients: 1 };
const FIELDS: Field[] = ['title', 'tags', 'ingredients'];

/** Lowercase, accents removed, whitespace collapsed: applied to recipes and queries alike. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One entry per recipe. Ingredient lines and tags are joined with a newline,
 * so a word never matches across two of them. Rebuilt only when recipes change.
 */
export function buildSearchIndex(recipes: SearchSource[]): SearchEntry[] {
  return recipes.map((recipe) => ({
    id: recipe.id,
    sortKey: recipe.title.toLowerCase(),
    text: {
      title: normalizeSearchText(recipe.title),
      ingredients: recipe.ingredients.map(normalizeSearchText).join('\n'),
      tags: recipe.tags.map(normalizeSearchText).join('\n'),
    },
    tags: recipe.tags,
  }));
}

function wordsOf(query: string): string[] {
  return [
    ...new Set(
      normalizeSearchText(query)
        .split(' ')
        .filter((word) => word !== ''),
    ),
  ];
}

const BOUNDARY = /[\s\p{P}]/u;

function startsWord(text: string, at: number): boolean {
  return at === 0 || BOUNDARY.test(text[at - 1] ?? '');
}

/** The best score this word earns in any field; 0 when it is in none. */
function wordScore(entry: SearchEntry, word: string): number {
  let best = 0;
  for (const field of FIELDS) {
    const text = entry.text[field];
    let at = text.indexOf(word);
    if (at < 0) continue;
    let atStart = false;
    while (at >= 0 && !atStart) {
      atStart = startsWord(text, at);
      at = text.indexOf(word, at + 1);
    }
    best = Math.max(best, WEIGHT[field] + (atStart ? 1 : 0));
  }
  return best;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Ids of the recipes matching every word (as plain-text substrings) and every
 * selected tag (exactly), best first. No words: everything, alphabetically.
 */
export function searchRecipes(
  index: SearchEntry[],
  query: string,
  selectedTags: string[],
): string[] {
  const words = wordsOf(query);
  const matches: { entry: SearchEntry; score: number }[] = [];
  for (const entry of index) {
    if (!selectedTags.every((tag) => entry.tags.includes(tag))) continue;
    let score = 0;
    let matched = true;
    for (const word of words) {
      const points = wordScore(entry, word);
      if (points === 0) {
        matched = false;
        break;
      }
      score += points;
    }
    if (matched) matches.push({ entry, score });
  }
  matches.sort(
    (a, b) =>
      b.score - a.score ||
      compare(a.entry.sortKey, b.entry.sortKey) ||
      compare(a.entry.id, b.entry.id),
  );
  return matches.map((match) => match.entry.id);
}
