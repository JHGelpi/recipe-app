import { Redirect } from 'expo-router';
import { SignInScreen } from '../src/screens/SignInScreen';
import { useSession } from '../src/session/SessionProvider';

export default function SignIn() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Redirect href="/" />;
  return <SignInScreen />;
}
