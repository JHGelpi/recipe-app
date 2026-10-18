import { RecipeListScreen } from '../src/screens/RecipeListScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function Favorites() {
  return <SignedIn>{(claims) => <RecipeListScreen claims={claims} favoritesOnly />}</SignedIn>;
}
