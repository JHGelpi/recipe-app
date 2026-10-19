import { describe, expect, it } from 'vitest';
import {
  convertAmount,
  displayIngredient,
  formatAmount,
  scaleFactor,
  scaleIngredient,
  stepScale,
  stepServings,
  stepUnits,
} from './cooking';
import type { Ingredient } from './ingredients';

const line = (over: Partial<Ingredient>): Ingredient => ({
  id: '11111111-1111-4111-8111-111111111111',
  raw: 'x',
  quantity: null,
  quantity_max: null,
  unit: null,
  item: '',
  note: null,
  heading: false,
  ...over,
});
const flour = line({ raw: '2 cups flour', quantity: 2, unit: 'cup', item: 'flour' });
const butter = line({
  raw: '2-3 tbsp butter, softened',
  quantity: 2,
  quantity_max: 3,
  unit: 'tbsp',
  item: 'butter',
  note: 'softened',
});
const show = (
  ingredient: Ingredient,
  factor: number,
  units: 'as_written' | 'us' | 'metric' = 'as_written',
) => displayIngredient(ingredient, { factor, units });

describe('servings and scale', () => {
  it('scales by chosen servings, or by the scale when the recipe has none', () => {
    expect(scaleFactor(4, 6, 1)).toBe(1.5);
    expect(scaleFactor(null, null, 2)).toBe(2);
    expect(scaleFactor(4, null, 1)).toBe(1);
  });

  it('steps servings within 1 to 999, and the scale through its steps', () => {
    expect(stepServings(1, -1)).toBe(1);
    expect(stepServings(999, 1)).toBe(999);
    expect(stepServings(4, 1)).toBe(5);
    expect(stepScale(1, 1)).toBe(1.5);
    expect(stepScale(0.5, -1)).toBe(0.5);
    expect(stepScale(4, 1)).toBe(4);
    expect(stepScale(2.2, -1)).toBe(2);
  });
});

describe('scaleIngredient', () => {
  it('multiplies an amount and a range, and leaves headings and unparsed lines alone', () => {
    expect(scaleIngredient(butter, 1.5)).toMatchObject({ quantity: 3, quantity_max: 4.5 });
    const heading = line({ raw: 'For the sauce:', heading: true });
    expect(scaleIngredient(heading, 2)).toBe(heading);
    const salt = line({ raw: 'salt to taste' });
    expect(scaleIngredient(salt, 2)).toBe(salt);
  });
});

describe('formatAmount', () => {
  it('writes US amounts as kitchen fractions', () => {
    expect(formatAmount(0.6667, 'cup')).toBe('⅔');
    expect(formatAmount(1.5, 'tbsp')).toBe('1½');
    expect(formatAmount(2, 'cup')).toBe('2');
    expect(formatAmount(1.97, 'cup')).toBe('2');
    expect(formatAmount(0.05, 'tsp')).toBe('⅛');
  });

  it('rounds metric to whole units, then to 5s, then one decimal for kg and l', () => {
    expect(formatAmount(14.79, 'ml')).toBe('15');
    expect(formatAmount(473.2, 'ml')).toBe('475');
    expect(formatAmount(1.36, 'kg')).toBe('1.4');
    expect(formatAmount(2.0, 'l')).toBe('2');
  });

  it('rounds counts to the nearest half, marking a changed value', () => {
    expect(formatAmount(1.5, null)).toBe('1½');
    expect(formatAmount(1.6667, null)).toBe('≈1½');
    expect(formatAmount(0.1, 'clove')).toBe('≈½');
  });
});

