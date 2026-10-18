import { beforeEach, expect, it } from 'vitest';
import { setPendingInvite } from '../household/pendingInvite';
import { setPendingShare } from '../sharing/pending';
import { resumeAfterSignIn } from './resume';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  globalThis.sessionStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  } as Storage;
});

const INVITE = 'Zz9yXx8wVv7uTt6sRr5qPp4oNn3mLl2kKj1iIh0gGfE';
const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

it('resumes nowhere when nothing waits', () => {
  expect(resumeAfterSignIn()).toBeNull();
});

it('resumes an invite once (FR-3)', () => {
  setPendingInvite(INVITE);
  expect(resumeAfterSignIn()).toBe(`/invite/${INVITE}`);
  expect(resumeAfterSignIn()).toBeNull();
});

it('resumes a shared recipe and leaves it for the shared page to take (FR-27)', () => {
  setPendingShare({ code: CODE, title: 'Lemon Bars' });
  expect(resumeAfterSignIn()).toBe(`/s/${CODE}`);
  expect(resumeAfterSignIn()).toBe(`/s/${CODE}`);
});
