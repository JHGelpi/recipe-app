import { useQuery } from '@powersync/react';
import { shoppingLines, type Aisle, type ShoppingLine, type ShoppingRow } from '@recipe-app/domain';
import { useMemo } from 'react';
import { AISLE_CHOICES_SQL, SHOPPING_ROWS_SQL } from './repository';

/** FR-33: the list's lines, live from the local database. */
export function useShoppingLines(): ShoppingLine[] {
  const { data } = useQuery<ShoppingRow>(SHOPPING_ROWS_SQL);
  return useMemo(() => shoppingLines(data), [data]);
}

export function useAisleChoices(): Map<string, Aisle> {
  const { data } = useQuery<{ item_key: string; aisle: Aisle }>(AISLE_CHOICES_SQL);
  return useMemo(() => new Map(data.map((row) => [row.item_key, row.aisle])), [data]);
}

/** Lines left to buy, for the tab's name and badge. */
export function useToBuyCount(): number {
  return useShoppingLines().filter((line) => !line.checked).length;
}
