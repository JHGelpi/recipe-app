/**
 * FR-47: RELEASE_NOTES.md holds every release, newest first. The newest
 * entry's number is the app version.
 *
 *   ## 1.1.0 · 2026-10-29
 *   - You can now rate recipes 1–5 stars
 */
export type Release = { version: string; date: string; notes: string[] };

export class ReleaseNotesError extends Error {
  constructor(readonly problems: string[]) {
    super(`RELEASE_NOTES.md: ${problems.join('; ')}`);
    this.name = 'ReleaseNotesError';
  }
}

const HEADING = /^## (\d+)\.(\d+)\.(\d+) · (\d{4})-(\d{2})-(\d{2})$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function versionParts(version: string): [number, number, number] {
  const match = VERSION.exec(version);
  if (!match) throw new Error(`Not a version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when a is lower than b, positive when higher, 0 when the same. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [versionParts(a), versionParts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

function realDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Reads the file, refusing anything CI should catch: a malformed line, a
 * version repeated or not higher than the one below it, an invalid date, an
 * entry without bullets. A title and introduction may come before the first
 * release.
 */
export function parseReleaseNotes(text: string): Release[] {
  const releases: Release[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd();
    const where = `line ${index + 1}`;
    if (line.startsWith('## ')) {
      const match = HEADING.exec(line);
      if (!match) {
        problems.push(`${where}: a release heading is "## 1.2.0 · 2026-10-28"`);
        return;
      }
      const [, major, minor, patch, year, month, day] = match.map(Number);
      if (!realDate(year!, month!, day!)) problems.push(`${where}: ${line.slice(3)} is not a date`);
      releases.push({
        version: `${major}.${minor}.${patch}`,
        date: line.slice(-10),
        notes: [],
      });
    } else if (line === '-' || line.startsWith('- ')) {
      const current = releases.at(-1);
      if (!current) problems.push(`${where}: a bullet before the first release`);
      else if (line.slice(2).trim()) current.notes.push(line.slice(2).trim());
      else problems.push(`${where}: an empty bullet`);
    } else if (line.trim() && releases.length > 0) {
      problems.push(`${where}: a release holds only "- " bullets`);
    }
  });
  if (releases.length === 0) problems.push('no releases');
  releases.forEach((release, index) => {
    if (release.notes.length === 0) problems.push(`${release.version} has no bullets`);
    const below = releases[index + 1];
    if (below && compareVersions(release.version, below.version) <= 0) {
      problems.push(
        compareVersions(release.version, below.version) === 0
          ? `${release.version} appears twice`
          : `${release.version} is not higher than ${below.version} below it`,
      );
    }
  });
  if (problems.length) throw new ReleaseNotesError(problems);
  return releases;
}

/**
 * Lower than every release: a device that had the app before FR-47 shipped
 * has seen none of the notes.
 */
export const BEFORE_RELEASE_NOTES = '0.0.0';

/**
 * The version a device has seen notes up to, when it has none stored. A first
 * visit counts the current version as seen, so it shows nothing; a device
 * that already ran the app (a service worker was in control) sees them.
 */
export function startingSeenVersion(
  stored: string | null,
  hadController: boolean,
  current: string,
): string {
  if (stored !== null && VERSION.test(stored)) return stored;
  return hadController ? BEFORE_RELEASE_NOTES : current;
}

/** The releases newer than the one seen, newest first. */
export function unseenReleases(releases: Release[], seen: string): Release[] {
  return releases.filter((release) => compareVersions(release.version, seen) > 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Version 1.2.0 · Oct 28, 2026" */
export function releaseHeading(release: Release): string {
  const [year, month, day] = release.date.split('-').map(Number);
  return `Version ${release.version} · ${MONTHS[month! - 1]} ${day}, ${year}`;
}
