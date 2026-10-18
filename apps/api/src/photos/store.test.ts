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

  it('moves a file to another household, and a missing file is not an error', async () => {
    root = await mkdtemp(join(tmpdir(), 'photos-'));
    const store = createDiskPhotoStore(root);
    const OTHER = '00000000-0000-0000-0000-00000000000b';
    await store.put(H, ID, Uint8Array.from([7]));
    await store.move(H, OTHER, ID);
    expect(await store.read(H, ID)).toBeNull();
    expect([...((await store.read(OTHER, ID)) ?? [])]).toEqual([7]);
    await store.move(H, OTHER, ID);
  });

  it('copies a file to another household under a new id, and says when the source is missing', async () => {
    root = await mkdtemp(join(tmpdir(), 'photos-'));
    const store = createDiskPhotoStore(root);
    const OTHER = '00000000-0000-0000-0000-00000000000b';
    const NEW = '44444444-4444-4444-8444-444444444444';
    await store.put(H, ID, Uint8Array.from([5]));
    expect(await store.copy(H, ID, OTHER, NEW)).toBe(true);
    expect([...((await store.read(OTHER, NEW)) ?? [])]).toEqual([5]);
    expect([...((await store.read(H, ID)) ?? [])]).toEqual([5]);
    expect(await store.copy(H, NEW, OTHER, ID)).toBe(false);
  });
});
