import { describe, expect, it } from 'vitest';
import { decodeEntities, plainText } from './html';

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
