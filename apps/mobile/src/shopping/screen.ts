// apps/mobile/src/shopping/screen.ts
import { SHOPPING_LIMITS, type ShoppingLine } from '@recipe-app/domain';

/** The add sheet's button (shopping spec §3): dimmed and inert at zero. */
export function addButton(count: number): { label: string; disabled: boolean } {
  return { label: `Add ${count} ${count === 1 ? 'item' : 'items'}`, disabled: count === 0 };
}

/** The line a sheet is open for, read live; null once another phone removed it. */
export function openLine(lines: ShoppingLine[], key: string | null): ShoppingLine | null {
  return key === null ? null : (lines.find((line) => line.key === key) ?? null);
}

export function typedError(text: string): string | null {
  return text.trim().length > SHOPPING_LIMITS.item ? 'Items can be up to 200 characters.' : null;
}
