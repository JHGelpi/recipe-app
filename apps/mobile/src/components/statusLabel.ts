/** "Online · 2 unsynced"; just "Online" while the count is still loading, so it never claims 0. */
export function statusLabel(connected: boolean, pending: number | undefined): string {
  const network = connected ? 'Online' : 'Offline';
  return pending === undefined ? network : `${network} · ${pending} unsynced`;
}
