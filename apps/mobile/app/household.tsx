import { HouseholdScreen } from '../src/screens/HouseholdScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function Household() {
  return <SignedIn>{(claims) => <HouseholdScreen claims={claims} />}</SignedIn>;
}
