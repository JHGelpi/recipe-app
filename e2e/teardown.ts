// Printed after every e2e run: test:e2e leaves the stack on the fake AI.
export default function teardown(): void {
  console.log('\nThe stack is in test mode (fake AI). Run `pnpm dev:backend` to switch back.\n');
}
