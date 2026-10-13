import { useQuery, useStatus } from '@powersync/react';
import { Text } from 'react-native';

export function StatusLine() {
  const status = useStatus();
  // ps_crud is PowerSync's queue of local writes not yet uploaded.
  const { data } = useQuery<{ pending: number }>('select count(*) as pending from ps_crud');
  const pending = data[0]?.pending ?? 0;
  const label = `${status.connected ? 'Online' : 'Offline'} · ${pending} unsynced`;
  return <Text aria-label="Sync status">{label}</Text>;
}
