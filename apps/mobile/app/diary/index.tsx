import { useLocalSearchParams } from 'expo-router';
import { CookDiaryScreen } from '../../src/screens/CookDiaryScreen';
import { SignedIn } from '../../src/session/SignedIn';

export default function Diary() {
  const { recipe } = useLocalSearchParams<{ recipe?: string }>();
  return (
    <SignedIn>
      {(claims) => <CookDiaryScreen claims={claims} recipeId={recipe ? String(recipe) : null} />}
    </SignedIn>
  );
}
