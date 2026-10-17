import { describe, expect, it } from 'vitest';
import { buildShareSnapshot, pdfSafeText, shareSnapshotSchema, shareText } from './sharing';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const line = (n: number, raw: string, heading = false) => ({
  id: id(n),
  raw,
  quantity: null,
  quantity_max: null,
  unit: null,
  item: raw,
  note: null,
  heading,
});
const bars = {
  title: 'Lemon Bars',
  servings: 9,
  prep_minutes: 15,
  cook_minutes: 30,
  ingredients: [
    line(1, '2 cups flour'),
    line(2, 'For the topping:', true),
    line(3, '⅓ cup lemon juice'),
  ],
  steps: [
    { id: id(10), text: 'Heat the oven to 350°F.' },
    { id: id(11), text: 'Bake 30 minutes.' },
  ],
  tags: ['dessert'],
  notes: 'Chill before cutting.',
  source_url: 'https://www.example.com/lemon-bars',
  source_author: 'Jane Doe',
};

describe('shareText (FR-26)', () => {
  it('lays out the recipe as plain text', () => {
    expect(shareText(bars)).toBe(
      [
        'Lemon Bars',
        'Serves 9 · Prep 15 min · Cook 30 min',
        '',
        'Ingredients',
        '• 2 cups flour',
        '',
        'For the topping:',
        '• ⅓ cup lemon juice',
        '',
        'Steps',
        '1. Heat the oven to 350°F.',
        '2. Bake 30 minutes.',
        '',
        'Notes',
        'Chill before cutting.',
        '',
        'From example.com · by Jane Doe',
      ].join('\n'),
    );
  });

  it('leaves out empty sections', () => {
    expect(
      shareText({
        ...bars,
        servings: null,
        prep_minutes: null,
        cook_minutes: null,
        ingredients: [],
        steps: [],
        notes: '',
        source_url: null,
        source_author: null,
      }),
    ).toBe('Lemon Bars');
    expect(shareText({ ...bars, source_url: null })).toMatch(/\nBy Jane Doe$/);
  });
});

describe('the snapshot (NFR-2)', () => {
  it('keeps only the shared fields, with the household and time', () => {
    const snapshot = buildShareSnapshot(
      bars,
      'Gelpi household',
      { bytes: 10, width: 4, height: 3 },
      new Date('2026-10-17T12:00:00Z'),
    );
    expect(shareSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot).toMatchObject({
      household_name: 'Gelpi household',
      shared_at: '2026-10-17T12:00:00.000Z',
      photo: { bytes: 10, width: 4, height: 3 },
    });
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        'cook_minutes',
        'household_name',
        'ingredients',
        'notes',
        'photo',
        'prep_minutes',
        'servings',
        'shared_at',
        'source_author',
        'source_url',
        'steps',
        'tags',
        'title',
      ].sort(),
    );
  });

  it('refuses a snapshot with extra fields or a bad link', () => {
    const snapshot = buildShareSnapshot(bars, 'H', null, new Date());
    expect(shareSnapshotSchema.safeParse({ ...snapshot, household_id: id(9) }).success).toBe(false);
    expect(
      shareSnapshotSchema.safeParse({ ...snapshot, source_url: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });
});

describe('pdfSafeText (Review Focus 3)', () => {
  it('spells out the fractions the PDF font lacks, and keeps the ones it has', () => {
    expect(pdfSafeText('⅓ cup, ⅔ cup, ⅛ tsp, 1⅜ cups')).toBe(
      '1/3 cup, 2/3 cup, 1/8 tsp, 1 3/8 cups',
    );
    expect(pdfSafeText('½ cup · 350°F – • ¾')).toBe('½ cup · 350°F – • ¾');
    expect(pdfSafeText('Crème brûlée ≈ 2 → ok')).toBe('Crème brûlée ~ 2 -> ok');
  });
});