describe('units', () => {
  it('converts US volume and weight to metric, stepping up past 1,000', () => {
    expect(convertAmount({ value: 2, max: null, unit: 'cup' }, 'metric')).toMatchObject({
      unit: 'ml',
    });
    expect(convertAmount({ value: 3, max: null, unit: 'lb' }, 'metric')).toMatchObject({
      unit: 'kg',
    });
    expect(convertAmount({ value: 1, max: null, unit: 'gallon' }, 'metric')).toMatchObject({
      unit: 'l',
    });
  });

  it('converts metric to US, picking the largest unit that keeps a quarter or more', () => {
    expect(convertAmount({ value: 250, max: null, unit: 'ml' }, 'us')).toMatchObject({
      unit: 'cup',
    });
    expect(convertAmount({ value: 30, max: null, unit: 'ml' }, 'us')).toMatchObject({
      unit: 'tbsp',
    });
    expect(convertAmount({ value: 500, max: null, unit: 'g' }, 'us')).toMatchObject({ unit: 'lb' });
  });

  it('never converts counted units', () => {
    const cloves = { value: 2, max: null, unit: 'clove' as const };
    expect(convertAmount(cloves, 'metric')).toEqual(cloves);
    expect(convertAmount({ value: 2, max: null, unit: null }, 'us')).toEqual({
      value: 2,
      max: null,
      unit: null,
    });
  });

  it('steps down tiny amounts and up large ones', () => {
    expect(stepUnits({ value: 0.5, max: null, unit: 'tbsp' })).toEqual({
      value: 1.5,
      max: null,
      unit: 'tsp',
    });
    expect(stepUnits({ value: 16, max: null, unit: 'tbsp' })).toEqual({
      value: 1,
      max: null,
      unit: 'cup',
    });
    expect(stepUnits({ value: 0.0625, max: null, unit: 'tsp' })).toBe('pinch');
    expect(stepUnits({ value: 0.125, max: null, unit: 'cup' })).toEqual({
      value: 2,
      max: null,
      unit: 'tbsp',
    });
    expect(stepUnits({ value: 6, max: null, unit: 'tsp' })).toEqual({
      value: 2,
      max: null,
      unit: 'tbsp',
    });
  });
});

describe('displayIngredient', () => {
  it('shows the line as typed at ×1 as written', () => {
    expect(show(butter, 1)).toBe('2-3 tbsp butter, softened');
  });

  it('scales a range with its note', () => {
    expect(show(butter, 1.5)).toBe('3–4½ tbsp butter, softened');
    expect(show(flour, 1.5)).toBe('3 cups flour');
    expect(
      show(line({ raw: '1 cup buttermilk', quantity: 1, unit: 'cup', item: 'buttermilk' }), 2 / 3),
    ).toBe('⅔ cup buttermilk');
  });

  it('steps tiny and large amounts to kitchen units (Review Focus 3)', () => {
    const salt = line({ raw: '1/4 tsp salt', quantity: 0.25, unit: 'tsp', item: 'salt' });
    expect(show(salt, 0.25)).toBe('a pinch of salt');
    const sticks = line({ raw: '8 tbsp butter', quantity: 8, unit: 'tbsp', item: 'butter' });
    expect(show(sticks, 2)).toBe('1 cup butter');
    const oil = line({ raw: '1 tbsp oil', quantity: 1, unit: 'tbsp', item: 'oil' });
    expect(show(oil, 0.5)).toBe('1½ tsp oil');
  });

  it('converts to metric and US', () => {
    expect(show(flour, 1, 'metric')).toBe('475 ml flour');
    expect(
      show(line({ raw: '8 oz cheese', quantity: 8, unit: 'oz', item: 'cheese' }), 1, 'metric'),
    ).toBe('225 g cheese');
    expect(
      show(line({ raw: '500 g flour', quantity: 500, unit: 'g', item: 'flour' }), 1, 'us'),
    ).toBe('1⅛ lb flour');
    expect(
      show(line({ raw: '5 ml vanilla', quantity: 5, unit: 'ml', item: 'vanilla' }), 1, 'us'),
    ).toBe('1 tsp vanilla');
    expect(
      show(line({ raw: '250 ml milk', quantity: 250, unit: 'ml', item: 'milk' }), 1, 'us'),
    ).toBe('1 cup milk');
    expect(
      show(
        line({ raw: '2-3 cups stock', quantity: 2, quantity_max: 3, unit: 'cup', item: 'stock' }),
        1,
        'metric',
      ),
    ).toBe('475–710 ml stock');
  });

  it('counts eggs and cloves, marking rounded amounts', () => {
    const eggs = line({ raw: '2 eggs', quantity: 2, item: 'eggs' });
    expect(show(eggs, 5 / 6)).toBe('≈1½ eggs');
    const garlic = line({ raw: '2 cloves garlic', quantity: 2, unit: 'clove', item: 'garlic' });
    expect(show(garlic, 1.5)).toBe('3 cloves garlic');
    expect(show(garlic, 1, 'metric')).toBe('2 cloves garlic');
  });

  it('keeps lines the parser only half read sensible (Review Focus 2)', () => {
    expect(show(line({ raw: 'salt to taste' }), 2)).toBe('salt to taste');
    expect(show(line({ raw: 'For the sauce:', heading: true }), 2)).toBe('For the sauce:');
    const cans = line({
      raw: '1 (14 oz) can tomatoes',
      quantity: 1,
      unit: 'can',
      item: 'tomatoes',
      note: null,
    });
    expect(show(cans, 2)).toBe('2 cans tomatoes');
    // A parsed amount but no item: replace only the leading number of the typed line.
    expect(show(line({ raw: '3 large eggs, beaten', quantity: 3, item: '' }), 2)).toBe(
      '6 large eggs, beaten',
    );
    expect(show(line({ raw: 'a handful of basil' }), 3)).toBe('a handful of basil');
  });
});

