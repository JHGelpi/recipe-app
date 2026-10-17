import { beforeEach, expect, it } from 'vitest';
import { setNotice, takeNotice } from './notice';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  globalThis.sessionStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  } as Storage;
});

it('is taken once', () => {
  setNotice({ kind: 'joined', name: 'Gelpi household' });
  expect(takeNotice()).toEqual({ kind: 'joined', name: 'Gelpi household' });
  expect(takeNotice()).toBeNull();
});

it('ignores anything unreadable', () => {
  memory.set('recipes.householdNotice', '{oops');
  expect(takeNotice()).toBeNull();
});
