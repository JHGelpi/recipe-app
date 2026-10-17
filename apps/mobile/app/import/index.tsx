import { ImportScreen } from '../../src/screens/ImportScreen';
import { SignedIn } from '../../src/session/SignedIn';

export default function Import() {
  return <SignedIn>{(claims) => <ImportScreen claims={claims} />}</SignedIn>;
}
