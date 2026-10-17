import { useLocalSearchParams } from 'expo-router';
import { ReviewImportScreen } from '../../src/screens/ReviewImportScreen';
import { SignedIn } from '../../src/session/SignedIn';

export default function ReviewImport() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SignedIn>{(claims) => <ReviewImportScreen claims={claims} id={String(id)} />}</SignedIn>;
}
