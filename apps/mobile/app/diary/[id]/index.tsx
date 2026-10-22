import { useLocalSearchParams } from 'expo-router';
import { CookEntryScreen } from '../../../src/screens/CookEntryScreen';
import { SignedIn } from '../../../src/session/SignedIn';

export default function DiaryEntry() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SignedIn>{(claims) => <CookEntryScreen claims={claims} id={String(id)} />}</SignedIn>;
}
