import { describe, expect, it } from 'vitest';
import { listRowFrom, parseTimestamp, rowToRecipe, trashDaysLeft } from './rows';

const base = {
  id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d10',
  household_id: '00000000-0000-0000-0000-00000000000a',
  title: 'Bread',
};
const ingredient = {
  id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d11',
  raw: '2 cups flour',
  quantity: 2,
  quantity_max: null,
  unit: 'cup',
  item: 'flour',
  note: null,
  heading: false,
};

describe('rowToRecipe', () => {
  it('parses JSON text columns from the local database', () => {
    const recipe = rowToRecipe({
      ...base,
      servings: 4,
      prep_minutes: 10,
      cook_minutes: null,
      ingredients: JSON.stringify([ingredient]),
      steps: JSON.stringify([{ id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d12', text: 'Mix' }]),
      tags: JSON.stringify(['bread']),
      notes: 'Note',
      deleted_at: null,
    });
    expect(recipe).toMatchObject({ servings: 4, tags: ['bread'], notes: 'Note' });
    expect(recipe?.ingredients[0]?.raw).toBe('2 cups flour');
  });

  it('treats missing or null new columns as empty (a recipe from before this change)', () => {
    expect(rowToRecipe({ ...base })).toEqual({
      ...base,
      servings: null,
      prep_minutes: null,
      cook_minutes: null,
      ingredients: [],
      steps: [],
      tags: [],
      notes: '',
      deleted_at: null,
      source_url: null,
      source_author: null,
      source_text: null,
      photo_id: null,
      nutrition: null,
    });
  });

  it('reads nutrition as JSON text, and an unreadable value loses only the nutrition (FR-43)', () => {
    expect(rowToRecipe({ ...base, nutrition: '{"calories":420,"fat_g":12}' })?.nutrition).toEqual({
      calories: 420,
      fat_g: 12,
    });
    const odd = rowToRecipe({ ...base, nutrition: '{"calories":"lots"' });
    expect(odd?.title).toBe(base.title);
    expect(odd?.nutrition).toBeNull();
  });

  it('accepts tags as a Postgres array literal', () => {
    expect(rowToRecipe({ ...base, tags: '{quick,"two words"}' })?.tags).toEqual([
      'quick',
      'two words',
    ]);
  });

  it('returns null for corrupt JSON or an invalid shape', () => {
    expect(rowToRecipe({ ...base, ingredients: '[{' })).toBeNull();
    expect(rowToRecipe({ ...base, ingredients: JSON.stringify([{ raw: 'x' }]) })).toBeNull();
    expect(rowToRecipe({ id: base.id })).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('reads both the ISO form the app writes and the space form sync may send', () => {
    const iso = parseTimestamp('2026-10-16T18:44:44.102Z');
    expect(iso).toBe(Date.UTC(2026, 9, 16, 18, 44, 44, 102));
    expect(parseTimestamp('2026-10-16 18:44:44.102155Z')).toBe(iso);
    expect(parseTimestamp('2026-10-16 18:44:44+00')).toBe(Date.UTC(2026, 9, 16, 18, 44, 44));
  });

  it('returns null for empty or unreadable text', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp('soon')).toBeNull();
  });
});

describe('trashDaysLeft', () => {
  const now = Date.UTC(2026, 9, 17, 12);
  it('counts whole days left in the 30-day window, rounding up', () => {
    expect(trashDaysLeft('2026-10-17T12:00:00.000Z', now)).toBe(30);
    expect(trashDaysLeft('2026-09-18T11:00:00.000Z', now)).toBe(1); // 23 hours left
    expect(trashDaysLeft('2026-09-17T11:00:00.000Z', now)).toBe(0);
  });
});

describe('listRowFrom', () => {
  it('reads tags and ingredient lines from JSON text', () => {
    expect(
      listRowFrom({
        id: 'r1',
        title: 'Bread',
        tags: '["bread","easy"]',
        ingredients: JSON.stringify([{ raw: '2 cups flour' }, { raw: '1 tsp salt' }]),
        starred: 1,
      }),
    ).toEqual({
      id: 'r1',
      title: 'Bread',
      tags: ['bread', 'easy'],
      ingredients: ['2 cups flour', '1 tsp salt'],
      starred: true,
      photoId: null,
      totalMinutes: null,
      addedAt: null,
    });
  });

  it('accepts tags as a Postgres array literal', () => {
    expect(listRowFrom({ id: 'r1', title: 'x', tags: '{quick,"two words"}' }).tags).toEqual([
      'quick',
      'two words',
    ]);
  });

  it('adds prep and cook into a total, or null when neither is known', () => {
    expect(
      listRowFrom({ id: 'r1', title: 'x', prep_minutes: 15, cook_minutes: 40 }).totalMinutes,
    ).toBe(55);
    expect(
      listRowFrom({ id: 'r1', title: 'x', prep_minutes: null, cook_minutes: 20 }).totalMinutes,
    ).toBe(20);
    expect(listRowFrom({ id: 'r1', title: 'x' }).totalMinutes).toBeNull();
  });

  it('reads when the server added it, from either timestamp form; null before sync (FR-49)', () => {
    expect(
      listRowFrom({ id: 'r1', title: 'x', created_at: '2026-10-01 12:00:00.123456Z' }).addedAt,
    ).toBe(Date.parse('2026-10-01T12:00:00.123Z'));
    expect(listRowFrom({ id: 'r1', title: 'x', created_at: null }).addedAt).toBeNull();
  });

  it('keeps the title and drops what it cannot read', () => {
    expect(
      listRowFrom({
        id: 'r1',
        title: 'Odd',
        tags: '[',
        ingredients: JSON.stringify([{ raw: 3 }, 'loose', null, { raw: 'ok' }]),
        starred: 0,
      }),
    ).toEqual({
      id: 'r1',
      title: 'Odd',
      tags: [],
      ingredients: ['ok'],
      starred: false,
      photoId: null,
      totalMinutes: null,
      addedAt: null,
    });
    expect(listRowFrom({ id: 'r2', title: 'Old', tags: null, ingredients: null })).toMatchObject({
      tags: [],
      ingredients: [],
    });
  });
});

it('reads a recipe source, and an old row without one', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    household_id: '22222222-2222-4222-8222-222222222222',
    title: 'Soup',
  };
  expect(
    rowToRecipe({
      ...base,
      source_url: 'https://example.com',
      source_author: 'Jane',
      source_text: null,
    }),
  ).toMatchObject({ source_url: 'https://example.com', source_author: 'Jane', source_text: null });
  expect(rowToRecipe(base)).toMatchObject({
    source_url: null,
    source_author: null,
    source_text: null,
  });
});

describe('listRowFrom tags', () => {
  it('trims, lowercases and drops empty tags', () => {
    expect(listRowFrom({ id: '1', title: 't', tags: '[" Quick ", "", "dinner"]' }).tags).toEqual([
      'quick',
      'dinner',
    ]);
  });
});

describe('rows from a newer app (bug batch spec §2)', () => {
  it('reads an ingredient with an extra field, and an unknown unit as its raw text', () => {
    const recipe = rowToRecipe({
      id: '11111111-1111-4111-8111-111111111111',
      household_id: '22222222-2222-4222-8222-222222222222',
      title: 'Future',
      ingredients: JSON.stringify([
        {
          id: '33333333-3333-4333-8333-333333333333',
          raw: '2 cups flour',
          quantity: 2,
          quantity_max: null,
          unit: 'cup',
          item: 'flour',
          note: null,
          heading: false,
          brand: 'Acme',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          raw: '3 sprigs thyme',
          quantity: 3,
          quantity_max: null,
          unit: 'sprig',
          item: 'thyme',
          note: null,
          heading: false,
        },
      ]),
      steps: JSON.stringify([
        { id: '55555555-5555-4555-8555-555555555555', text: 'Mix', timer: 60 },
      ]),
    });
    expect(recipe).not.toBeNull();
    expect(recipe!.ingredients[1]).toMatchObject({
      raw: '3 sprigs thyme',
      quantity: null,
      unit: null,
    });
    expect(recipe!.steps[0]).toEqual({ id: '55555555-5555-4555-8555-555555555555', text: 'Mix' });
  });
});
