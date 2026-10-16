import { useLocalSearchParams } from 'expo-router';
import { EditRecipeScreen } from '../../../src/screens/EditRecipeScreen';
import { SignedIn } from '../../../src/session/SignedIn';

export default function EditRecipe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SignedIn>{(claims) => <EditRecipeScreen claims={claims} id={String(id)} />}</SignedIn>;
}
