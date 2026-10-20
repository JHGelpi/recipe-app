import { beforeEach, expect, it } from 'vitest';
import { hasNotice, setNotice, takeNotice, takeNoticeFor } from './notice';

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
  setNotice({ kind: 'joined', name: 'Gelpi household', householdId: null });
  expect(takeNotice()).toEqual({ kind: 'joined', name: 'Gelpi household', householdId: null });
  expect(takeNotice()).toBeNull();
});

it('ignores anything unreadable', () => {
  memory.set('recipes.householdNotice', '{oops');
  expect(takeNotice()).toBeNull();
});

it('a notice for another household waits until the claims name it (a failed refresh after Join)', () => {
  setNotice({ kind: 'joined', name: 'Gelpi household', householdId: 'h-new' });
  expect(takeNoticeFor('h-old')).toBeNull();
  expect(hasNotice()).toBe(true);
  expect(takeNoticeFor('h-new')).toEqual({
    kind: 'joined',
    name: 'Gelpi household',
    householdId: 'h-new',
  });
  expect(hasNotice()).toBe(false);
});

it('a notice without a household is taken anywhere', () => {
  setNotice({ kind: 'moved', name: null, householdId: null });
  expect(takeNoticeFor('h-any')?.kind).toBe('moved');
});
