import { describe, expect, it } from 'vitest';
import { activeTab, addLabel, importLabel, showTabBar } from './tabs';

describe('the tab bar (UI spec §4)', () => {
  it.each([
    '/',
    '/favorites',
    '/household',
    '/trash',
    '/recipe/abc',
    '/recipe/abc/edit',
    '/recipe/new',
    '/import',
    '/import/abc',
  ])('shows on %s when signed in', (path) => {
    expect(showTabBar(path, true)).toBe(true);
  });

  it.each(['/sign-in', '/invite/xyz', '/s/xyz', '/photo/abc', '/recipe/abc/cook', '/welcome/abc'])(
    'hides on %s',
    (path) => {
      expect(showTabBar(path, true)).toBe(false);
    },
  );

  it('hides whenever signed out', () => {
    expect(showTabBar('/', false)).toBe(false);
  });

  it('marks the current tab; Trash belongs to Household', () => {
    expect(activeTab('/')).toBe('recipes');
    expect(activeTab('/favorites')).toBe('favorites');
    expect(activeTab('/household')).toBe('household');
    expect(activeTab('/trash')).toBe('household');
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
