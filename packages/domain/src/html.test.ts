import { describe, expect, it } from 'vitest';
import { decodeEntities, decodeFully, plainText } from './html';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('Mac &amp; cheese &frac12; cup &#8211; &#x2019;s')).toBe(
      'Mac & cheese ½ cup – ’s',
    );
  });

  it('leaves unknown or broken entities alone, and decodes only once', () => {
    expect(decodeEntities('&bogus; &#xZZ; &amp;amp;')).toBe('&bogus; &#xZZ; &amp;');
  });
});

describe('plainText', () => {
  it('removes tags, decodes entities and collapses whitespace', () => {
    expect(plainText('<p>Mix   the <b>flour</b>&nbsp;&amp; water</p>\n')).toBe(
      'Mix the flour & water',
    );
  });
});

describe('bug batch (spec §3)', () => {
  it('knows the full HTML5 table, and names in any case', () => {
    expect(decodeEntities('&frac58; &Eacute;clair &EACUTE; &AMP;')).toBe('⅝ Éclair é &');
    expect(decodeEntities('&hearts; &trade;')).toBe('♥ ™');
  });

  it('decodes twice at most, so double-encoded text reads cleanly', () => {
    expect(plainText('1 &amp;frac12; cups')).toBe('1 ½ cups');
    expect(plainText('&amp;amp;amp;')).toBe('&amp;');
  });

  it('strips escaped markup after decoding it', () => {
    expect(plainText('&lt;p&gt;Mix the &lt;b&gt;flour&lt;/b&gt;&lt;/p&gt;')).toBe('Mix the flour');
  });

  it('keeps a lone less-than sign that is not a tag', () => {
    expect(plainText('Bake 1 &lt; 2 hours')).toBe('Bake 1 < 2 hours');
  });
});

describe('decodeFully', () => {
  it('stops once the text no longer changes', () => {
    expect(decodeFully('plain')).toBe('plain');
    expect(decodeFully('&amp;lt;')).toBe('<');
  });
});

describe('final review', () => {
  it('a long run of "<a" with no ">" is stripped in linear time', () => {
    const size = 1024 * 1024;
    const text = '<a'.repeat(Math.floor(size / 2));
    const start = performance.now();
    plainText(text);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
