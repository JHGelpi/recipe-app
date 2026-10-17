import { decodeEntities } from '@recipe-app/domain';

const JSON_LD =
  /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Every JSON-LD block in the page, parsed. A block that is not valid JSON is skipped. */
export function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(JSON_LD)) {
    const body = (match[1] ?? '').trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try {
      blocks.push(JSON.parse(body));
    } catch {
      // Some sites ship broken JSON-LD; the page text still goes to the parser.
    }
  }
  return blocks;
}

export const PAGE_TEXT_MAX = 30_000;

// Page furniture. <header> is kept: blogs put the recipe title in it.
const DROPPED =
  /<(head|script|style|noscript|svg|nav|footer|aside|form|iframe|template)\b[\s\S]*?<\/\1\s*>/gi;
const LINE_END = /<\/(p|div|li|h[1-6]|tr|section|article|header|ul|ol|table|blockquote)\s*>/gi;

/** The page's readable text, one block per line, list items as "- item", cut to `max`. */
export function pageText(html: string, max = PAGE_TEXT_MAX): string {
  const marked = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(DROPPED, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(LINE_END, '\n')
    .replace(/<[^>]*>/g, ' ');
  const text = decodeEntities(marked)
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line !== '' && line !== '-')
    .join('\n');
  return text.length > max ? text.slice(0, max) : text;
}
