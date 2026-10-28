import { useQuery, useStatus } from '@powersync/react';
import { useSyncExternalStore } from 'react';
import { isPhotoStorageFull, subscribePhotoStorageFull } from '../photos/storageFull';
import { Text } from '../ui';
import { statusLabel } from './statusLabel';

export function StatusLine() {
  const status = useStatus();
  // ps_crud is PowerSync's queue of local writes not yet uploaded.
  const { data, isLoading } = useQuery<{ pending: number }>(
    'select count(*) as pending from ps_crud',
  );
  const pending = isLoading ? undefined : (data[0]?.pending ?? 0);
  const storageFull = useSyncExternalStore(subscribePhotoStorageFull, isPhotoStorageFull);
  return (
    <Text variant="small" tone="muted" aria-label="Sync status">
      {statusLabel(status.connected, pending, storageFull)}
    </Text>
  );
}
