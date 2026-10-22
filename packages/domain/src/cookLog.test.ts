import { describe, expect, it } from 'vitest';
import {
  cookHistory,
  cookLogPatchSchema,
  cookLogPutSchema,
  formatCookedOn,
  localDay,
  parseCookedOn,
} from './cookLog';
import { photoPutSchema } from './photos';

const ID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD = '00000000-0000-0000-0000-00000000000a';

describe('cook log schemas (FR-37–FR-41)', () => {
  const entry = {
    id: ID,
    household_id: HOUSEHOLD,
    recipe_id: ID,
    recipe_title: 'Soup',
    cooked_on: '2026-10-22',
  };

  it('accepts an entry and a patch of its date, notes, or trash state', () => {
    expect(cookLogPutSchema.safeParse(entry).success).toBe(true);
    expect(cookLogPutSchema.safeParse({ ...entry, notes: 'Good', recipe_id: null }).success).toBe(
      true,
    );
    expect(cookLogPatchSchema.safeParse({ id: ID, notes: null }).success).toBe(true);
    expect(cookLogPatchSchema.safeParse({ id: ID, cooked_on: '2026-10-21' }).success).toBe(true);
  });

  it('refuses a cook, a bad date, long notes, or a recipe change in a patch', () => {
    expect(cookLogPutSchema.safeParse({ ...entry, cooked_by: ID }).success).toBe(false);
    for (const cooked_on of ['2026-02-30', '22/10/2026', '1999-12-31', '']) {
      expect(cookLogPutSchema.safeParse({ ...entry, cooked_on }).success).toBe(false);
    }
    expect(cookLogPutSchema.safeParse({ ...entry, notes: 'x'.repeat(4001) }).success).toBe(false);
    expect(cookLogPutSchema.safeParse({ ...entry, recipe_title: ' ' }).success).toBe(false);
    expect(cookLogPatchSchema.safeParse({ id: ID, recipe_id: ID }).success).toBe(false);
    expect(cookLogPatchSchema.safeParse({ id: ID }).success).toBe(false);
  });

  it('a cook photo names its entry and position, never a recipe', () => {
    const photo = {
      id: ID,
      household_id: HOUSEHOLD,
      kind: 'cook',
      cook_log_id: ID,
      position: 1,
      media_type: 'image/jpeg',
      bytes: 10,
      width: 1,
      height: 1,
    };
    expect(photoPutSchema.safeParse(photo).success).toBe(true);
    expect(photoPutSchema.safeParse({ ...photo, recipe_id: ID }).success).toBe(false);
    expect(photoPutSchema.safeParse({ ...photo, position: 9 }).success).toBe(false);
    expect(photoPutSchema.safeParse({ ...photo, cook_log_id: undefined }).success).toBe(false);
  });
});

describe('cook log dates', () => {
  it('localDay is the calendar day where the phone is', () => {
    expect(localDay(new Date(2026, 9, 2, 23, 30))).toBe('2026-10-02');
  });

  it('parseCookedOn takes a real past or present day', () => {
    const today = '2026-10-22';
    expect(parseCookedOn(' 2026-10-21 ', today)).toEqual({ ok: true, day: '2026-10-21' });
    expect(parseCookedOn('2026-10-22', today)).toEqual({ ok: true, day: '2026-10-22' });
    expect(parseCookedOn('2026-10-23', today)).toEqual({
      ok: false,
      message: 'The date can’t be in the future',
    });
    for (const bad of ['2026-13-01', 'yesterday', '1999-01-01']) {
      expect(parseCookedOn(bad, today).ok).toBe(false);
    }
  });

  it('formatCookedOn drops the year in the current year', () => {
    expect(formatCookedOn('2026-10-22', '2026-12-01')).toBe('Oct 22');
    expect(formatCookedOn('2025-01-05', '2026-12-01')).toBe('Jan 5, 2025');
  });
});

describe('cookHistory (FR-41)', () => {
  it('counts live entries and names the latest day', () => {
    expect(cookHistory([], '2026-10-22')).toBeNull();
    expect(cookHistory([{ cooked_on: '2026-10-22' }], '2026-10-22')).toBe(
      'Cooked once · last on Oct 22',
    );
    expect(
      cookHistory(
        [{ cooked_on: '2026-09-01' }, { cooked_on: '2026-10-22' }, { cooked_on: '2025-12-31' }],
        '2026-10-22',
      ),
    ).toBe('Cooked 3 times · last on Oct 22');
  });
});
