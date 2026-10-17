import { useLocalSearchParams } from 'expo-router';
import { PhotoScreen } from '../../src/screens/PhotoScreen';
import { SignedIn } from '../../src/session/SignedIn';

export default function Photo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SignedIn>{() => <PhotoScreen id={String(id)} />}</SignedIn>;
}
