import { config } from '../config';
import { useStorageStatus } from '../pwa/storageStatus';
import { space } from '../theme';
import { Text } from '../ui';
import { APP_VERSION } from '../whatsNew/releases';

/** Which version and build is running (FR-47), and what Safari decided about storage. */
export function BuildFooter() {
  const storage = useStorageStatus();
  return (
    <Text variant="caption" tone="muted" aria-label="Build" style={{ marginTop: space.xl }}>
      {`Version ${APP_VERSION} · Build ${config.buildTime} · Storage: ${storage}`}
    </Text>
  );
}
