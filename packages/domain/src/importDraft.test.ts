import { describe, expect, it } from 'vitest';
import { recipeSchema } from './index';
import { draftToRecipeFields, importDraftSchema, toImportDraft } from './importDraft';

const minimal = { title: 'Soup' };

describe('toImportDraft', () => {
  it('fills missing fields with empty values', () => {
    expect(toImportDraft(minimal)).toEqual({
      title: 'Soup',
      servings: null,
      prep_minutes: null,
      cook_minutes: null,
      ingredients: [],
      steps: [],
      tags: [],
      author: null,
      nutrition: null,
      low_confidence: [],
    });
  });

  it('keeps nutrition the source stated and drops impossible values (FR-43)', () => {
    expect(
      toImportDraft({ ...minimal, nutrition: { calories: 420, protein_g: -3, carbs_g: null } })
        ?.nutrition,
    ).toEqual({ calories: 420 });
  });

  it('reads a draft stored before nutrition existed', () => {
    const old: Record<string, unknown> = { ...toImportDraft(minimal)! };
    delete old.nutrition;
    expect(importDraftSchema.safeParse(old).success).toBe(true);
  });

  it('refuses input without a title, or that is not an object', () => {
    expect(toImportDraft({ title: '   ' })).toBeNull();
    expect(toImportDraft('Soup')).toBeNull();
    expect(toImportDraft(null)).toBeNull();
  });

  it('rounds numbers and drops impossible ones', () => {
    const draft = toImportDraft({
      ...minimal,
      servings: 4.4,
      prep_minutes: -5,
      cook_minutes: '45',
    });
    expect(draft).toMatchObject({ servings: 4, prep_minutes: null, cook_minutes: 45 });
    expect(toImportDraft({ ...minimal, servings: 5000 })?.servings).toBeNull();
  });

  it('keeps ingredient readings, nulls unknown units, and reads bare strings', () => {
    const draft = toImportDraft({
      ...minimal,
      ingredients: [
        {
          raw: '2 handfuls spinach',
          quantity: 2,
          quantity_max: null,
          unit: 'handful',
          item: 'spinach',
          note: null,
          heading: false,
        },
        '1 cup rice',
        { raw: '   ' },
        { raw: 'For the sauce:', heading: true },
      ],
    });
    expect(draft?.ingredients).toEqual([
      {
        raw: '2 handfuls spinach',
        quantity: 2,
        quantity_max: null,
        unit: null,
        item: 'spinach',
        note: null,
        heading: false,
      },
      {
        raw: '1 cup rice',
        quantity: 1,
        quantity_max: null,
        unit: 'cup',
        item: 'rice',
        note: null,
        heading: false,
      },
      {
        raw: 'For the sauce:',
        quantity: null,
        quantity_max: null,
        unit: null,
        item: 'For the sauce:',
        note: null,
        heading: true,
      },
    ]);
  });

  it('cleans steps and accepts step objects', () => {
    const draft = toImportDraft({
      ...minimal,
      steps: ['  Chop  the onion ', '', { text: 'Simmer' }, 7],
    });
    expect(draft?.steps).toEqual(['Chop the onion', 'Simmer']);
  });

  it('lowercases tags, removes commas and duplicates, keeps at most 5', () => {
    const draft = toImportDraft({
      ...minimal,
      tags: ['Dinner', 'dinner', 'Quick, Easy', 'a', 'b', 'c', 'd', 'x'.repeat(41)],
    });
    expect(draft?.tags).toEqual(['dinner', 'quick easy', 'a', 'b', 'c']);
  });

  it('keeps only known low-confidence fields, once each', () => {
    const draft = toImportDraft({
      ...minimal,
      low_confidence: ['servings', 'servings', 'colour', 'steps'],
    });
    expect(draft?.low_confidence).toEqual(['servings', 'steps']);
  });

  it('cuts an over-long title, step and author', () => {
    const draft = toImportDraft({
      title: 't'.repeat(250),
      steps: ['s'.repeat(2_500)],
      author: 'a'.repeat(300),
    });
    expect(draft?.title).toHaveLength(200);
    expect(draft?.steps[0]).toHaveLength(2_000);
    expect(draft?.author).toHaveLength(200);
  });
});

describe('draftToRecipeFields', () => {
  it('gives every ingredient and step a new id and passes the recipe schema', () => {
    const draft = toImportDraft({
      title: 'Soup',
      servings: 4,
      ingredients: ['1 onion'],
      steps: ['Chop'],
      tags: ['dinner'],
    })!;
    let n = 0;
    const newId = () => `00000000-0000-4000-8000-00000000000${n++}`;
    const fields = draftToRecipeFields(draft, newId);
    expect(fields.ingredients[0]?.id).toBe('00000000-0000-4000-8000-000000000000');
    expect(fields.steps).toEqual([{ id: '00000000-0000-4000-8000-000000000001', text: 'Chop' }]);
    const parsed = recipeSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      household_id: '22222222-2222-4222-8222-222222222222',
      ...fields,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('the draft image (FR-15, #116)', () => {
  const box = [0.1, 0.2, 0.6, 0.7];
  it('keeps a page box and an http(s) link', () => {
    expect(toImportDraft({ ...minimal, image: { page: 1, box } })?.image).toEqual({ page: 1, box });
    expect(toImportDraft({ ...minimal, image: { url: 'https://x.test/a.jpg' } })?.image).toEqual({
      url: 'https://x.test/a.jpg',
    });
  });

  it.each([
    { url: 'javascript:alert(1)' },
    { page: 0, box },
    { page: 1, box: [0.5, 0, 0.52, 1] },
    { page: 1, box: [0.6, 0, 0.1, 1] },
    { page: 1, box: [0, 0, 1.2, 1] },
    null,
  ])('drops %j and keeps the draft, with no image key', (image) => {
    const draft = toImportDraft({ ...minimal, image });
    expect(draft).not.toBeNull();
    expect(draft).not.toHaveProperty('image');
  });
});
