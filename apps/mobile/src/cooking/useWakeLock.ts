import { useEffect, useState } from 'react';

type Sentinel = { release(): Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };

/**
 * FR-21: keeps the screen on while `active`. The browser drops the lock
 * when the page is hidden, so it is asked for again on return.
 */
export function useWakeLock(active: boolean): 'on' | 'unsupported' {
  const [state, setState] = useState<'on' | 'unsupported'>('on');
  useEffect(() => {
    const wakeLock = (globalThis.navigator as WakeLockNavigator | undefined)?.wakeLock;
    if (!active) return;
    if (!wakeLock) {
      setState('unsupported');
      return;
    }
    let sentinel: Sentinel | null = null;
    let live = true;
    const request = () => {
      if (document.visibilityState !== 'visible') return;
      wakeLock.request('screen').then(
        (held) => {
          if (live) sentinel = held;
          else void held.release();
          setState('on');
        },
        () => setState('unsupported'),
      );
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', request);
      void sentinel?.release();
    };
  }, [active]);
  return state;
}
