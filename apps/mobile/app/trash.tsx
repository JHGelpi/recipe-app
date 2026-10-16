import { TrashScreen } from '../src/screens/TrashScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function Trash() {
  return <SignedIn>{(claims) => <TrashScreen claims={claims} />}</SignedIn>;
}
