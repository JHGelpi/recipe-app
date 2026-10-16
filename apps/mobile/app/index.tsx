import { RecipeListScreen } from '../src/screens/RecipeListScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function Home() {
  return <SignedIn>{(claims) => <RecipeListScreen claims={claims} />}</SignedIn>;
}
