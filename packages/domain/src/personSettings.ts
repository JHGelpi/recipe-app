import { z } from 'zod';
import type { UnitSystem } from './cooking';

/** FR-23: the units recipes open in. */
export const UNIT_SYSTEMS = ['as_written', 'us', 'metric'] as const satisfies readonly UnitSystem[];
/** NFR-11 (ADR-0020): the theme, or the device's. */
export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];

/**
 * A person's own defaults (ADR-0031): one row per person, whose id is the
 * person's, so every device writes the same row. Never household data.
 */
export const personSettingsSchema = z
  .strictObject({
    id: z.guid(),
    user_id: z.guid(),
    units: z.enum(UNIT_SYSTEMS),
    appearance: z.enum(APPEARANCES),
  })
  .refine((row) => row.id === row.user_id, { message: 'id must be the person’s id' });

export const personSettingsPatchSchema = z
  .strictObject({
    id: z.guid(),
    units: z.enum(UNIT_SYSTEMS).optional(),
    appearance: z.enum(APPEARANCES).optional(),
  })
  .refine((value) => Object.keys(value).length > 1, { message: 'Patch has no fields' });

export const PERSON_SETTINGS_CLIENT_FIELDS = ['user_id', 'units', 'appearance'] as const;

/** The defaults until a person chooses: As written and System (FR-23, NFR-11). */
export const DEFAULT_PERSON_SETTINGS = {
  units: 'as_written',
  appearance: 'system',
} as const satisfies {
  units: UnitSystem;
  appearance: Appearance;
};
