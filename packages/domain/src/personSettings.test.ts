import { describe, expect, it } from 'vitest';
import { personSettingsPatchSchema, personSettingsSchema } from './personSettings';

const ME = '11111111-1111-4111-8111-111111111111';

describe('person settings (#60)', () => {
  it('a row is the person’s own, with known units and appearance', () => {
    const row = { id: ME, user_id: ME, units: 'metric', appearance: 'dark' };
    expect(personSettingsSchema.safeParse(row).success).toBe(true);
    const other = '22222222-2222-4222-8222-222222222222';
    expect(personSettingsSchema.safeParse({ ...row, id: other }).success).toBe(false);
    expect(personSettingsSchema.safeParse({ ...row, units: 'imperial' }).success).toBe(false);
    expect(personSettingsSchema.safeParse({ ...row, household_id: ME }).success).toBe(false);
  });

  it('a patch changes units or appearance, nothing else', () => {
    expect(personSettingsPatchSchema.safeParse({ id: ME, appearance: 'light' }).success).toBe(true);
    expect(personSettingsPatchSchema.safeParse({ id: ME }).success).toBe(false);
    expect(personSettingsPatchSchema.safeParse({ id: ME, user_id: ME }).success).toBe(false);
  });
});
