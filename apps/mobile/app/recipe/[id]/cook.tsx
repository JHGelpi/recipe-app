import { useLocalSearchParams } from 'expo-router';
import { CookScreen } from '../../../src/screens/CookScreen';
import { SignedIn } from '../../../src/session/SignedIn';

export default function Cook() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SignedIn>{(claims) => <CookScreen claims={claims} id={String(id)} />}</SignedIn>;
}
