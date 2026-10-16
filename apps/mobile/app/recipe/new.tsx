import { EditRecipeScreen } from '../../src/screens/EditRecipeScreen';
import { SignedIn } from '../../src/session/SignedIn';

export default function NewRecipe() {
  return <SignedIn>{(claims) => <EditRecipeScreen claims={claims} id={null} />}</SignedIn>;
}
