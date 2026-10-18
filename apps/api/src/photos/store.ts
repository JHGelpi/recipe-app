import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isGuid } from '../ids';

/** Photo bytes by household and id (spec §4). An S3-style adapter can replace the disk one. */
export type PhotoStore = {
  put(householdId: string, id: string, bytes: Uint8Array): Promise<void>;
  read(householdId: string, id: string): Promise<Uint8Array | null>;
  remove(householdId: string, id: string): Promise<void>;
  move(fromHousehold: string, toHousehold: string, id: string): Promise<void>;
  /** False when the source file is missing. */
  copy(fromHousehold: string, fromId: string, toHousehold: string, toId: string): Promise<boolean>;
};

function pathOf(root: string, householdId: string, id: string): string {
  // Only ids already validated reach here; this keeps a bad one off the disk.
  if (!isGuid(householdId) || !isGuid(id)) throw new Error('Photo paths are built from UUIDs only');
  return join(root, householdId.toLowerCase(), `${id.toLowerCase()}.jpg`);
}

/** Files at <root>/<household_id>/<id>.jpg on the API's volume (ADR-0013). */
export function createDiskPhotoStore(root: string): PhotoStore {
  return {
    async put(householdId, id, bytes) {
      const target = pathOf(root, householdId, id);
      await mkdir(dirname(target), { recursive: true });
      // Written aside and renamed, so a half-written file is never served.
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, target);
    },
    async read(householdId, id) {
      try {
        return new Uint8Array(await readFile(pathOf(root, householdId, id)));
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null;
        throw error;
      }
    },
    async move(fromHousehold, toHousehold, id) {
      const target = pathOf(root, toHousehold, id);
      await mkdir(dirname(target), { recursive: true });
      try {
        await rename(pathOf(root, fromHousehold, id), target);
      } catch (error) {
        // Never uploaded, or already moved: nothing to do.
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
    },
    async copy(fromHousehold, fromId, toHousehold, toId) {
      let bytes: Buffer;
      try {
        bytes = await readFile(pathOf(root, fromHousehold, fromId));
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return false;
        throw error;
      }
      const target = pathOf(root, toHousehold, toId);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, target);
      return true;
    },
    async remove(householdId, id) {
      await rm(pathOf(root, householdId, id), { force: true });
    },
  };
}
