import {
  createConsoleLogger,
  PowerSyncDatabase,
  WASQLiteOpenFactory,
  WASQLiteVFS,
} from '@powersync/web';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { AppSchema } from './schema';

// Prebuilt worker copied into public/ by `pnpm run copy-assets`.
const WORKER = '/@powersync/worker.js';

const logger = createConsoleLogger();

export function openDatabase(): AbstractPowerSyncDatabase {
  const factory = new WASQLiteOpenFactory({
    logger,
    // PowerSync recommends OPFSCoopSyncVFS for Safari/iOS; using it on every
    // browser means the Chromium e2e suite tests what the phone runs.
    // The SDK switches to dedicated workers, which this VFS requires.
    open: { dbFilename: 'recipes.db', worker: WORKER, vfs: WASQLiteVFS.OPFSCoopSyncVFS },
  });
  return new PowerSyncDatabase({
    schema: AppSchema,
    factory,
    sync: { worker: WORKER },
    logger,
  });
}
