import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { as, refusalCode } from '../helpers/db';

const REFUSED = '42501';

async function insertRecipe(actor: Actor): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, 'Fav soup')`,
  );
  return id;
}

function star(actor: Actor, recipeId: string, id = randomUUID()) {
  return as(
    actor,
    (tx) => tx`insert into public.favorites (id, household_id, user_id, recipe_id)
      values (${id}, ${actor.householdId}, ${actor.userId}, ${recipeId})`,
  ).then(() => id);
}

async function favoritesOf(actor: Actor) {
  return as(
    actor,
    (tx) => tx<{ id: string; user_id: string }[]>`select id, user_id from public.favorites`,
  );
}

describe('favorites', () => {
  it('a user reads and un-stars their own favorite', async () => {
    const member = await signInAs(SEED.memberA);
    const recipeId = await insertRecipe(member);
    const id = await star(member, recipeId);
    expect((await favoritesOf(member)).map((row) => row.id)).toContain(id);
    const updated = await as(
      member,
      (tx) => tx`update public.favorites set deleted_at = now() where id = ${id} returning id`,
    );
    expect(updated).toHaveLength(1);
  });

  it('a viewer can star a household recipe', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const recipeId = await insertRecipe(member);
    expect(await refusalCode(star(viewer, recipeId))).toBeUndefined();
  });

  it('another user in the same household neither sees nor changes my favorites', async () => {
    const member = await signInAs(SEED.memberA);
    const admin = await signInAs(SEED.adminA);
    const recipeId = await insertRecipe(member);
    const id = await star(member, recipeId);
    expect((await favoritesOf(admin)).map((row) => row.id)).not.toContain(id);
    const updated = await as(
      admin,
      (tx) => tx`update public.favorites set deleted_at = now() where id = ${id} returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it('a user cannot write a favorite for someone else', async () => {
    const member = await signInAs(SEED.memberA);
    const admin = await signInAs(SEED.adminA);
    const recipeId = await insertRecipe(member);
    const code = await refusalCode(
      as(
        member,
        (tx) => tx`insert into public.favorites (id, household_id, user_id, recipe_id)
          values (${randomUUID()}, ${member.householdId}, ${admin.userId}, ${recipeId})`,
      ),
    );
    expect(code).toBe(REFUSED);
  });

  it('nobody can favorite another household recipe or read its favorites', async () => {
    const memberA = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const recipeA = await insertRecipe(memberA);
    await star(memberA, recipeA);
    expect(await refusalCode(star(adminB, recipeA))).toBe(REFUSED);
    const seen = await favoritesOf(adminB);
    expect(seen.every((row) => row.user_id === adminB.userId)).toBe(true);
  });

  it('one favorite row per user and recipe', async () => {
    const fresh = await signInFresh(`fav-unique-${Date.now()}@example.test`);
    const recipeId = await insertRecipe(fresh);
    await star(fresh, recipeId);
    const code = await refusalCode(star(fresh, recipeId));
    expect(code).toBe('23505');
  });
});
