import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Claims } from './claims';
import { useSession } from './SessionProvider';

/** Renders its children only for a signed-in user with a household. */
export function SignedIn({ children }: { children: (claims: Claims) => ReactNode }) {
  const { state, signOut } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') return <Redirect href="/sign-in" />;
  if (state.claims === null) {
    return (
      <View style={{ padding: 16, gap: 12, maxWidth: 640 }}>
        <Text role="alert">
          Your account is not linked to a household. Sign out and back in; if this continues,
          contact your household admin.
        </Text>
        <Pressable role="button" onPress={() => void signOut()}>
          <Text style={{ textDecorationLine: 'underline' }}>Sign out</Text>
        </Pressable>
      </View>
    );
  }
  return <>{children(state.claims)}</>;
}
