import { useQuery } from '@powersync/react';
import { useMemo } from 'react';
import { SUBSTITUTIONS_SQL } from './repository';
import { substitutionFromRow, type SubstitutionRecord } from './rows';

/** The recipe's remembered substitutions, by ingredient id. */
export function useSubstitutions(recipeId: string): Map<string, SubstitutionRecord> {
  const { data } = useQuery<Record<string, unknown>>(SUBSTITUTIONS_SQL, [recipeId]);
  return useMemo(() => {
    const map = new Map<string, SubstitutionRecord>();
    for (const row of data) {
      const record = substitutionFromRow(row);
      if (record) map.set(record.ingredient_id, record);
    }
    return map;
  }, [data]);
}
