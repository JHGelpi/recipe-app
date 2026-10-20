import { expect, it, vi } from 'vitest';
import { waitForPhoto } from './waitForPhoto';

const db = (answers: ({ uploaded_at: string | null } | undefined)[]) => {
  let call = 0;
  const getAll = vi.fn(async () => {
    const row = answers[Math.min(call++, answers.length - 1)];
    return row ? [row] : [];
  });
  // The mock answers one row shape; the database type is generic.
  return { getAll: getAll as unknown as <T>(sql: string, params: unknown[]) => Promise<T[]> };
};

it('returns at once when the photo is uploaded or not on this phone', async () => {
  const onWait = vi.fn();
  expect(await waitForPhoto(db([{ uploaded_at: 'x' }]), 'p1', { onWait })).toBe(true);
  expect(await waitForPhoto(db([undefined]), 'p1', { onWait })).toBe(true);
  expect(onWait).not.toHaveBeenCalled();
});

it('says it is waiting once, and returns when the upload lands', async () => {
  const onWait = vi.fn();
  const source = db([{ uploaded_at: null }, { uploaded_at: null }, { uploaded_at: 'x' }]);
  expect(await waitForPhoto(source, 'p1', { pauseMs: 1, onWait })).toBe(true);
  expect(onWait).toHaveBeenCalledTimes(1);
  expect(source.getAll).toHaveBeenCalledWith('select uploaded_at from photos where id = ?', ['p1']);
});

it('gives up after its tries', async () => {
  expect(await waitForPhoto(db([{ uploaded_at: null }]), 'p1', { tries: 3, pauseMs: 1 })).toBe(
    false,
  );
});
