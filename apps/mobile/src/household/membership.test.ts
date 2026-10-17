import { expect, it } from 'vitest';
import { membershipAction } from './membership';

const claims = { householdId: 'h-a', role: 'member' };

it('refreshes the token when the synced membership disagrees with it', () => {
  expect(membershipAction({ household_id: 'h-b', role: 'member' }, claims)).toBe('refresh');
  expect(membershipAction({ household_id: 'h-a', role: 'viewer' }, claims)).toBe('refresh');
});

it('does nothing when they agree, or before the row has synced', () => {
  expect(membershipAction({ household_id: 'h-a', role: 'member' }, claims)).toBe('none');
  expect(membershipAction(undefined, claims)).toBe('none');
});
