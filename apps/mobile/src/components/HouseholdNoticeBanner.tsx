import { useState } from 'react';
import { useHouseholdName } from '../household/hooks';
import { takeNotice } from '../household/notice';
import type { Claims } from '../session/claims';
import { Banner } from '../ui';

/** "You've joined the …" / "You were moved to the …", once (spec §6). */
export function HouseholdNoticeBanner({ claims }: { claims: Claims }) {
  const [notice] = useState(() => takeNotice());
  const synced = useHouseholdName(claims.householdId);
  if (!notice) return null;
  const name = notice.name ?? synced ?? 'new household';
  return (
    <Banner>
      {notice.kind === 'joined' ? `You've joined the ${name}` : `You were moved to the ${name}`}
    </Banner>
  );
}
