type Queue = { getUploadQueueStats(): Promise<{ count: number }> };

/**
 * True once this phone's queued changes have reached the server; false if
 * they haven't within the wait (30 s by default). Joining or leaving a
 * household wipes the local data, so it must not start before this.
 */
export async function waitForUploads(
  db: Queue,
  { tries = 60, pauseMs = 500 }: { tries?: number; pauseMs?: number } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if ((await db.getUploadQueueStats()).count === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return false;
}
