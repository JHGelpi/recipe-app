import { useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { DatabaseProvider } from '../src/db/DatabaseProvider';
import { DatabaseSessionBridge } from '../src/db/DatabaseSessionBridge';
import { TabBar } from '../src/navigation/TabBar';
import { registerServiceWorker } from '../src/pwa/serviceWorker';
import { UpdateBanner } from '../src/pwa/UpdateBanner';
import { SessionProvider } from '../src/session/SessionProvider';
import { colors } from '../src/theme';
import { FONT_FILES } from '../src/theme/fonts';
import { IONICONS_FONT } from '../src/ui/Icon';

export default function RootLayout() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  // Not awaited: text shows in the system font until these arrive.
  useFonts({ ...FONT_FILES, ionicons: IONICONS_FONT });

  return (
    <SessionProvider>
      <DatabaseProvider>
        <DatabaseSessionBridge>
          <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <UpdateBanner />
            <View style={{ flex: 1 }}>
              <Slot />
            </View>
            <TabBar />
          </View>
        </DatabaseSessionBridge>
      </DatabaseProvider>
    </SessionProvider>
  );
}
