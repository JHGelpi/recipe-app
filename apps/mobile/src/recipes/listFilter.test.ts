import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFilter,
  getFilter,
  getSort,
  setFilter,
  setSort,
  subscribeFilter,
  toggleTag,
} from './listFilter';

beforeEach(() => clearFilter());

it('keeps the query and tags between Recipes and Favorites', () => {
  setFilter({ query: 'rice' });
  toggleTag('spicy');
  expect(getFilter()).toEqual({ query: 'rice', selected: ['spicy'] });
  toggleTag('spicy');
  expect(getFilter().selected).toEqual([]);
});

it('tells listeners, and clears on sign out', () => {
  const listener = vi.fn();
  const stop = subscribeFilter(listener);
  setFilter({ query: 'x' });
  clearFilter();
  expect(listener).toHaveBeenCalledTimes(2);
  expect(getFilter()).toEqual({ query: '', selected: [] });
  stop();
});

describe('sort (FR-49)', () => {
  it('is one choice for both tabs, and clearing the filter keeps it', () => {
    const listener = vi.fn();
    const stop = subscribeFilter(listener);
    setSort('highest');
    expect(listener).toHaveBeenCalledTimes(1);
    setFilter({ query: 'rice' });
    clearFilter();
    expect(getSort()).toBe('highest');
    stop();
    setSort('az');
  });

  it('starts at A–Z every time the app loads', async () => {
    setSort('quickest');
    vi.resetModules();
    const fresh = await import('./listFilter');
    expect(fresh.getSort()).toBe('az');
  });
});
