import { decodeFully, plainText } from './html';
import { toImportDraft, type ImportDraft } from './importDraft';
import { parseIngredientLine } from './ingredients';

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const listOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

function isRecipe(node: Node): boolean {
  const type = node['@type'];
  return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
}

// Where sites nest the Recipe: @graph, a top-level array, mainEntity, item lists.
const NESTING = ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item'];

function findRecipe(value: unknown, depth = 0): Node | null {
  if (depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipe(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isNode(value)) return null;
  if (isRecipe(value)) return value;
  for (const key of NESTING) {
    const found = findRecipe(value[key], depth + 1);
    if (found) return found;
  }
  return null;
}

const DURATION =
  /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i;

/** An ISO 8601 duration in whole minutes. Zero reads as "not given": sites write PT0S for blanks. */
export function isoMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const match = DURATION.exec(text);
  if (!match || /^PT?$/i.test(text)) return null;
  const [days = 0, hours = 0, minutes = 0, seconds = 0] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  const total = Math.round(days * 1440 + hours * 60 + minutes + seconds / 60);
  return total > 0 ? total : null;
}

function instructionSteps(value: unknown, depth = 0): string[] {
  if (depth > 6) return [];
  // Paragraphs, line breaks and new lines each start a step, escaped or not.
  if (typeof value === 'string') {
    return decodeFully(value)
      .split(/\r?\n|<\/p\s*>|<br\s*\/?>/i)
      .map(plainText)
      .filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((item) => instructionSteps(item, depth + 1));
  if (!isNode(value)) return [];
  if (value.itemListElement !== undefined) {
    return instructionSteps(value.itemListElement, depth + 1);
  }
  const text = value.text ?? value.name;
  return typeof text === 'string' ? instructionSteps(text, depth + 1) : [];
}

function yieldServings(value: unknown): number | null {
  for (const item of listOf(value)) {
    if (typeof item === 'number' && Number.isFinite(item)) return Math.round(item);
    if (typeof item === 'string') {
      const match = /\d+/.exec(item);
      if (match) return Number(match[0]);
    }
  }
  return null;
}

function authorName(value: unknown): string | null {
  const first = listOf(value)[0];
  const name = typeof first === 'string' ? first : isNode(first) ? first.name : null;
  return typeof name === 'string' && plainText(name) !== '' ? plainText(name) : null;
}

function tagWords(...values: unknown[]): string[] {
  return values
    .flatMap(listOf)
    .flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
    .map(plainText)
    .filter(Boolean);
}

/**
 * ADR-0005: a schema.org Recipe in the page's JSON-LD becomes a draft with no
 * AI and no cost. Returns null when there is no usable Recipe.
 */
export function draftFromJsonLd(blocks: unknown[]): ImportDraft | null {
  const recipe = findRecipe(blocks);
  if (!recipe) return null;
  const lines = listOf(recipe.recipeIngredient ?? recipe.ingredients)
    .flatMap((line) => (typeof line === 'string' ? [plainText(line)] : []))
    .filter(Boolean);
  return toImportDraft({
    title: typeof recipe.name === 'string' ? plainText(recipe.name) : '',
    servings: yieldServings(recipe.recipeYield),
    prep_minutes: isoMinutes(recipe.prepTime),
    cook_minutes: isoMinutes(recipe.cookTime),
    ingredients: lines.map((line) => parseIngredientLine(line)),
    steps: instructionSteps(recipe.recipeInstructions),
    tags: tagWords(recipe.keywords, recipe.recipeCategory),
    author: authorName(recipe.author),
    low_confidence: [],
  });
}
