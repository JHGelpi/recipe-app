import { Redirect } from 'expo-router';
import { SignInScreen } from '../src/screens/SignInScreen';
import { useResumeAfterSignIn } from '../src/session/useResume';
import { useSession } from '../src/session/SessionProvider';

// An invite or a shared recipe opened while signed out resumes after sign-in.
function Resume() {
  const resume = useResumeAfterSignIn();
  if (resume === undefined) return null;
  return <Redirect href={resume ?? '/'} />;
}

export default function SignIn() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Resume />;
  return <SignInScreen />;
}
