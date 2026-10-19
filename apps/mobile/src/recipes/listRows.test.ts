// apps/mobile/src/recipes/listRows.test.ts
import { describe, expect, it } from 'vitest';
import { listRowsFrom } from './listRows';
import type { ListRow } from './rows';

describe('listRowsFrom', () => {
  it('reuses a row whose columns did not change, and rereads one that did', () => {
    const cache = new Map<string, { stamp: string; row: ListRow }>();
    const a = { id: 'a', title: 'A', tags: '["x"]', ingredients: '[]' };
    const b = { id: 'b', title: 'B', tags: '["y"]', ingredients: '[]' };
    const first = listRowsFrom([a, b], cache);
    const second = listRowsFrom([{ ...a }, { ...b, tags: '["z"]' }], cache);
    expect(second.get('a')).toBe(first.get('a'));
    expect(second.get('b')!.tags).toEqual(['z']);
  });

  it('forgets removed rows', () => {
    const cache = new Map<string, { stamp: string; row: ListRow }>();
    listRowsFrom([{ id: 'a', title: 'A' }], cache);
    listRowsFrom([], cache);
    expect(cache.size).toBe(0);
  });
});
