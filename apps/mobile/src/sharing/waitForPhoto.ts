type Db = { getAll<T>(sql: string, params: unknown[]): Promise<T[]> };

/**
 * True once the dish photo has reached the server (its synced row carries
 * uploaded_at), or when there is no such row on this phone; false if it
 * hasn't within the wait (60 s by default). A link made before the upload
 * would show no photo (bug batch §4).
 */
export async function waitForPhoto(
  db: Db,
  photoId: string,
  {
    tries = 120,
    pauseMs = 500,
    onWait,
  }: { tries?: number; pauseMs?: number; onWait?: () => void } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const [row] = await db.getAll<{ uploaded_at: string | null }>(
      'select uploaded_at from photos where id = ?',
      [photoId],
    );
    if (!row || row.uploaded_at) return true;
    if (attempt === 0) onWait?.();
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return false;
}
