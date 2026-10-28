import { householdPhrase } from '@recipe-app/domain';
import { useEffect, useState } from 'react';
import { useHouseholdName } from '../household/hooks';
import { takeNoticeFor, type HouseholdNotice } from '../household/notice';
import type { Claims } from '../session/claims';
import { Banner } from '../ui';

/** "You've joined the …" / "You were moved to the …", once (spec §6). */
export function HouseholdNoticeBanner({ claims }: { claims: Claims }) {
  const [notice, setShown] = useState<HouseholdNotice | null>(null);
  // Read in an effect, not in render: a render can run twice, and the second
  // would find the notice already taken.
  useEffect(() => {
    const next = takeNoticeFor(claims.householdId);
    if (next) setShown(next);
  }, [claims.householdId]);
  const synced = useHouseholdName(claims.householdId);
  if (!notice) return null;
  const name = notice.name ?? synced;
  return (
    <Banner>
      {notice.kind === 'joined'
        ? `You've joined ${householdPhrase(name, 'the household')}`
        : `You were moved to ${householdPhrase(name, 'a new household')}`}
    </Banner>
  );
}
