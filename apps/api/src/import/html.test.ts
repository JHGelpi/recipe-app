import { describe, expect, it } from 'vitest';
import { extractJsonLd, pageText } from './html';

describe('extractJsonLd', () => {
  it('parses every JSON-LD block and skips broken ones', () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"A"}</script>
      <script type='application/ld+json' data-x>[{"@type":"Thing"}]</script>
      <script type="application/ld+json">{broken</script>
      <script>var x = 1;</script>`;
    expect(extractJsonLd(html)).toEqual([{ '@type': 'Recipe', name: 'A' }, [{ '@type': 'Thing' }]]);
  });
});

describe('pageText', () => {
  const html = `<html><head><title>Site</title><style>p{}</style></head><body>
    <header><h1>Tomato Soup</h1></header>
    <nav>Home About</nav>
    <ul><li>2 cans tomatoes</li><li>1 onion &amp; garlic</li></ul>
    <p>1. Chop the onion.</p><p>2. Simmer.</p>
    <aside>Ads</aside><footer>© Site</footer>
    <script>track()</script><!-- hidden --></body></html>`;

  it('keeps the readable lines and drops page furniture', () => {
    expect(pageText(html)).toBe(
      'Tomato Soup\n- 2 cans tomatoes\n- 1 onion & garlic\n1. Chop the onion.\n2. Simmer.',
    );
  });

  it('cuts the text to the limit', () => {
    expect(pageText(`<p>${'x'.repeat(50)}</p>`, 10)).toHaveLength(10);
  });
});

describe('hostile pages (spec §3)', () => {
  // HOSTILE_BYTES lets the RED run use a smaller page: the old regexes are quadratic.
  const size = Number(process.env.HOSTILE_BYTES ?? 3 * 1024 * 1024);
  const timed = (fn: () => unknown) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };

  it('a page of unclosed tags parses in under 200 ms', () => {
    const page = '<style>'.repeat(Math.floor(size / 7));
    expect(timed(() => pageText(page))).toBeLessThan(200);
  });

  it('a page of unclosed JSON-LD scripts parses in under 200 ms', () => {
    const open = '<script type="application/ld+json">';
    const page = open.repeat(Math.floor(size / open.length));
    expect(timed(() => extractJsonLd(page))).toBeLessThan(200);
  });

  it('a page of unclosed comments parses in under 200 ms', () => {
    const page = '<!--'.repeat(Math.floor(size / 4));
    expect(timed(() => pageText(page))).toBeLessThan(200);
  });
});

describe('final review', () => {
  it('a capital İ before the JSON-LD does not shift the scan', () => {
    const page =
      '<title>İrmik İ</title><script type="application/ld+json">{"a":1}</script><p>İçli köfte</p>';
    expect(extractJsonLd(page)).toEqual([{ a: 1 }]);
    expect(pageText(page)).toBe('İrmik İ\nİçli köfte'.replace('\n', ' '));
  });

  it('a page of bare "<" and "<li" parses in under 200 ms', () => {
    const size = Number(process.env.HOSTILE_BYTES ?? 3 * 1024 * 1024);
    for (const unit of ['<', '<li']) {
      const page = unit.repeat(Math.floor(size / unit.length));
      const start = performance.now();
      pageText(page);
      expect(performance.now() - start).toBeLessThan(200);
    }
  });
});
