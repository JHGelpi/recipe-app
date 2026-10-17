import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDiskPhotoStore } from './store';

const H = '00000000-0000-0000-0000-00000000000a';
const ID = '11111111-1111-4111-8111-111111111111';
let root = '';

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('createDiskPhotoStore', () => {
  it('stores under the household, reads back, and removes', async () => {
    root = await mkdtemp(join(tmpdir(), 'photos-'));
    const store = createDiskPhotoStore(root);
    await store.put(H, ID, Uint8Array.from([1, 2, 3]));
    expect(await readdir(join(root, H))).toEqual([`${ID}.jpg`]);
    expect([...((await store.read(H, ID)) ?? [])]).toEqual([1, 2, 3]);
    await store.remove(H, ID);
    expect(await store.read(H, ID)).toBeNull();
    await store.remove(H, ID); // removing again is fine
  });

  it('replaces a file whole, leaving no temporary file', async () => {
    root = await mkdtemp(join(tmpdir(), 'photos-'));
    const store = createDiskPhotoStore(root);
    await store.put(H, ID, Uint8Array.from([1]));
    await store.put(H, ID, Uint8Array.from([2, 2]));
    expect(await readdir(join(root, H))).toEqual([`${ID}.jpg`]);
    expect([...((await store.read(H, ID)) ?? [])]).toEqual([2, 2]);
  });

  it('builds paths only from UUIDs', async () => {
    root = await mkdtemp(join(tmpdir(), 'photos-'));
    const store = createDiskPhotoStore(root);
    await expect(store.put('../etc', ID, Uint8Array.from([1]))).rejects.toThrow('UUID');
    await expect(store.read(H, '../../passwd')).rejects.toThrow('UUID');
  });
});
