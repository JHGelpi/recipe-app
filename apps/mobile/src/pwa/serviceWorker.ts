// Registers the Workbox-generated worker (ADR-0009) and tracks a new version
// waiting to take over. Uses the browser API directly, so Workbox adds
// nothing to the app at runtime.

export type WorkerLike = EventTarget & {
  state: string;
  postMessage(message: unknown): void;
};

export type RegistrationLike = EventTarget & {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  update(): Promise<unknown>;
};

let waiting: WorkerLike | null = null;
const listeners = new Set<() => void>();

function setWaiting(worker: WorkerLike | null): void {
  waiting = worker;
  listeners.forEach((listener) => listener());
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateReady(): boolean {
  return waiting !== null;
}

export function resetUpdateStateForTests(): void {
  waiting = null;
  listeners.clear();
}

/**
 * Reports a worker that is installed and waiting to replace the one in
 * control. The first install has nothing to replace (no controller), so it
 * is not reported.
 */
export function watchRegistration(
  registration: RegistrationLike,
  hasController: () => boolean,
): void {
  const check = () => {
    if (registration.waiting && hasController()) setWaiting(registration.waiting);
  };
  check();
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') check();
    });
  });
}

/** Activates the waiting worker; the page reloads once it takes control. */
export function applyUpdate(): void {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  // Workbox's generated worker calls skipWaiting() on this message.
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export async function registerServiceWorker(): Promise<void> {
  // Never on the Expo dev server: a cached old bundle would hide new code.
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    watchRegistration(registration, () => navigator.serviceWorker.controller !== null);
    // iOS home-screen apps often resume rather than restart, so check for a
    // new version whenever the app comes back to the front.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => undefined);
      }
    });
  } catch (error) {
    console.error('Service worker registration failed; the app works online only', error);
  }
}