describe('review fixes', () => {
  it('scales a line with an amount and unit but no item, keeping its unit word (Important 1)', () => {
    const oz = line({ raw: '12 oz', quantity: 12, unit: 'oz', item: '' });
    expect(show(oz, 1.5)).toBe('18 oz');
    expect(show(line({ raw: '2 cups', quantity: 2, unit: 'cup', item: '' }), 1, 'metric')).toBe(
      '2 cups',
    );
    expect(show(line({ raw: '1 tsp', quantity: 1, unit: 'tsp', item: '' }), 0.1)).toBe('⅛ tsp');
  });

  it('steps litres and kilograms below 1 down to ml and g (Important 2)', () => {
    expect(
      show(line({ raw: '0.25 l milk', quantity: 0.25, unit: 'l', item: 'milk' }), 1, 'metric'),
    ).toBe('250 ml milk');
    expect(
      show(line({ raw: '0.5 kg flour', quantity: 0.5, unit: 'kg', item: 'flour' }), 0.25),
    ).toBe('125 g flour');
  });

  it('never converts fluid ounces as weight (Important 5)', () => {
    const milk = line({ raw: '8 fl oz milk', quantity: 8, unit: 'oz', item: 'milk' });
    expect(show(milk, 1, 'metric')).toBe('8 fl oz milk');
    expect(show(milk, 2)).toBe('16 fl oz milk');
  });

  it('drops a bracketed equivalent that would contradict the shown amount (Important 6)', () => {
    const milk = line({
      raw: '1½ cups (360 ml) milk',
      quantity: 1.5,
      unit: 'cup',
      item: '(360 ml) milk',
    });
    expect(show(milk, 2)).toBe('3 cups milk');
    expect(show(milk, 1)).toBe('1½ cups (360 ml) milk');
    const cans = line({ raw: '1 (14 oz) can tomatoes', quantity: 1, item: '(14 oz) can tomatoes' });
    expect(show(cans, 2)).toBe('2 (14 oz) can tomatoes');
  });
});

describe('bug batch display (spec §2)', () => {
  it('tiny weights and volumes show as a pinch', () => {
    expect(show(line({ raw: '1 oz salt', quantity: 1, unit: 'oz', item: 'salt' }), 0.1, 'us')).toBe(
      'a pinch of salt',
    );
    expect(
      show(line({ raw: '1 tsp salt', quantity: 1, unit: 'tsp', item: 'salt' }), 0.1, 'metric'),
    ).toBe('a pinch of salt');
    expect(
      show(line({ raw: '5 g yeast', quantity: 5, unit: 'g', item: 'yeast' }), 0.1, 'metric'),
    ).toBe('a pinch of yeast');
  });

  it('count ranges read cleanly and take the singular at one', () => {
    const garlic = line({
      raw: '1-2 cloves garlic',
      quantity: 1,
      quantity_max: 2,
      unit: 'clove',
      item: 'garlic',
    });
    expect(show(garlic, 0.45, 'us')).toBe('½–1 clove garlic');
    const eggs = line({ raw: '2 eggs', quantity: 2, item: 'eggs' });
    expect(show(eggs, 0.5)).toBe('1 egg');
  });

  it('steps up when the rounded value reaches the next unit', () => {
    expect(
      show(line({ raw: '15.98 oz beans', quantity: 15.98, unit: 'oz', item: 'beans' }), 1, 'us'),
    ).toBe('1 lb beans');
    expect(
      show(line({ raw: '998 g flour', quantity: 998, unit: 'g', item: 'flour' }), 1, 'metric'),
    ).toBe('1 kg flour');
  });
});
