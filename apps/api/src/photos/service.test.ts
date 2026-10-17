import { describe, expect, it, vi } from 'vitest';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import type { AsClaims, AsUser } from '../db/asUser';
import { createPhotoService } from './service';
import type { PhotoStore } from './store';

const ID = '11111111-1111-4111-8111-111111111111';
const H = '00000000-0000-0000-0000-00000000000a';
const member = { sub: 'u1', household_id: H, household_role: 'member', exp: 0 };

function setup(
  row: { household_id: string; width: number; height: number; deleted: boolean } | null,
) {
  const statements: string[] = [];
  const tx = vi.fn(async (strings: TemplateStringsArray) => {
    statements.push(strings.join('?'));
    return strings.join('').includes('select') && row ? [row] : [];
  });
  const run = async (_who: unknown, fn: (t: never) => Promise<unknown>) => fn(tx as never);
  const store: PhotoStore = {
    put: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(Uint8Array.from([9])),
    remove: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(true),
  };
  const service = createPhotoService({
    asClaims: run as unknown as AsClaims,
    asUser: run as unknown as AsUser,
    store,
  });
  return { service, store, statements };
}

describe('photo service', () => {
  it('stores a JPEG that matches its row, then marks it uploaded', async () => {
    const { service, store, statements } = setup({
      household_id: H,
      width: 10,
      height: 20,
      deleted: false,
    });
    expect(await service.put(member, ID, syntheticJpeg(10, 20))).toBe('stored');
    expect(store.put).toHaveBeenCalledWith(H, ID, expect.any(Uint8Array));
    expect(statements.at(-1)).toContain('uploaded_at = now()');
  });

  it('refuses a viewer before reading anything', async () => {
    const { service, store } = setup({ household_id: H, width: 10, height: 20, deleted: false });
    expect(
      await service.put({ ...member, household_role: 'viewer' }, ID, syntheticJpeg(10, 20)),
    ).toBe('forbidden');
    expect(store.put).not.toHaveBeenCalled();
  });

  it('refuses bytes that are not a JPEG, and a size that differs from the row', async () => {
    const { service, store } = setup({ household_id: H, width: 10, height: 20, deleted: false });
    expect(await service.put(member, ID, new TextEncoder().encode('hello'))).toBe('not_jpeg');
    expect(await service.put(member, ID, syntheticJpeg(20, 10))).toBe('wrong_size');
    expect(store.put).not.toHaveBeenCalled();
  });

  it('answers missing for a row it cannot see, and gone for a dismissed one', async () => {
    expect(await setup(null).service.put(member, ID, syntheticJpeg(1, 1))).toBe('missing');
    const gone = setup({ household_id: H, width: 1, height: 1, deleted: true });
    expect(await gone.service.put(member, ID, syntheticJpeg(1, 1))).toBe('gone');
    expect(gone.store.put).not.toHaveBeenCalled();
  });

  it('reads a live photo’s file, and nothing for a row it cannot see', async () => {
    const live = setup({ household_id: H, width: 1, height: 1, deleted: false });
    expect([...((await live.service.get('jwt', ID)) ?? [])]).toEqual([9]);
    expect(await setup(null).service.get('jwt', ID)).toBeNull();
    const gone = setup({ household_id: H, width: 1, height: 1, deleted: true });
    expect(await gone.service.get('jwt', ID)).toBeNull();
  });
});
