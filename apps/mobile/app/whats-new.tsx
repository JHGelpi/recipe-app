import { WhatsNewScreen } from '../src/screens/WhatsNewScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function WhatsNew() {
  return <SignedIn>{() => <WhatsNewScreen />}</SignedIn>;
}
