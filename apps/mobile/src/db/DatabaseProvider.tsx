import { PowerSyncContext } from '@powersync/react';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { openDatabase } from './database';
import { colors, space } from '../theme';
import { Text } from '../ui';

const database = openDatabase();

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    database.waitForReady().catch((error: unknown) => {
      console.error('The local database could not open', error);
      setFailed(true);
    });
  }, []);

  if (failed) {
    return (
      <View style={{ flex: 1, padding: space.lg, backgroundColor: colors.bg }}>
        <Text role="alert">
          This browser can&apos;t store recipes on this device. Private browsing isn&apos;t
          supported.
        </Text>
      </View>
    );
  }
  return <PowerSyncContext.Provider value={database}>{children}</PowerSyncContext.Provider>;
}
