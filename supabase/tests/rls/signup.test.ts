import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { signInFresh } from '../helpers/auth';

it('a new sign-up gets a household, an admin membership, and both claims (FR-2)', async () => {
  const local = `signup-${randomUUID()}`;
  const actor = await signInFresh(`${local}@example.test`);

  expect(actor.role).toBe('admin');
  expect(actor.householdId).toMatch(/^[0-9a-f-]{36}$/);

  const households = await actor.client.from('households').select('id, name');
  expect(households.error).toBeNull();
  expect(households.data).toEqual([{ id: actor.householdId, name: `${local} household` }]);

  const memberships = await actor.client.from('memberships').select('user_id, role');
  expect(memberships.data).toEqual([{ user_id: actor.userId, role: 'admin' }]);

  const recipes = await actor.client.from('recipes').select('id');
  expect(recipes.data).toEqual([]);
});
