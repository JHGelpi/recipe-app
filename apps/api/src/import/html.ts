import { decodeEntities } from '@recipe-app/domain';

/**
 * Lowercase for ASCII only, so every index found in it is the same index in
 * the page: toLowerCase() turns "İ" into two code units (final review).
 */
const asciiLower = (text: string) => text.replace(/[A-Z]+/g, (run) => run.toLowerCase());

// a-z or 0-9, by code: cheaper than a regex for every "<" of a long page.
const isNameChar = (code: number) => (code >= 97 && code <= 122) || (code >= 48 && code <= 57);

// Index-based scanners (spec §3): each search starts where the last ended, so
// a hostile page of unclosed tags is read in one pass, never quadratically.

/** Every JSON-LD block in the page, parsed. A block that is not valid JSON is skipped. */
export function extractJsonLd(html: string): unknown[] {
  const lower = asciiLower(html);
  const blocks: unknown[] = [];
  let at = 0;
  for (;;) {
    const open = lower.indexOf('<script', at);
    if (open < 0) break;
    const end = lower.indexOf('>', open);
    if (end < 0) break;
    const close = lower.indexOf('</script', end);
    if (close < 0) break;
    const tag = lower.slice(open, end);
    if (/type\s*=\s*["']?application\/ld\+json/.test(tag)) {
      const body = html
        .slice(end + 1, close)
        .trim()
        .replace(/^<!\[CDATA\[|\]\]>$/g, '');
      try {
        blocks.push(JSON.parse(body));
      } catch {
        // Some sites ship broken JSON-LD; the page text still goes to the parser.
      }
    }
    at = close + 8;
  }
  return blocks;
}

export const PAGE_TEXT_MAX = 30_000;

// Page furniture. <header> is kept: blogs put the recipe title in it.
const DROPPED = [
  'head',
  'script',
  'style',
  'noscript',
  'svg',
  'nav',
  'footer',
  'aside',
  'form',
  'iframe',
  'template',
];
const LINE_END = /<\/(p|div|li|h[1-6]|tr|section|article|header|ul|ol|table|blockquote)\s*>/gi;

/** The page without comments and dropped elements, scanned once from left to right. */
function withoutFurniture(html: string): string {
  const lower = asciiLower(html);
  const kept: string[] = [];
  // A closing tag searched for once and not found is never found later:
  // the search ran to the end of the page. This keeps the scan linear.
  const unclosed = new Set<string>();
  let at = 0;
  let from = 0;
  while (at < html.length) {
    const lt = lower.indexOf('<', at);
    if (lt < 0) break;
    if (lower.startsWith('<!--', lt)) {
      const end = lower.indexOf('-->', lt + 4);
      kept.push(html.slice(from, lt), ' ');
      // An unclosed comment hides the rest, as a browser would.
      at = from = end < 0 ? html.length : end + 3;
      continue;
    }
    // The tag name, read without a regex or a slice per "<" (a page can be all "<").
    let stop = lt + 1;
    while (stop < lt + 12 && isNameChar(lower.charCodeAt(stop))) stop += 1;
    const name = stop > lt + 1 ? lower.slice(lt + 1, stop) : undefined;
    if (name && DROPPED.includes(name)) {
      const close = unclosed.has(name) ? -1 : lower.indexOf(`</${name}`, lt + 1);
      if (close < 0) unclosed.add(name);
      // Closed: drop the whole element. Never closed: drop only the opening tag.
      const end = lower.indexOf('>', close >= 0 ? close : lt);
      kept.push(html.slice(from, lt), ' ');
      at = from = end < 0 ? html.length : end + 1;
      continue;
    }
    at = lt + 1;
  }
  kept.push(html.slice(from));
  return kept.join('');
}

/** The page's readable text, one block per line, list items as "- item", cut to `max`. */
export function pageText(html: string, max = PAGE_TEXT_MAX): string {
  const marked = withoutFurniture(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^<>]*>/gi, '\n- ')
    .replace(LINE_END, '\n')
    .replace(/<[^<>]*>/g, ' '); // [^<>]: a run of '<' stays linear
  const text = decodeEntities(marked)
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line !== '' && line !== '-')
    .join('\n');
  return text.length > max ? text.slice(0, max) : text;
}
