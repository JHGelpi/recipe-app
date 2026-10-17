import type {
  AttachmentErrorHandler,
  AttachmentRecord,
  RemoteStorageAdapter,
} from '@powersync/web';

/** The server will never take this file (refused, too big, or dismissed meanwhile). */
export class PermanentPhotoError extends Error {}

export type RemoteDeps = {
  fetch: typeof fetch;
  apiUrl: string;
  token: () => Promise<string | null>;
};

// 410: the photo was dismissed while uploading (Review Focus 2).
const FINAL = new Set([403, 410, 413, 415, 422]);

/** PowerSync's attachment queue talks to PUT and GET /api/photos/:id through this. */
export function createRemoteStorage(deps: RemoteDeps): RemoteStorageAdapter {
  async function call(id: string, init: RequestInit & { headers: Record<string, string> }) {
    const token = await deps.token();
    if (!token) throw new Error('signed out');
    const response = await deps.fetch(`${deps.apiUrl}/photos/${encodeURIComponent(id)}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (FINAL.has(response.status))
      throw new PermanentPhotoError(`photo ${id}: ${response.status}`);
    // 401 (token refreshing), 404 (row not uploaded yet), 5xx: the queue retries.
    if (!response.ok) throw new Error(`photo ${id}: ${response.status}`);
    return response;
  }
  return {
    async uploadFile(data: ArrayBuffer, attachment: AttachmentRecord) {
      await call(attachment.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: data,
      });
    },
    async downloadFile(attachment: AttachmentRecord) {
      return (await call(attachment.id, { method: 'GET', headers: {} })).arrayBuffer();
    },
    async deleteFile() {
      // Never from a phone: the server's 30-day purge removes files (spec §4).
    },
  };
}

export const photoErrorHandler: AttachmentErrorHandler = {
  onUploadError: async (_attachment, error) => !(error instanceof PermanentPhotoError),
  onDownloadError: async (_attachment, error) => !(error instanceof PermanentPhotoError),
  onDeleteError: async () => false,
};
