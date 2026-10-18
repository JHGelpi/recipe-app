import { config } from '../config';
import { useStorageStatus } from '../pwa/storageStatus';
import { space } from '../theme';
import { Text } from '../ui';

/** Lets the tester see which build is running and what Safari decided about storage. */
export function BuildFooter() {
  const storage = useStorageStatus();
  return (
    <Text variant="caption" tone="muted" aria-label="Build" style={{ marginTop: space.xl }}>
      {`Build ${config.buildTime} · Storage: ${storage}`}
    </Text>
  );
}
