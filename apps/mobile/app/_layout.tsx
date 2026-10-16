import { Slot } from 'expo-router';
import { DatabaseProvider } from '../src/db/DatabaseProvider';
import { DatabaseSessionBridge } from '../src/db/DatabaseSessionBridge';
import { SessionProvider } from '../src/session/SessionProvider';

export default function RootLayout() {
  return (
    <SessionProvider>
      <DatabaseProvider>
        <DatabaseSessionBridge />
        <Slot />
      </DatabaseProvider>
    </SessionProvider>
  );
}
