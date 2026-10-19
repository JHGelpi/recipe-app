import { HTML_ENTITIES } from './htmlEntities';

/**
 * Decodes HTML entities once (so "&amp;amp;" becomes "&amp;"). Names use the
 * full HTML5 table, matched exactly and then in lowercase, so "&EACUTE;"
 * reads like "&eacute;". Unknown names are left as written.
 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return HTML_ENTITIES[body] ?? HTML_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Decodes until the text stops changing, at most twice: sites double-encode. */
export function decodeFully(text: string): string {
  const once = decodeEntities(text);
  return once === text ? once : decodeEntities(once);
}

// A tag: "<", an optional "/", then a letter. "1 < 2" is not one.
const TAG = /<\/?[a-z][^>]*>/gi;

/** An HTML fragment as one line of plain text: decoded first, so escaped markup is stripped too. */
export function plainText(fragment: string): string {
  return decodeFully(fragment).replace(TAG, ' ').replace(/\s+/g, ' ').trim();
}
