import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { config } from '../config';
import { setPendingFriend } from '../session/pendingFriend';
import { useSession } from '../session/SessionProvider';
import { FRIEND_LINK_ENDED, FRIEND_LINK_USED, friendLinkStatus } from '../session/signupPass';
import { SignInScreen } from './SignInScreen';

/** FR-6: a friend link. Signed out, it is sign-in with a pass to make an account. */
export function WelcomeScreen({ code }: { code: string }) {
  const { state } = useSession();
  const [ended, setEnded] = useState<'ended' | 'used' | null>(null);
  useEffect(() => {
    if (state.status !== 'signedOut') return;
    // Kept at once, ended or not: a slow check must not leave an email
    // typed meanwhile without its link, and through an ended link a new
    // email reads "expired", not "invite-only".
    setPendingFriend(code);
    let live = true;
    void friendLinkStatus(code, {
      fetch: (input, init) => fetch(input, init),
      apiUrl: config.apiUrl,
    }).then((status) => {
      if (live && status !== 'live') setEnded(status);
    });
    return () => {
      live = false;
    };
  }, [state.status, code]);
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Redirect href="/" />;
  return (
    <SignInScreen
      intro={
        ended === 'used'
          ? FRIEND_LINK_USED
          : ended === 'ended'
            ? FRIEND_LINK_ENDED
            : 'Someone invited you to make your own recipe collection.'
      }
    />
  );
}
