import { expect, it } from 'vitest';
import { substitutionFromRow } from './rows';

const base = { id: 's1', recipe_id: 'r1', ingredient_id: 'i1', ingredient_raw: '1 cup buttermilk' };
const option = { substitute: 'Yogurt', amount: '1 cup yogurt', how: '', effect: 'Tangier' };

it('reads a synced row, with its options as JSON text', () => {
  expect(substitutionFromRow({ ...base, options: JSON.stringify([option]), note: null })).toEqual({
    ...base,
    answer: { options: [option], note: null },
  });
});

it('drops a row it cannot read rather than crash', () => {
  expect(substitutionFromRow({ ...base, options: '[{', note: null })).toBeNull();
  expect(substitutionFromRow({ ...base, options: '[]', note: null })).toBeNull();
  expect(substitutionFromRow({ id: 's1' })).toBeNull();
});
