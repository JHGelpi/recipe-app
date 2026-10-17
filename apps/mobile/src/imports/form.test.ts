import { describe, expect, it } from 'vitest';
import { importSourceFrom } from './form';

describe('importSourceFrom', () => {
  it('accepts trimmed text and an http(s) link', () => {
    expect(importSourceFrom('text', '  Soup  ')).toEqual({
      ok: true,
      source: { type: 'text', text: 'Soup' },
    });
    expect(importSourceFrom('url', ' https://example.com/soup ')).toEqual({
      ok: true,
      source: { type: 'url', url: 'https://example.com/soup' },
    });
  });

  it('explains what is wrong', () => {
    expect(importSourceFrom('text', 'x'.repeat(20_001))).toEqual({
      ok: false,
      message: 'At most 20,000 characters',
    });
    expect(importSourceFrom('url', 'example.com')).toEqual({
      ok: false,
      message: 'Enter a link starting with http:// or https://',
    });
    expect(importSourceFrom('text', '  ')).toEqual({
      ok: false,
      message: 'Paste the recipe text first',
    });
  });
});
