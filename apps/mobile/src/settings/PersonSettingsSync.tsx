import { usePowerSync, useQuery } from '@powersync/react';
import { useEffect } from 'react';
import { setUnitsNow, unitsPreferenceNow } from '../cooking/useUnitsPreference';
import { setAppearanceNow } from '../theme/useAppearance';
import { useAppearance } from '../theme';
import { settingsFrom, writeCachedSettings } from './cache';
import { saveSetting as saveToRow } from './repository';
import { registerSettingsSaver, settingsStorage } from './start';

const SETTINGS_SQL = 'select units, appearance from person_settings where id = ?';

/**
 * ADR-0031: while someone is signed in, their synced row drives the Units and
 * Appearance stores and the first-paint cache, and choices are saved to it.
 * Before the row first syncs, the stores keep their starting values.
 */
export function PersonSettingsSync({ userId }: { userId: string }): null {
  const db = usePowerSync();
  const { appearance } = useAppearance();
  const { data } = useQuery<{ units: string; appearance: string }>(SETTINGS_SQL, [userId]);
  const row = data[0];

  useEffect(() => {
    if (!row) return;
    const settings = settingsFrom(row);
    setUnitsNow(settings.units);
    setAppearanceNow(settings.appearance);
    writeCachedSettings(settingsStorage(), userId, settings);
  }, [row?.units, row?.appearance, userId]);

  useEffect(() => {
    registerSettingsSaver((key, value) => {
      const current = { units: unitsPreferenceNow(), appearance };
      void saveToRow(db, userId, key, value, current).catch((error: unknown) =>
        console.error('Saving a setting failed', error),
      );
    });
    return () => registerSettingsSaver(null);
  }, [db, userId, appearance]);

  return null;
}
