import type { AbstractPowerSyncDatabase } from '@powersync/web';

// Native builds are not part of the web-first skeleton (ADR-0007).
// Metro resolves database.web.ts on web; this file exists for other platforms
// and for the type checker.
export function openDatabase(): AbstractPowerSyncDatabase {
  throw new Error('The native database is not implemented yet. Run the web target.');
}
