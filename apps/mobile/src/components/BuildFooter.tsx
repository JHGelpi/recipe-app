import { Text } from 'react-native';
import { config } from '../config';
import { useStorageStatus } from '../pwa/storageStatus';

/** Lets the tester see which build is running and what Safari decided about storage. */
export function BuildFooter() {
  const storage = useStorageStatus();
  return (
    <Text aria-label="Build" style={{ color: '#666', fontSize: 12, marginTop: 24 }}>
      {`Build ${config.buildTime} · Storage: ${storage}`}
    </Text>
  );
}
