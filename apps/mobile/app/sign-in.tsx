import { Redirect } from 'expo-router';
import { takePendingInvite } from '../src/household/pendingInvite';
import { SignInScreen } from '../src/screens/SignInScreen';
import { useSession } from '../src/session/SessionProvider';

export default function SignIn() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') {
    // An invite opened while signed out resumes after sign-in (FR-3).
    const pending = takePendingInvite();
    return <Redirect href={pending ? `/invite/${pending}` : '/'} />;
  }
  return <SignInScreen />;
}
