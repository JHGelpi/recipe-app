import { useEffect, useState } from 'react';

// Web only for now: the browser's online/offline events. React Native has a
// `window` without these events, so there this always reports online; native
// builds need NetInfo here.
const hasEvents = typeof window !== 'undefined' && typeof window.addEventListener === 'function';

function currentlyOnline(): boolean {
  return !hasEvents || typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Whether the device reports a network connection. */
export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(currentlyOnline);

  useEffect(() => {
    if (!hasEvents) return;
    const update = () => setOnline(currentlyOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
