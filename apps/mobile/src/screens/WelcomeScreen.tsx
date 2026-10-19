import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { setPendingFriend } from '../session/pendingFriend';
import { useSession } from '../session/SessionProvider';
import { SignInScreen } from './SignInScreen';

/** FR-6: a friend link. Signed out, it is sign-in with a pass to make an account. */
export function WelcomeScreen({ code }: { code: string }) {
  const { state } = useSession();
  useEffect(() => {
    if (state.status === 'signedOut') setPendingFriend(code);
  }, [state.status, code]);
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Redirect href="/" />;
  return <SignInScreen intro="Someone invited you to make your own recipe collection." />;
}
