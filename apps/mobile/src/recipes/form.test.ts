import { describe, expect, it } from 'vitest';
import { emptyForm, formFromRecipe, valuesFromForm } from './form';
import type { RecipeRecord } from './rows';

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('valuesFromForm', () => {
  it('builds a valid recipe from typed text', () => {
    const result = valuesFromForm(
      {
        title: ' Pancakes ',
        servings: '4',
        prep: '10',
        cook: '',
        ingredients: '2 cups flour\n2 eggs',
        steps: '1. Mix\n2. Cook',
        tags: 'Breakfast, quick',
        notes: 'Sunday',
      },
      null,
      newId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toMatchObject({
      title: 'Pancakes',
      servings: 4,
      prep_minutes: 10,
      cook_minutes: null,
      tags: ['breakfast', 'quick'],
      notes: 'Sunday',
    });
    expect(result.values.ingredients.map((ingredient) => ingredient.unit)).toEqual(['cup', null]);
    expect(result.values.steps.map((step) => step.text)).toEqual(['Mix', 'Cook']);
  });

  it('reports each problem beside its field', () => {
    const result = valuesFromForm(
      { ...emptyForm(), title: '  ', servings: '0', prep: 'ten', cook: '-5' },
      null,
      newId,
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        title: 'Title is required',
        servings: 'Servings must be 1 to 999',
        prep: 'Prep must be 0 to 10000 minutes',
        cook: 'Cook must be 0 to 10000 minutes',
      },
    });
  });

  it('refuses more than 200 ingredient lines with a message', () => {
    const lines = Array.from({ length: 201 }, (_, index) => `${index + 1} cups water`).join('\n');
    const result = valuesFromForm(
      { ...emptyForm(), title: 'Soup', ingredients: lines },
      null,
      newId,
    );
    expect(result).toEqual({ ok: false, errors: { ingredients: 'At most 200 ingredients' } });
  });

  it('keeps ingredient ids from the recipe being edited', () => {
    const first = valuesFromForm(
      { ...emptyForm(), title: 'Soup', ingredients: '1 onion' },
      null,
      newId,
    );
    if (!first.ok) throw new Error('first save failed');
    const previous = {
      ...first.values,
      id: newId(),
      household_id: newId(),
      deleted_at: null,
    } as RecipeRecord;
    const second = valuesFromForm(formFromRecipe(previous), previous, newId);
    if (!second.ok) throw new Error('second save failed');
    expect(second.values.ingredients[0]?.id).toBe(first.values.ingredients[0]?.id);
  });
});

describe('formFromRecipe', () => {
  it('turns a recipe back into editor text', () => {
    const form = formFromRecipe({
      id: newId(),
      household_id: newId(),
      title: 'Bread',
      servings: 2,
      prep_minutes: null,
      cook_minutes: 30,
      ingredients: [],
      steps: [{ id: newId(), text: 'Bake' }],
      tags: ['bread', 'easy'],
      notes: '',
      deleted_at: null,
    });
    expect(form).toEqual({
      title: 'Bread',
      servings: '2',
      prep: '',
      cook: '30',
      ingredients: '',
      steps: 'Bake',
      tags: 'bread, easy',
      notes: '',
    });
  });
});
