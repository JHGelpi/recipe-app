// apps/api/src/import/charset.test.ts
import { describe, expect, it } from 'vitest';
import { decodePage } from './charset';

const latin1 = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

describe('decodePage', () => {
  it('uses the charset in Content-Type', () => {
    expect(decodePage(latin1('Crème brûlée'), 'text/html; charset=ISO-8859-1')).toBe(
      'Crème brûlée',
    );
  });

  it('uses a <meta charset> near the top when the header has none', () => {
    const page = latin1('<html><head><meta charset="windows-1252"></head><body>Café</body>');
    expect(decodePage(page, 'text/html')).toContain('Café');
  });

  it('reads UTF-8 by default', () => {
    expect(decodePage(new TextEncoder().encode('Crème'), 'text/html')).toBe('Crème');
  });

  it('an unknown charset falls back to UTF-8', () => {
    expect(decodePage(new TextEncoder().encode('Crème'), 'text/html; charset=x-unknown')).toBe(
      'Crème',
    );
  });
});
