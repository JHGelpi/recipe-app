import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseReleaseNotes } from '../packages/domain/src/releaseNotes';
import { moduleFor, OUT, SOURCE } from './release-notes.mjs';

// FR-47: CI fails on a release notes file the app couldn't read, or on a
// bundled copy that wasn't regenerated after an edit.
const text = readFileSync(SOURCE, 'utf8');

it('RELEASE_NOTES.md parses: versions rise, dates are real, every entry has bullets', () => {
  expect(() => parseReleaseNotes(text)).not.toThrow();
});

it('the app bundles the current RELEASE_NOTES.md (run `pnpm release-notes`)', () => {
  expect(readFileSync(OUT, 'utf8')).toBe(moduleFor(text));
});
