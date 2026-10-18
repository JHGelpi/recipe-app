import { Redirect } from 'expo-router';
import { SignInScreen } from '../src/screens/SignInScreen';
import { resumeAfterSignIn } from '../src/session/resume';
import { useSession } from '../src/session/SessionProvider';

export default function SignIn() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  // An invite or a shared recipe opened while signed out resumes after sign-in.
  if (state.status === 'signedIn') return <Redirect href={resumeAfterSignIn() ?? '/'} />;
  return <SignInScreen />;
}
