import { describe, expect, it } from 'vitest';
import { formFromRecipe } from '../recipes/form';
import { draftRecord, flaggedFields, linkHost } from './review';
import { importFromRow } from './rows';

const record = importFromRow({
  id: 'i1',
  source_type: 'text',
  source_text: 'Soup',
  status: 'ready',
  draft: JSON.stringify({
    title: 'Soup',
    servings: 4,
    ingredients: [
      {
        raw: '2 handfuls spinach',
        quantity: 2,
        quantity_max: null,
        unit: null,
        item: 'spinach',
        note: null,
        heading: false,
      },
    ],
    steps: ['Chop'],
    tags: ['dinner', 'quick'],
    low_confidence: ['servings', 'prep_minutes', 'tags'],
  }),
})!;

describe('draftRecord', () => {
  it('fills the editor from the draft', () => {
    let n = 0;
    const recipe = draftRecord(record, record.draft!, 'h1', () => `id-${n++}`);
    expect(formFromRecipe(recipe)).toEqual({
      title: 'Soup',
      servings: '4',
      prep: '',
      cook: '',
      ingredients: '2 handfuls spinach',
      steps: 'Chop',
      tags: 'dinner, quick',
      notes: '',
    });
    expect(recipe.ingredients[0]).toMatchObject({ id: 'id-0', item: 'spinach', quantity: 2 });
  });
});

describe('flaggedFields', () => {
  it('names the editor fields the AI was unsure of', () => {
    expect(flaggedFields(record.draft!)).toEqual(['servings', 'prep', 'tags']);
  });
});

describe('linkHost', () => {
  it('shows the site of an http(s) link, without www', () => {
    expect(linkHost('https://www.example.com/soup')).toBe('example.com');
    expect(linkHost('http://fake-ai:4010/pages/jsonld.html')).toBe('fake-ai');
    expect(linkHost('javascript:alert(1)')).toBeNull();
    expect(linkHost(null)).toBeNull();
  });
});
