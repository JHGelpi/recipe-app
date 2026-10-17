import { useQuery } from '@powersync/react';
import { useEffect, useMemo, useState } from 'react';
import { fetchUsage, withSession, type AiUsage } from './api';
import { IMPORT_SQL, IMPORTS_SQL, READY_COUNT_SQL } from './repository';
import { importFromRow, type ImportRecord } from './rows';

export function useImports(): ImportRecord[] {
  const { data } = useQuery<Record<string, unknown>>(IMPORTS_SQL);
  return useMemo(
    () => data.map(importFromRow).filter((record): record is ImportRecord => record !== null),
    [data],
  );
}

/** undefined while loading; null when dismissed, saved, or missing. */
export function useImport(id: string): ImportRecord | null | undefined {
  const { data, isLoading } = useQuery<Record<string, unknown>>(IMPORT_SQL, [id]);
  if (isLoading) return undefined;
  return data[0] ? importFromRow(data[0]) : null;
}

export function useReadyCount(): number {
  const { data } = useQuery<{ n: number }>(READY_COUNT_SQL);
  return Number(data[0]?.n ?? 0);
}

/** NFR-7: this month's spend, refreshed when `refreshKey` changes; null offline. */
export function useAiUsage(online: boolean, refreshKey: string): AiUsage | null {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  useEffect(() => {
    if (!online) {
      setUsage(null);
      return;
    }
    let live = true;
    void withSession(fetchUsage).then((value) => {
      if (live) setUsage(value ?? null);
    });
    return () => {
      live = false;
    };
  }, [online, refreshKey]);
  return usage;
}
