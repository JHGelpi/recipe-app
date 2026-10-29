import { parseReleaseNotes } from '@recipe-app/domain';
import { RELEASE_NOTES_TEXT } from './releaseNotesText';

/** FR-47: every release, newest first, bundled so it works offline. CI checks the file parses. */
export const RELEASES = parseReleaseNotes(RELEASE_NOTES_TEXT);

/** The newest release's number: the app version, set only in RELEASE_NOTES.md. */
export const APP_VERSION = RELEASES[0]!.version;
