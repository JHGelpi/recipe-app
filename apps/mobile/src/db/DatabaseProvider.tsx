import { PowerSyncContext } from '@powersync/react';
import type { ReactNode } from 'react';
import { openDatabase } from './database';

const database = openDatabase();

export function DatabaseProvider({ children }: { children: ReactNode }) {
  return <PowerSyncContext.Provider value={database}>{children}</PowerSyncContext.Provider>;
}
