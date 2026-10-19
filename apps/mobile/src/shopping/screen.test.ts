// apps/mobile/src/shopping/screen.test.ts
import type { ShoppingLine } from '@recipe-app/domain';
import { describe, expect, it } from 'vitest';
import { addButton, openLine, typedError } from './screen';

const line = (key: string): ShoppingLine => ({
  key,
  item: key,
  aisle: 'produce',
  amount: '',
  recipes: [],
  handAdded: true,
  checked: false,
  rowIds: [`${key}-1`],
});

describe('the add sheet button', () => {
  it('names the count and is disabled at zero', () => {
    expect(addButton(3)).toEqual({ label: 'Add 3 items', disabled: false });
    expect(addButton(1)).toEqual({ label: 'Add 1 item', disabled: false });
    expect(addButton(0)).toEqual({ label: 'Add 0 items', disabled: true });
  });
});

describe('the open line', () => {
  it('follows the live line, and is null once the key is gone', () => {
    const fresh = { ...line('onion'), amount: '3' };
    expect(openLine([fresh], 'onion')).toBe(fresh);
    expect(openLine([line('lemon')], 'onion')).toBeNull();
    expect(openLine([fresh], null)).toBeNull();
  });
});

describe('typed items', () => {
  it('says why a long item is not added', () => {
    expect(typedError('x'.repeat(201))).toBe('Items can be up to 200 characters.');
    expect(typedError('2 lemons')).toBeNull();
  });
});
