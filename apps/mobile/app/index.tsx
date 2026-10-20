import { Redirect } from 'expo-router';
import { RecipeListScreen } from '../src/screens/RecipeListScreen';
import type { Claims } from '../src/session/claims';
import { useResumeAfterSignIn } from '../src/session/useResume';
import { SignedIn } from '../src/session/SignedIn';

// Signing in remounts the router once the local database is ready, which
// lands here rather than on the sign-in route, so the resume is checked here too.
function Home({ claims }: { claims: Claims }) {
  const resume = useResumeAfterSignIn();
  if (resume === undefined) return null;
  if (resume) return <Redirect href={resume} />;
  return <RecipeListScreen claims={claims} />;
}

export default function Index() {
  return <SignedIn>{(claims) => <Home claims={claims} />}</SignedIn>;
}
