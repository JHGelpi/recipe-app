import { describe, expect, it } from 'vitest';
import { linkify } from './links';

const link = (text: string, href = text) => ({ kind: 'link', text, href });
const text = (value: string) => ({ kind: 'text', text: value });

describe('linkify (FR-36)', () => {
  it('returns plain text as one segment, and nothing for an empty note', () => {
    expect(linkify('Use less salt')).toEqual([text('Use less salt')]);
    expect(linkify('')).toEqual([]);
  });

  it('finds links with a scheme', () => {
    expect(linkify('From https://example.com/pasta?x=1#top today')).toEqual([
      text('From '),
      link('https://example.com/pasta?x=1#top'),
      text(' today'),
    ]);
    expect(linkify('HTTP://Example.com')).toEqual([link('HTTP://Example.com')]);
  });

  it('finds www links and opens them over https', () => {
    expect(linkify('see www.example.com/a')).toEqual([
      text('see '),
      link('www.example.com/a', 'https://www.example.com/a'),
    ]);
  });

  it('leaves trailing punctuation out of the link', () => {
    expect(linkify('see www.example.com.')).toEqual([
      text('see '),
      link('www.example.com', 'https://www.example.com'),
      text('.'),
    ]);
    expect(linkify('Try https://a.com/x, then https://b.com/y!?')).toEqual([
      text('Try '),
      link('https://a.com/x'),
      text(', then '),
      link('https://b.com/y'),
      text('!?'),
    ]);
    expect(linkify('"https://a.com/x"')).toEqual([text('"'), link('https://a.com/x'), text('"')]);
  });

  it('keeps balanced parentheses but drops a closing one around the link', () => {
    expect(linkify('(see https://en.wikipedia.org/wiki/Roux_(cooking))')).toEqual([
      text('(see '),
      link('https://en.wikipedia.org/wiki/Roux_(cooking)'),
      text(')'),
    ]);
  });

  it('finds several links across lines', () => {
    expect(linkify('a https://a.com\nb www.b.com')).toEqual([
      text('a '),
      link('https://a.com'),
      text('\nb '),
      link('www.b.com', 'https://www.b.com'),
    ]);
  });

  it('leaves other schemes as plain text', () => {
    for (const note of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<b>x</b>',
      'mailto:a@b.com',
      'ftp://example.com/x',
    ]) {
      expect(linkify(note)).toEqual([text(note)]);
    }
  });

  it('does not link www inside another word, address or scheme', () => {
    expect(linkify('awww.example.com')).toEqual([text('awww.example.com')]);
    expect(linkify('me@www.example.com')).toEqual([text('me@www.example.com')]);
    expect(linkify('ftp://www.example.com')).toEqual([text('ftp://www.example.com')]);
  });

  it('leaves a scheme with no host as plain text', () => {
    expect(linkify('https:// and http://')).toEqual([text('https:// and http://')]);
    expect(linkify('www. is not a link')).toEqual([text('www. is not a link')]);
  });

  it('keeps every character of the note, in order', () => {
    const note = 'x (https://a.com/b). y www.c.d, z\n\thttps://e.f/g?h=(i)';
    expect(
      linkify(note)
        .map((segment) => segment.text)
        .join(''),
    ).toBe(note);
  });
});
