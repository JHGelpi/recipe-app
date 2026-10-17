import { z } from 'zod';
import { isHttpUrl, SOURCE_LIMITS } from './imports';
import type { Ingredient } from './ingredients';
import { RECIPE_LIMITS } from './limits';
import type { Step } from './steps';
import { ingredientSchema, recipeTitleSchema, stepSchema, tagSchema } from './index';

/** FR-27, NFR-2: what a link shows; nothing else of the household. */
export const shareSnapshotSchema = z.strictObject({
  title: recipeTitleSchema,
  servings: z.number().int().min(1).max(999).nullable(),
  prep_minutes: z.number().int().min(0).max(10000).nullable(),
  cook_minutes: z.number().int().min(0).max(10000).nullable(),
  ingredients: z.array(ingredientSchema).max(RECIPE_LIMITS.ingredients),
  steps: z.array(stepSchema).max(RECIPE_LIMITS.steps),
  tags: z.array(tagSchema).max(RECIPE_LIMITS.tags),
  notes: z.string().max(RECIPE_LIMITS.notes),
  source_url: z.string().max(SOURCE_LIMITS.url).refine(isHttpUrl).nullable(),
  source_author: z.string().max(SOURCE_LIMITS.author).nullable(),
  household_name: z.string().min(1).max(200),
  shared_at: z.iso.datetime({ offset: true }),
  photo: z
    .strictObject({
      bytes: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .nullable(),
});
export type ShareSnapshot = z.infer<typeof shareSnapshotSchema>;

export type ShareableRecipe = {
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  notes: string;
  source_url: string | null;
  source_author: string | null;
};

export const SHARE_ERRORS = ['forbidden', 'share_unavailable', 'own_household'] as const;
export type ShareError = (typeof SHARE_ERRORS)[number];

export function buildShareSnapshot(
  recipe: ShareableRecipe,
  householdName: string,
  photo: { bytes: number; width: number; height: number } | null,
  now: Date,
): ShareSnapshot {
  return {
    title: recipe.title,
    servings: recipe.servings,
    prep_minutes: recipe.prep_minutes,
    cook_minutes: recipe.cook_minutes,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    tags: recipe.tags,
    notes: recipe.notes,
    source_url: recipe.source_url,
    source_author: recipe.source_author,
    household_name: householdName,
    shared_at: now.toISOString(),
    photo,
  };
}

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** The "Serves 9 · Prep 15 min · Cook 30 min" line, or '' when there is nothing to say. */
export function timesLine(
  recipe: Pick<ShareableRecipe, 'servings' | 'prep_minutes' | 'cook_minutes'>,
): string {
  return [
    recipe.servings !== null ? `Serves ${recipe.servings}` : null,
    recipe.prep_minutes !== null ? `Prep ${recipe.prep_minutes} min` : null,
    recipe.cook_minutes !== null ? `Cook ${recipe.cook_minutes} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "From example.com · by Jane Doe", "By Jane Doe", or ''. */
export function sourceLine(recipe: Pick<ShareableRecipe, 'source_url' | 'source_author'>): string {
  const site = host(recipe.source_url);
  if (site)
    return recipe.source_author ? `From ${site} · by ${recipe.source_author}` : `From ${site}`;
  return recipe.source_author ? `By ${recipe.source_author}` : '';
}

/** FR-26: the recipe as plain text, as written. */
export function shareText(recipe: Omit<ShareableRecipe, 'tags'>): string {
  const sections: string[][] = [[recipe.title, timesLine(recipe)].filter(Boolean)];
  if (recipe.ingredients.length > 0) {
    const lines = ['Ingredients'];
    for (const ingredient of recipe.ingredients) {
      if (ingredient.heading) lines.push('', ingredient.raw);
      else lines.push(`• ${ingredient.raw}`);
    }
    sections.push(lines);
  }
  if (recipe.steps.length > 0) {
    sections.push(['Steps', ...recipe.steps.map((step, index) => `${index + 1}. ${step.text}`)]);
  }
  if (recipe.notes.trim()) sections.push(['Notes', recipe.notes.trim()]);
  const source = sourceLine(recipe);
  if (source) sections.push([source]);
  return sections.map((lines) => lines.join('\n')).join('\n\n');
}

// The PDF's built-in font (WinAnsi) has ½ ¼ ¾ ° • – · but not these.
const PDF_FALLBACKS: [RegExp, string][] = [
  [/(\d)([⅓⅔⅛⅜⅝⅞])/g, '$1 $2'],
  [/⅓/g, '1/3'],
  [/⅔/g, '2/3'],
  [/⅛/g, '1/8'],
  [/⅜/g, '3/8'],
  [/⅝/g, '5/8'],
  [/⅞/g, '7/8'],
  [/≈/g, '~'],
  [/→/g, '->'],
];

/** Text the PDF's built-in font can show (Review Focus 3). */
export function pdfSafeText(text: string): string {
  return PDF_FALLBACKS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}
