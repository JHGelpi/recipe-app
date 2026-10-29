import { useFonts } from 'expo-font';
import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { DatabaseProvider } from '../src/db/DatabaseProvider';
import { DatabaseSessionBridge } from '../src/db/DatabaseSessionBridge';
import { startOfflineTracking } from '../src/feedback/offline';
import { TabBar } from '../src/navigation/TabBar';
import { registerServiceWorker } from '../src/pwa/serviceWorker';
import { UpdateBanner } from '../src/pwa/UpdateBanner';
import { SessionProvider } from '../src/session/SessionProvider';
import { dropLegacySettings } from '../src/settings/cache';
import { settingsStorage } from '../src/settings/start';
import { AppearanceSync, colors, installTheme } from '../src/theme';
import { FONT_FILES } from '../src/theme/fonts';
import { IONICONS_FONT } from '../src/ui/Icon';

// The color variables must exist before anything renders with them (ADR-0020).
installTheme();
// ADR-0031: the device settings of before are not carried over.
dropLegacySettings(settingsStorage());
// FR-45: problem reports say whether the device was offline lately.
startOfflineTracking();

export default function RootLayout() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  // Not awaited: text shows in the system font until these arrive.
  useFonts({ ...FONT_FILES, ionicons: IONICONS_FONT });

  return (
    <SessionProvider>
      <AppearanceSync />
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
