import { FeedbackScreen } from '../src/screens/FeedbackScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function Feedback() {
  return <SignedIn>{(claims) => <FeedbackScreen claims={claims} />}</SignedIn>;
}
