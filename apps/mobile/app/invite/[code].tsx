import { useLocalSearchParams } from 'expo-router';
import { InviteScreen } from '../../src/screens/InviteScreen';

// Not wrapped in SignedIn: a signed-out visitor sees the invite prompt first.
export default function Invite() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <InviteScreen code={String(code)} />;
}
