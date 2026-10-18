import { beforeEach, expect, it, vi } from 'vitest';
import { clearFilter, getFilter, setFilter, subscribeFilter, toggleTag } from './listFilter';

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
