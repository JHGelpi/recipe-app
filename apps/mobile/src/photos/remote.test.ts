import { describe, expect, it, vi } from 'vitest';
import { createRemoteStorage, PermanentPhotoError, photoErrorHandler } from './remote';

const attachment = { id: 'p1', filename: 'p1.jpg', state: 0 } as never;

function remote(status: number, body: BodyInit | null = null) {
  const fetch = vi.fn().mockResolvedValue(new Response(body, { status }));
  const storage = createRemoteStorage({ fetch, apiUrl: '/api', token: async () => 'jwt' });
  return { fetch, storage };
}

describe('photo remote storage', () => {
  it('uploads a file with the session token', async () => {
    const { fetch, storage } = remote(204);
    await storage.uploadFile(new ArrayBuffer(3), attachment);
    expect(fetch).toHaveBeenCalledWith('/api/photos/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer jwt' },
      body: expect.any(ArrayBuffer),
    });
  });

  it('treats a refused or dismissed photo as final, and anything else as worth retrying', async () => {
    for (const status of [403, 410, 413, 415, 422]) {
      await expect(
        remote(status).storage.uploadFile(new ArrayBuffer(1), attachment),
      ).rejects.toBeInstanceOf(PermanentPhotoError);
    }
    for (const status of [401, 404, 500]) {
      const error = await remote(status)
        .storage.uploadFile(new ArrayBuffer(1), attachment)
        .catch((e) => e);
      expect(error).not.toBeInstanceOf(PermanentPhotoError);
    }
    expect(await photoErrorHandler.onUploadError(attachment, new PermanentPhotoError('x'))).toBe(
      false,
    );
    expect(await photoErrorHandler.onUploadError(attachment, new Error('offline'))).toBe(true);
  });

  it('downloads a file, and never deletes from the server', async () => {
    const { fetch, storage } = remote(200, new Uint8Array([1, 2]));
    expect(new Uint8Array(await storage.downloadFile(attachment))).toEqual(new Uint8Array([1, 2]));
    await storage.deleteFile(attachment);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not call the server when signed out', async () => {
    const fetch = vi.fn();
    const storage = createRemoteStorage({ fetch, apiUrl: '/api', token: async () => null });
    await expect(storage.uploadFile(new ArrayBuffer(1), attachment)).rejects.toThrow('signed out');
    expect(fetch).not.toHaveBeenCalled();
  });
});
