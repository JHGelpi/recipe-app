import { createConsoleLogger, PowerSyncDatabase, WASQLiteOpenFactory } from '@powersync/web';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { AppSchema } from './schema';

// Prebuilt worker copied into public/ by `pnpm run copy-assets`.
const WORKER = '/@powersync/worker.js';

const logger = createConsoleLogger();

export function openDatabase(): AbstractPowerSyncDatabase {
  const factory = new WASQLiteOpenFactory({
    logger,
    open: { dbFilename: 'recipes.db', worker: WORKER },
  });
  return new PowerSyncDatabase({
    schema: AppSchema,
    factory,
    sync: { worker: WORKER },
    logger,
  });
}
