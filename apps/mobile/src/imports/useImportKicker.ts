import { usePowerSync, useQuery } from '@powersync/react';
import { useEffect, useRef, useState } from 'react';
import { requestParse, withSession } from './api';
import { afterKick, dueKicks, TICK_MS, type Attempt, type KickRow } from './kicker';
import { KICK_SQL } from './repository';

/**
 * FR-29: asks the server to read the household's waiting imports while this
 * device is online and signed in as an admin or member. Waits while local
 * changes are still uploading: an import must reach the server first.
 */
export function useImportKicker(enabled: boolean): void {
  const db = usePowerSync();
  const { data } = useQuery<KickRow>(KICK_SQL);
  const attempts = useRef(new Map<string, Attempt>());
  const inFlight = useRef(new Set<string>());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const ids = dueKicks(data, attempts.current, inFlight.current, Date.now());
    if (ids.length === 0) return;
    for (const id of ids) inFlight.current.add(id);
    void (async () => {
      try {
        if ((await db.getUploadQueueStats()).count > 0) return;
        for (const id of ids) {
          const outcome = (await withSession((deps) => requestParse(id, deps))) ?? 'reauth';
          attempts.current.set(id, afterKick(attempts.current.get(id), outcome, Date.now()));
        }
      } catch (error) {
        console.warn('Import kick failed', error);
      } finally {
        for (const id of ids) inFlight.current.delete(id);
      }
    })();
  }, [enabled, data, tick, db]);
}
