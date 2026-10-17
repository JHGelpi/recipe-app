import { useState } from 'react';
import { Text } from 'react-native';
import { useHouseholdName } from '../household/hooks';
import { takeNotice } from '../household/notice';
import type { Claims } from '../session/claims';

/** "You've joined the …" / "You were moved to the …", once (spec §6). */
export function HouseholdNoticeBanner({ claims }: { claims: Claims }) {
  const [notice] = useState(() => takeNotice());
  const synced = useHouseholdName(claims.householdId);
  if (!notice) return null;
  const name = notice.name ?? synced ?? 'new household';
  return (
    <Text role="status" style={{ backgroundColor: '#e6f0ea', padding: 10, borderRadius: 6 }}>
      {notice.kind === 'joined' ? `You've joined the ${name}` : `You were moved to the ${name}`}
    </Text>
  );
}
