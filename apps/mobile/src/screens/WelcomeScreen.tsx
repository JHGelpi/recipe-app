import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { config } from '../config';
import { setPendingFriend } from '../session/pendingFriend';
import { useSession } from '../session/SessionProvider';
import { FRIEND_LINK_ENDED, friendLinkStatus } from '../session/signupPass';
import { SignInScreen } from './SignInScreen';

/** FR-6: a friend link. Signed out, it is sign-in with a pass to make an account. */
export function WelcomeScreen({ code }: { code: string }) {
  const { state } = useSession();
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (state.status !== 'signedOut') return;
    let live = true;
    void friendLinkStatus(code, {
      fetch: (input, init) => fetch(input, init),
      apiUrl: config.apiUrl,
    }).then((status) => {
      if (!live) return;
      // Kept either way, so a new email through an ended link reads "expired",
      // not "invite-only".
      setPendingFriend(code);
      if (status === 'ended') setEnded(true);
    });
    return () => {
      live = false;
    };
  }, [state.status, code]);
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Redirect href="/" />;
  return (
    <SignInScreen
      intro={ended ? FRIEND_LINK_ENDED : 'Someone invited you to make your own recipe collection.'}
    />
  );
}
