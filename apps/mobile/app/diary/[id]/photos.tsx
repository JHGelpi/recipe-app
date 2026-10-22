import { useLocalSearchParams } from 'expo-router';
import { CookPhotosScreen } from '../../../src/screens/CookPhotosScreen';
import { SignedIn } from '../../../src/session/SignedIn';

export default function DiaryPhotos() {
  const { id, at } = useLocalSearchParams<{ id: string; at?: string }>();
  return (
    <SignedIn>{() => <CookPhotosScreen entryId={String(id)} start={Number(at) || 0} />}</SignedIn>
  );
}
