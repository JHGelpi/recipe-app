import { useLocalSearchParams } from 'expo-router';
import { SharedRecipeScreen } from '../../src/screens/SharedRecipeScreen';

// Not wrapped in SignedIn: anyone with the link may read it (FR-27).
export default function Shared() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <SharedRecipeScreen code={String(code)} />;
}
