import { describe, expect, it, vi } from 'vitest';
import type { PhotoStore } from '../photos/store';
import { createSharingService, ShareRefusal } from './service';

const RECIPE = '33333333-3333-4333-8333-333333333333';
const recipeRow = {
  title: 'Soup',
  servings: 4,
  prep_minutes: null,
  cook_minutes: null,
  ingredients: [],
  steps: [],
  tags: [],
  notes: '',
  source_url: null,
  source_author: null,
  household_id: 'h1',
  household_name: 'Gelpi household',
  photo_id: 'p1',
  photo_bytes: 10,
  photo_width: 4,
  photo_height: 3,
};

function setup(rows: Record<string, unknown[]>, files: Partial<PhotoStore> = {}) {
  const statements: string[] = [];
  const tx = Object.assign(
    vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      statements.push(sql);
      const key = Object.keys(rows).find((k) => sql.includes(k));
      return key ? rows[key]! : [];
    }),
    { json: (value: unknown) => value },
  );
  const run = async (_who: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx);
  const store = {
    copy: vi.fn().mockResolvedValue(true),
    read: vi.fn().mockResolvedValue(Uint8Array.from([1])),
    remove: vi.fn(),
    ...files,
  } as unknown as PhotoStore;
  const service = createSharingService({
    asUser: run as never,
    asAnonymous: ((fn: (t: unknown) => Promise<unknown>) => fn(tx)) as never,
    store,
    now: () => new Date('2026-10-17T12:00:00Z'),
  });
  return { service, statements, store };
}

describe('sharing service', () => {
  it('snapshots the recipe, copies its dish photo under the share id, and returns the code', async () => {
    const { service, store, statements } = setup({
      'from public.recipes': [recipeRow],
      'public.create_share(': [{ id: 's1', token: 'c'.repeat(43) }],
    });
    expect(await service.create('jwt', RECIPE)).toEqual({ code: 'c'.repeat(43) });
    expect(vi.mocked(store.copy).mock.calls[0]?.slice(0, 2)).toEqual(['h1', 'p1']);
    expect(statements.some((sql) => sql.includes('public.create_share('))).toBe(true);
  });

  it('shares without a photo when its file is gone', async () => {
    const { service, statements } = setup(
      {
        'from public.recipes': [recipeRow],
        'public.create_share(': [{ id: 's1', token: 'c'.repeat(43) }],
      },
      { copy: vi.fn().mockResolvedValue(false) },
    );
    await service.create('jwt', RECIPE);
    expect(statements.filter((sql) => sql.includes('public.create_share(')).length).toBe(1);
  });

  it('refuses a recipe that cannot be seen or is in the Trash', async () => {
    const { service } = setup({ 'from public.recipes': [] });
    await expect(service.create('jwt', RECIPE)).rejects.toEqual(new ShareRefusal('not_found'));
  });

  it('reads a share anonymously, and copies the photo file on save; a missing photo still saves (Review Focus 4)', async () => {
    const { service } = setup({ 'public.read_share(': [{ status: 'stopped', snapshot: null }] });
    expect(await service.read('c'.repeat(43))).toEqual({ status: 'stopped', snapshot: null });
    const saving = setup(
      {
        'public.save_share(': [
          { recipe_id: 'r2', photo_id: 'p2', source_household: 'h1', share_id: 's1' },
        ],
        'public.auth_household_id()': [{ home: 'h2' }],
      },
      { copy: vi.fn().mockResolvedValue(false) },
    );
    expect(await saving.service.save('jwt', 'c'.repeat(43))).toEqual({ recipe_id: 'r2' });
  });
});
