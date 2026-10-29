import { describe, expect, it } from 'vitest';
import {
  BEFORE_RELEASE_NOTES,
  compareVersions,
  parseReleaseNotes,
  ReleaseNotesError,
  releaseHeading,
  startingSeenVersion,
  unseenReleases,
} from './releaseNotes';

const FILE = `# Release notes

What changed in each version of Dishkept, newest first.

## 1.2.0 · 2026-11-05
- Plan the week's dinners

## 1.1.1 · 2026-10-30
- Fixed the shopping list not syncing after joining a household

## 1.1.0 · 2026-10-28
- You can now rate recipes 1–5 stars
- See what changed after an update
`;

function problems(text: string): string[] {
  try {
    parseReleaseNotes(text);
  } catch (error) {
    if (error instanceof ReleaseNotesError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseReleaseNotes (FR-47)', () => {
  it('reads every release, newest first, after a title and introduction', () => {
    expect(parseReleaseNotes(FILE)).toEqual([
      { version: '1.2.0', date: '2026-11-05', notes: ["Plan the week's dinners"] },
      {
        version: '1.1.1',
        date: '2026-10-30',
        notes: ['Fixed the shopping list not syncing after joining a household'],
      },
      {
        version: '1.1.0',
        date: '2026-10-28',
        notes: ['You can now rate recipes 1–5 stars', 'See what changed after an update'],
      },
    ]);
  });

  it('refuses a malformed heading, an invalid date, and an entry without bullets', () => {
    expect(problems('## 1.2 · 2026-10-28\n- x')).toEqual([
      'line 1: a release heading is "## 1.2.0 · 2026-10-28"',
      'line 2: a bullet before the first release',
      'no releases',
    ]);
    expect(problems('## 1.2.0 · 2026-02-30\n- x')).toEqual([
      'line 1: 1.2.0 · 2026-02-30 is not a date',
    ]);
    expect(problems('## 1.2.0 · 2026-10-28\n\n## 1.1.0 · 2026-10-01\n- x')).toEqual([
      '1.2.0 has no bullets',
    ]);
    expect(problems('## 1.2.0 · 2026-10-28\n- \n- x')).toEqual(['line 2: an empty bullet']);
  });

  it('refuses a version repeated or not higher than the one below it', () => {
    expect(problems('## 1.1.0 · 2026-10-28\n- a\n## 1.1.0 · 2026-10-01\n- b')).toEqual([
      '1.1.0 appears twice',
    ]);
    expect(problems('## 1.1.0 · 2026-10-28\n- a\n## 1.10.0 · 2026-10-01\n- b')).toEqual([
      '1.1.0 is not higher than 1.10.0 below it',
    ]);
  });

  it('refuses text inside a release and bullets before the first one', () => {
    expect(problems('- early\n## 1.1.0 · 2026-10-28\n- a\nprose')).toEqual([
      'line 1: a bullet before the first release',
      'line 4: a release holds only "- " bullets',
    ]);
    expect(problems('')).toEqual(['no releases']);
  });
});

describe('which releases a device has not seen (FR-47)', () => {
  const releases = parseReleaseNotes(FILE);
  const versions = (seen: string) => unseenReleases(releases, seen).map((r) => r.version);

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
  });

  it('shows nothing on a first visit', () => {
    expect(versions(startingSeenVersion(null, false, '1.2.0'))).toEqual([]);
  });

  it('shows every release to a device that had the app before release notes', () => {
    expect(startingSeenVersion(null, true, '1.2.0')).toBe(BEFORE_RELEASE_NOTES);
    expect(versions(BEFORE_RELEASE_NOTES)).toEqual(['1.2.0', '1.1.1', '1.1.0']);
  });

  it('shows the one release missed, or all of several, newest first', () => {
    expect(versions(startingSeenVersion('1.1.1', true, '1.2.0'))).toEqual(['1.2.0']);
    expect(versions('1.1.0')).toEqual(['1.2.0', '1.1.1']);
  });

  it('shows nothing when a deploy added no new entry', () => {
    expect(versions('1.2.0')).toEqual([]);
  });

  it('ignores a stored value that is not a version', () => {
    expect(startingSeenVersion('garbage', false, '1.2.0')).toBe('1.2.0');
  });

  it('heads each release with its version and date', () => {
    expect(releaseHeading(releases[0]!)).toBe('Version 1.2.0 · Nov 5, 2026');
  });
});
