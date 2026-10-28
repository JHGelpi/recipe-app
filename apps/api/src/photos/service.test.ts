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
  // False: RLS refuses the update (the member's live role can no longer write).
  updated = true,
  // The household's other uploaded files, and its quota (#67).
  used = 0,
  quotaBytes = 1_000_000,
) {
  const statements: string[] = [];
  const tx = vi.fn(async (strings: TemplateStringsArray) => {
    statements.push(strings.join('?'));
    const text = strings.join('');
    if (text.includes('sum(bytes)')) return [{ used: String(used) }];
    if (text.includes('pg_advisory_xact_lock')) return [];
    if (text.includes('update')) return updated ? [{ id: ID }] : [];
    return text.includes('select') && row ? [row] : [];
  });
  const run = async (_who: unknown, fn: (t: never) => Promise<unknown>) => fn(tx as never);
  const store: PhotoStore = {
    put: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(Uint8Array.from([9])),
    repair: vi.fn().mockResolvedValue(Uint8Array.from([9])),
    remove: vi.fn().mockResolvedValue(undefined),
    move: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(true),
    sweep: vi.fn().mockResolvedValue(0),
  };
  const service = createPhotoService({
    asClaims: run as unknown as AsClaims,
    asUser: run as unknown as AsUser,
    store,
    quotaBytes,
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
    expect(statements.at(-1)).toContain('uploaded_at = coalesce(uploaded_at, now())');
    // The size recorded is the file's own, which the quota counts.
    expect(statements.at(-1)).toContain('bytes = ?');
  });

  it("refuses a file that would take the household past its quota, under the household's lock (#67)", async () => {
    const jpeg = syntheticJpeg(10, 20);
    const row = { household_id: H, width: 10, height: 20, deleted: false };
    const full = setup(row, true, 1_000 - jpeg.byteLength + 1, 1_000);
    expect(await full.service.put(member, ID, jpeg)).toBe('storage_full');
    expect(full.store.put).not.toHaveBeenCalled();
    expect(full.statements.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    const fits = setup(row, true, 1_000 - jpeg.byteLength, 1_000);
    expect(await fits.service.put(member, ID, jpeg)).toBe('stored');
  });

  it('writes no file when the database says the member can no longer write (spec §3)', async () => {
    const { service, store } = setup(
      { household_id: H, width: 10, height: 20, deleted: false },
      false,
    );
    expect(await service.put(member, ID, syntheticJpeg(10, 20))).toBe('forbidden');
    expect(store.put).not.toHaveBeenCalled();
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
