import { Redirect } from 'expo-router';
import { RecipeListScreen } from '../src/screens/RecipeListScreen';
import { useSession } from '../src/session/SessionProvider';

export default function Home() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') return <Redirect href="/sign-in" />;
  return <RecipeListScreen claims={state.claims} />;
}
