import { useLocalSearchParams } from 'expo-router';
import { WelcomeScreen } from '../../src/screens/WelcomeScreen';

// Not wrapped in SignedIn: the visitor has no account yet.
export default function Welcome() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <WelcomeScreen code={String(code)} />;
}
