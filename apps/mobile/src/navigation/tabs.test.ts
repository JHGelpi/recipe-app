import { describe, expect, it } from 'vitest';
import { activeTab, addLabel, importLabel, listLabel, showTabBar } from './tabs';

describe('the tab bar (UI spec §4)', () => {
  it('names the list tab with what is left to buy', () => {
    expect(listLabel(0)).toBe('Shopping list');
    expect(listLabel(1)).toBe('Shopping list, 1 to buy');
    expect(listLabel(12)).toBe('Shopping list, 12 to buy');
    expect(activeTab('/list')).toBe('list');
  });

  it.each([
    '/',
    '/favorites',
    '/list',
    '/household',
    '/trash',
    '/recipe/abc',
    '/recipe/abc/edit',
    '/recipe/new',
    '/import',
    '/import/abc',
    '/diary',
    '/diary/abc',
  ])('shows on %s when signed in', (path) => {
    expect(showTabBar(path, true)).toBe(true);
  });

  it.each([
    '/sign-in',
    '/invite/xyz',
    '/s/xyz',
    '/photo/abc',
    '/recipe/abc/cook',
    '/welcome/abc',
    '/diary/abc/photos',
  ])('hides on %s', (path) => {
    expect(showTabBar(path, true)).toBe(false);
  });

  it('hides whenever signed out', () => {
    expect(showTabBar('/', false)).toBe(false);
  });

  it('the cook diary belongs to Household (FR-40)', () => {
    expect(activeTab('/diary')).toBe('household');
    expect(activeTab('/diary/abc')).toBe('household');
  });

  it('marks the current tab; Trash belongs to Household', () => {
    expect(activeTab('/')).toBe('recipes');
    expect(activeTab('/favorites')).toBe('favorites');
    expect(activeTab('/household')).toBe('household');
    expect(activeTab('/trash')).toBe('household');
    expect(activeTab('/whats-new')).toBe('household');
    expect(activeTab('/recipe/abc')).toBeNull();
  });

  it('names "+" and Import with the ready count', () => {
    expect(addLabel(0)).toBe('Add a recipe');
    expect(addLabel(1)).toBe('Add a recipe, 1 import ready');
    expect(addLabel(3)).toBe('Add a recipe, 3 imports ready');
    expect(importLabel(0)).toBe('Import');
    expect(importLabel(2)).toBe('Import, 2 ready');
  });
});
