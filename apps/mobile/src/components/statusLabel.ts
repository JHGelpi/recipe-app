/**
 * "Online · 2 unsynced"; just "Online" while the count is still loading, so it
 * never claims 0. Adds why photos are waiting when the household's photo
 * storage is full (#67).
 */
export function statusLabel(
  connected: boolean,
  pending: number | undefined,
  photoStorageFull = false,
): string {
  const network = connected ? 'Online' : 'Offline';
  const label = pending === undefined ? network : `${network} · ${pending} unsynced`;
  return photoStorageFull ? `${label} · Photo storage is full` : label;
}
