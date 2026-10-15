import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { signInFresh } from '../../../../test-support/auth';
import { as } from '../helpers/db';

it('a new sign-up gets a household, an admin membership, and both claims (FR-2)', async () => {
  const local = `signup-${randomUUID()}`;
  const actor = await signInFresh(`${local}@example.test`);

  expect(actor.role).toBe('admin');
  expect(actor.householdId).toMatch(/^[0-9a-f-]{36}$/);

  const households = await as(actor, (tx) => tx`select id, name from public.households`);
  expect([...households]).toEqual([{ id: actor.householdId, name: `${local} household` }]);

  const memberships = await as(actor, (tx) => tx`select user_id, role from public.memberships`);
  expect([...memberships]).toEqual([{ user_id: actor.userId, role: 'admin' }]);

  expect(await as(actor, (tx) => tx`select id from public.recipes`)).toHaveLength(0);
});
