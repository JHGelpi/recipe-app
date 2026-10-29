import { DEFAULT_RECIPE_SORT, type RecipeSort } from '@recipe-app/domain';
import { useSyncExternalStore } from 'react';

// The list's search and tag filter, shared by Recipes and Favorites so that
// switching tabs keeps it, as the one list with two tabs did.
export type ListFilter = { query: string; selected: string[] };

let filter: ListFilter = { query: '', selected: [] };
const listeners = new Set<() => void>();

export function getFilter(): ListFilter {
  return filter;
}

export function setFilter(next: Partial<ListFilter>): void {
  filter = { ...filter, ...next };
  listeners.forEach((listener) => listener());
}

export function subscribeFilter(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleTag(tag: string): void {
  setFilter({
    selected: filter.selected.includes(tag)
      ? filter.selected.filter((t) => t !== tag)
      : [...filter.selected, tag],
  });
}

export function clearFilter(): void {
  setFilter({ query: '', selected: [] });
}

export function useListFilter(): ListFilter {
  return useSyncExternalStore(subscribeFilter, getFilter, getFilter);
}

// FR-49: one sort for both tabs. Kept in memory only, so every open or reload
// starts at A–Z; clearing the filter leaves it alone.
let sort: RecipeSort = DEFAULT_RECIPE_SORT;

export function getSort(): RecipeSort {
  return sort;
}

export function setSort(next: RecipeSort): void {
  sort = next;
  listeners.forEach((listener) => listener());
}

export function useListSort(): RecipeSort {
  return useSyncExternalStore(subscribeFilter, getSort, getSort);
}
