import { useLocalSearchParams } from 'expo-router';
import { RecipeScreen } from '../../../src/screens/RecipeScreen';
import { SignedIn } from '../../../src/session/SignedIn';

export default function Recipe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SignedIn>{(claims) => <RecipeScreen claims={claims} id={String(id)} />}</SignedIn>;
}
