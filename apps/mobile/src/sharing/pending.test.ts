import { beforeEach, expect, it } from 'vitest';
import {
  peekPendingShare,
  setPendingShare,
  setSavedFlash,
  takePendingShare,
  takeSavedFlash,
} from './pending';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  globalThis.sessionStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  } as Storage;
});

const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

it('keeps a shared recipe to save across sign-in; peek does not consume it', () => {
  setPendingShare({ code: CODE, title: 'Lemon Bars' });
  expect(peekPendingShare()).toEqual({ code: CODE, title: 'Lemon Bars' });
  expect(takePendingShare()).toEqual({ code: CODE, title: 'Lemon Bars' });
  expect(takePendingShare()).toBeNull();
});

it('ignores a malformed code', () => {
  memory.set('recipes.pendingShare', JSON.stringify({ code: '../x', title: 'x' }));
  expect(takePendingShare()).toBeNull();
});

it('shows "Saved to your recipes" once', () => {
  setSavedFlash();
  expect(takeSavedFlash()).toBe(true);
  expect(takeSavedFlash()).toBe(false);
});
