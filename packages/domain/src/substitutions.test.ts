import { describe, expect, it } from 'vitest';
import {
  isStale,
  substitutionAnswerSchema,
  substitutionAskSchema,
  substitutionNoteLine,
  toSubstitutionAnswer,
} from './substitutions';

const option = {
  substitute: 'Plain yogurt thinned with milk',
  amount: '¾ cup yogurt + ¼ cup milk',
  how: 'Whisk together.',
  effect: 'Tangier, slightly denser crumb',
};

describe('substitutionAnswerSchema', () => {
  it('accepts up to 3 options, or a note alone', () => {
    expect(substitutionAnswerSchema.safeParse({ options: [option], note: null }).success).toBe(
      true,
    );
    expect(
      substitutionAnswerSchema.safeParse({ options: [], note: 'Eggs set this custard.' }).success,
    ).toBe(true);
  });

  it('refuses an empty answer, a 4th option, and an option missing its effect', () => {
    expect(substitutionAnswerSchema.safeParse({ options: [], note: null }).success).toBe(false);
    expect(
      substitutionAnswerSchema.safeParse({ options: [option, option, option, option], note: null })
        .success,
    ).toBe(false);
    expect(
      substitutionAnswerSchema.safeParse({ options: [{ ...option, effect: '' }], note: null })
        .success,
    ).toBe(false);
  });
});

describe('toSubstitutionAnswer', () => {
  it('trims, keeps the first 3 options, and treats an empty note as none', () => {
    const answer = toSubstitutionAnswer({
      options: [{ ...option, substitute: '  Yogurt  ' }, option, option, option],
      note: '  ',
    });
    expect(answer?.options).toHaveLength(3);
    expect(answer?.options[0]?.substitute).toBe('Yogurt');
    expect(answer?.note).toBeNull();
  });

  it('gives null for output it cannot use (rule 7)', () => {
    expect(toSubstitutionAnswer(null)).toBeNull();
    expect(toSubstitutionAnswer({ options: 'yogurt' })).toBeNull();
    expect(toSubstitutionAnswer({ options: [{ substitute: 'x' }], note: null })).toBeNull();
  });
});

describe('isStale and the notes line', () => {
  it('is stale when the line changed or is gone (Review Focus 4)', () => {
    expect(isStale({ ingredient_raw: '1 cup buttermilk' }, { raw: ' 1 cup buttermilk ' })).toBe(
      false,
    );
    expect(isStale({ ingredient_raw: '1 cup buttermilk' }, { raw: '2 cups buttermilk' })).toBe(
      true,
    );
    expect(isStale({ ingredient_raw: '1 cup buttermilk' }, undefined)).toBe(true);
  });

  it('writes the line saved to notes, naming the substitute only when the amount does not', () => {
    expect(substitutionNoteLine('1 cup buttermilk', option)).toBe(
      'Instead of 1 cup buttermilk: ¾ cup yogurt + ¼ cup milk — Tangier, slightly denser crumb',
    );
    expect(
      substitutionNoteLine('2 tbsp soy sauce', {
        ...option,
        substitute: 'Tamari',
        amount: '2 tbsp',
      }),
    ).toBe('Instead of 2 tbsp soy sauce: 2 tbsp (Tamari) — Tangier, slightly denser crumb');
  });

  it('checks the ask body', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(substitutionAskSchema.safeParse({ id, recipe_id: id, ingredient_id: id }).success).toBe(
      true,
    );
    expect(substitutionAskSchema.safeParse({ id, recipe_id: id }).success).toBe(false);
    expect(
      substitutionAskSchema.safeParse({ id, recipe_id: id, ingredient_id: id, extra: 1 }).success,
    ).toBe(false);
  });
});

describe('short substitute names (bug batch spec §2)', () => {
  it('does not repeat a short substitute already in its amount', () => {
    expect(
      substitutionNoteLine('1 tbsp mayo', { substitute: 'Egg', amount: '1 egg', how: '', effect: 'Richer' }),
    ).toBe('Instead of 1 tbsp mayo: 1 egg — Richer');
  });
});
