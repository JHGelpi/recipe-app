import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { colors, space } from '../theme';
import { Banner, Button } from '../ui';
import type { Claims } from './claims';
import { useSession } from './SessionProvider';

/** Renders its children only for a signed-in user with a household. */
export function SignedIn({ children }: { children: (claims: Claims) => ReactNode }) {
  const { state, signOut } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') return <Redirect href="/sign-in" />;
  if (state.claims === null) {
    return (
      <View style={{ flex: 1, padding: space.lg, gap: space.md, backgroundColor: colors.bg }}>
        <Banner tone="danger" role="alert">
          Your account is not linked to a household. Sign out and back in; if this continues,
          contact your household admin.
        </Banner>
        <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
      </View>
    );
  }
  return <>{children(state.claims)}</>;
}
