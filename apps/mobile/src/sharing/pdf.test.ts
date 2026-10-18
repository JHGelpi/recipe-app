import { describe, expect, it } from 'vitest';
import { buildRecipePdf, pdfFileName } from './pdf';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ingredient = (n: number, raw: string) => ({
  id: id(n),
  raw,
  quantity: null,
  quantity_max: null,
  unit: null,
  item: raw,
  note: null,
  heading: false,
});
const recipe = {
  title: 'Lemon Bars',
  servings: 9,
  prep_minutes: 15,
  cook_minutes: 30,
  ingredients: [ingredient(1, '2 cups flour'), ingredient(2, '⅓ cup lemon juice')],
  steps: [{ id: id(10), text: 'Bake 30 minutes at 350°F.' }],
  notes: 'Chill first.',
  source_url: 'https://example.com/bars',
  source_author: 'Jane Doe',
};

describe('the recipe PDF (FR-26)', () => {
  it('has the title, the times, the ingredients with safe fractions, steps, notes, source and footer', () => {
    const text = buildRecipePdf(recipe, null).output();
    for (const expected of [
      'Lemon Bars',
      'Serves 9',
      'Ingredients',
      '2 cups flour',
      '1/3 cup lemon juice',
      '1. Bake 30 minutes',
      'Chill first.',
      'From example.com',
      'Shared from Dishkept',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('flows a long recipe onto more pages (Review Focus 1)', () => {
    const long = {
      ...recipe,
      ingredients: Array.from({ length: 30 }, (_, n) =>
        ingredient(n + 1, `${n + 1} tbsp ingredient number ${n + 1}`),
      ),
      steps: Array.from({ length: 15 }, (_, n) => ({
        id: id(100 + n),
        text: 'Stir slowly and carefully for a long while. '.repeat(8),
      })),
    };
    expect(buildRecipePdf(long, null).getNumberOfPages()).toBeGreaterThanOrEqual(2);
  });

  it('keeps every word of a long ingredient line among many (Final 2)', () => {
    const many = {
      ...recipe,
      ingredients: [
        ...Array.from({ length: 29 }, (_, n) => ingredient(n + 1, `${n + 1} tbsp spice`)),
        ingredient(30, '2 cups all-purpose flour, sifted twice and spooned into the cup gently'),
      ],
    };
    const text = buildRecipePdf(many, null).output();
    expect(text).toContain('gently');
  });

  it('names the file after the title, without characters files cannot have (Review Focus 2)', () => {
    expect(pdfFileName('Lemon Bars')).toBe('Lemon Bars.pdf');
    expect(pdfFileName("Mom's 1/2-batch: Pie?")).toBe("Mom's 1-2-batch - Pie.pdf");
    expect(pdfFileName('   ')).toBe('Recipe.pdf');
  });
});
