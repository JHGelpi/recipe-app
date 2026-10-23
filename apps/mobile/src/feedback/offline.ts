/**
 * FR-45: whether this device was offline at any point lately, for problem
 * reports. Started once when the app loads; an "offline" or "online" event
 * both mark a moment the connection was down.
 */
let lastOffline: number | null = null;
let started = false;

export function startOfflineTracking(now: () => number = Date.now): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (navigator.onLine === false) lastOffline = now();
  const mark = () => {
    lastOffline = now();
  };
  window.addEventListener('offline', mark);
  // Coming back online is the end of a stretch offline.
  window.addEventListener('online', mark);
}

/** True when offline now, or at any point in the last `ms`. */
export function offlineWithin(
  ms: number,
  now: number = Date.now(),
  onLine: boolean = typeof navigator === 'undefined' || navigator.onLine !== false,
): boolean {
  if (!onLine) return true;
  return lastOffline !== null && now - lastOffline <= ms;
}

/** Tests only. */
export function resetOfflineTracking(): void {
  lastOffline = null;
  started = false;
}
