import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { DatabaseProvider } from '../src/db/DatabaseProvider';
import { DatabaseSessionBridge } from '../src/db/DatabaseSessionBridge';
import { registerServiceWorker } from '../src/pwa/serviceWorker';
import { UpdateBanner } from '../src/pwa/UpdateBanner';
import { SessionProvider } from '../src/session/SessionProvider';

export default function RootLayout() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return (
    <SessionProvider>
      <DatabaseProvider>
        <DatabaseSessionBridge />
        <UpdateBanner />
        <Slot />
      </DatabaseProvider>
    </SessionProvider>
  );
}
