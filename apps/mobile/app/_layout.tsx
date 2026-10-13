import { Slot } from 'expo-router';
import { DatabaseProvider } from '../src/db/DatabaseProvider';

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <Slot />
    </DatabaseProvider>
  );
}
