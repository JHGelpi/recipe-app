import { setGate } from './helpers';

// An interrupted run can leave the sign-up gate on (specs turn it off in
// afterEach), which would refuse every fresh sign-up in the next run.
export default async function setup(): Promise<void> {
  await setGate(false);
}
