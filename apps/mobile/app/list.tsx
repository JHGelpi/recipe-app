import { ShoppingListScreen } from '../src/screens/ShoppingListScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function List() {
  return <SignedIn>{(claims) => <ShoppingListScreen claims={claims} />}</SignedIn>;
}
