import { isHttpUrl } from './imports';

export type NoteSegment =
  { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

// A candidate starts at http://, https:// or www., not inside a word, an email
// address or another scheme (ftp://www...). Other schemes never match, so
// javascript:, file: and data: stay plain text.
const CANDIDATE = /(?<![\w@./:-])(?:https?:\/\/|www\.)[^\s<>"]*/gi;
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '*']);
const CLOSERS: Record<string, string> = { ')': '(', ']': '[' };

const count = (value: string, char: string) => value.split(char).length - 1;

/** Drops sentence punctuation, and a closing bracket that has no opener in the link. */
function trimEnd(candidate: string): string {
  let end = candidate;
  for (;;) {
    const last = end.at(-1);
    if (last === undefined) return end;
    const opener = CLOSERS[last];
    if (TRAILING.has(last) || (opener && count(end, opener) < count(end, last))) {
      end = end.slice(0, -1);
    } else {
      return end;
    }
  }
}

function hrefFor(text: string): string | null {
  const href = /^www\./i.test(text) ? `https://${text}` : text;
  if (!isHttpUrl(href)) return null;
  // Every label of the host is non-empty and there are at least two (rejects "www.").
  return /^[^.]+(\.[^.]+)+$/.test(new URL(href).hostname) ? href : null;
}

/**
 * FR-36: splits a note into plain text and http(s) links for display. Joining
 * the segments' text gives back the note unchanged; the stored note never is.
 */
export function linkify(note: string): NoteSegment[] {
  const segments: NoteSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments.at(-1);
    if (last?.kind === 'text') last.text += value;
    else segments.push({ kind: 'text', text: value });
  };
  let cursor = 0;
  for (const match of note.matchAll(CANDIDATE)) {
    const text = trimEnd(match[0]);
    const href = hrefFor(text);
    if (!href) continue;
    pushText(note.slice(cursor, match.index));
    segments.push({ kind: 'link', text, href });
    cursor = match.index + text.length;
  }
  pushText(note.slice(cursor));
  return segments;
}
