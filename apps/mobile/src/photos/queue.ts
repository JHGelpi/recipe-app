import {
  AttachmentQueue,
  IndexDBFileSystemStorageAdapter,
  type AbstractPowerSyncDatabase,
} from '@powersync/web';
import { config } from '../config';
import { auth } from '../session/auth';
import { PHOTO_CACHE } from './load';
import { bumpPhotoGeneration, createRemoteStorage, photoErrorHandler } from './remote';
import type { PhotoSaver } from './repository';
import { DISH_PHOTOS_SQL, watchedPhotos } from './watch';

// ADR-0013: PowerSync's attachment queue is experimental, so only this module
// touches its API. The rest of the app sees photoSaver, readLocalPhoto and
// start / stop / clear.
const STORE = 'recipe-photos';
type Entry = {
  db: AbstractPowerSyncDatabase;
  queue: AttachmentQueue;
  started: boolean;
  /** The file store, opened once per queue (each initialize() opens IndexedDB again). */
  opened: Promise<void> | null;
};
let entry: Entry | null = null;

async function token(): Promise<string | null> {
  const { data } = await auth.getSession();
  return data.session?.access_token ?? null;
}

function current(db: AbstractPowerSyncDatabase): Entry {
  if (entry?.db !== db) {
    const queue = new AttachmentQueue({
      db,
      localStorage: new IndexDBFileSystemStorageAdapter(STORE),
      remoteStorage: createRemoteStorage({
        fetch: (input, init) => fetch(input, init),
        apiUrl: config.apiUrl,
        token,
      }),
      errorHandler: photoErrorHandler,
      watchAttachments: (onUpdate, signal) => {
        db.watch(
          DISH_PHOTOS_SQL,
          [],
          {
            onResult: (result) => {
              void onUpdate(watchedPhotos((result.rows?._array ?? []) as { id: unknown }[]));
            },
          },
          { signal },
        );
      },
    });
    entry = { db, queue, started: false, opened: null };
  }
  return entry;
}

function opened(e: Entry): Promise<void> {
  e.opened ??= e.queue.localStorage.initialize();
  return e.opened;
}

/** Uploads waiting files and downloads dish photos while signed in. */
export async function startPhotos(db: AbstractPowerSyncDatabase): Promise<void> {
  const e = current(db);
  if (e.started) return;
  e.started = true;
  await e.queue.startSync();
}

export async function stopPhotos(db: AbstractPowerSyncDatabase): Promise<void> {
  if (!entry || entry.db !== db || !entry.started) return;
  entry.started = false;
  await entry.queue.stopSync();
}

/** On sign-out or a different user: no photo of this household stays in the browser. */
export async function clearPhotos(db: AbstractPowerSyncDatabase): Promise<void> {
  bumpPhotoGeneration();
  await stopPhotos(db);
  const e = current(db);
  // A fresh page load has not opened the file store yet; clear needs it open.
  await opened(e);
  await e.queue.clearQueue();
  e.opened = null;
  await globalThis.caches?.delete(PHOTO_CACHE);
}

export function photoSaver(db: AbstractPowerSyncDatabase): PhotoSaver {
  const e = current(db);
  const { queue } = e;
  return {
    async save(id, data, write) {
      await opened(e);
      await queue.saveFile({
        id,
        data,
        fileExtension: 'jpg',
        mediaType: 'image/jpeg',
        updateHook: (tx) => write(tx),
      });
    },
  };
}

export async function readLocalPhoto(
  db: AbstractPowerSyncDatabase,
  localUri: string,
): Promise<Blob> {
  const e = current(db);
  await opened(e);
  return new Blob([await e.queue.localStorage.readFile(localUri)], { type: 'image/jpeg' });
}
