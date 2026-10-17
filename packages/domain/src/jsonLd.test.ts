import { describe, expect, it } from 'vitest';
import { draftFromJsonLd, isoMinutes } from './jsonLd';

describe('isoMinutes', () => {
  it.each([
    ['PT1H30M', 90],
    ['PT90M', 90],
    ['P0DT45M', 45],
    ['P1D', 1440],
    ['PT1H30M30S', 91],
    ['pt20m', 20],
    ['PT0S', null],
    ['PT', null],
    ['90 minutes', null],
    [45, null],
  ])('%s → %s', (value, expected) => {
    expect(isoMinutes(value)).toBe(expected);
  });
});

const lasagna = {
  '@type': ['Recipe', 'NewsArticle'],
  name: 'Lasagna &amp; Salad',
  author: [{ '@type': 'Person', name: 'Jane Doe' }],
  recipeYield: ['8', '8 servings'],
  prepTime: 'PT30M',
  cookTime: 'PT1H15M',
  keywords: 'Italian, Pasta',
  recipeCategory: 'Dinner',
  recipeIngredient: [
    '1 lb ground beef',
    '2 cups ricotta &frac12; fat',
    '<b>12</b> lasagna noodles',
  ],
  recipeInstructions: [
    {
      '@type': 'HowToSection',
      name: 'Sauce',
      itemListElement: [
        { '@type': 'HowToStep', text: '<p>Brown the beef.</p>' },
        { '@type': 'HowToStep', name: 'Simmer 20 minutes.' },
      ],
    },
    'Layer and bake.',
  ],
};

describe('draftFromJsonLd', () => {
  it('maps a Recipe found inside @graph', () => {
    const draft = draftFromJsonLd([
      { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, lasagna] },
    ]);
    expect(draft).toMatchObject({
      title: 'Lasagna & Salad',
      servings: 8,
      prep_minutes: 30,
      cook_minutes: 75,
      tags: ['italian', 'pasta', 'dinner'],
      author: 'Jane Doe',
      steps: ['Brown the beef.', 'Simmer 20 minutes.', 'Layer and bake.'],
      low_confidence: [],
    });
    expect(draft?.ingredients.map((i) => i.raw)).toEqual([
      '1 lb ground beef',
      '2 cups ricotta ½ fat',
      '12 lasagna noodles',
    ]);
    expect(draft?.ingredients[0]).toMatchObject({ quantity: 1, unit: 'lb', item: 'ground beef' });
  });

  it('finds a Recipe in a top-level array or under mainEntity', () => {
    expect(draftFromJsonLd([[{ '@type': 'Organization' }, lasagna]])?.title).toBe(
      'Lasagna & Salad',
    );
    expect(draftFromJsonLd([{ '@type': 'WebPage', mainEntity: lasagna }])?.title).toBe(
      'Lasagna & Salad',
    );
  });

  it('reads yields, authors and keywords in their other shapes', () => {
    const draft = draftFromJsonLd([
      {
        ...lasagna,
        recipeYield: 6,
        author: 'Sam Cook',
        keywords: ['Quick', 'Soup'],
        recipeCategory: undefined,
        recipeInstructions: 'Chop.\nSimmer.',
      },
    ]);
    expect(draft).toMatchObject({
      servings: 6,
      author: 'Sam Cook',
      tags: ['quick', 'soup'],
      steps: ['Chop.', 'Simmer.'],
    });
    expect(
      draftFromJsonLd([{ ...lasagna, recipeYield: 'Makes 12 cookies', author: { name: 'Pat' } }]),
    ).toMatchObject({ servings: 12, author: 'Pat' });
  });

  it('returns null when there is no Recipe or it has no name', () => {
    expect(draftFromJsonLd([{ '@type': 'Article', name: 'News' }])).toBeNull();
    expect(draftFromJsonLd([{ ...lasagna, name: '' }])).toBeNull();
    expect(draftFromJsonLd([])).toBeNull();
  });
});
