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
