import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

const REFUSED = '42501';

async function insertRecipe(actor: Actor): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, 'Rated soup')`,
  );
  return id;
}

function rate(actor: Actor, recipeId: string, stars: number, id = randomUUID()) {
  return as(
    actor,
    (tx) => tx`insert into public.recipe_ratings (id, household_id, user_id, recipe_id, stars)
      values (${id}, ${actor.householdId}, ${actor.userId}, ${recipeId}, ${stars})`,
  ).then(() => id);
}

function ratingsSeenBy(actor: Actor) {
  return as(
    actor,
    (tx) =>
      tx<
        { id: string; user_id: string; household_id: string }[]
      >`select id, user_id, household_id from public.recipe_ratings`,
  );
}

async function totalsSeenBy(actor: Actor, recipeId: string) {
  const rows = await as(
    actor,
    (tx) => tx<{ stars_total: number; ratings_count: number; updated_by: string | null }[]>`
      select stars_total, ratings_count, updated_by from public.recipe_rating_totals
      where id = ${recipeId}`,
  );
  return rows[0];
}

describe('recipe ratings (FR-44)', () => {
  it('a viewer rates, changes and clears their own rating', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const recipeId = await insertRecipe(member);
    const id = await rate(viewer, recipeId, 3);
    expect(await totalsSeenBy(viewer, recipeId)).toEqual({
      stars_total: 3,
      ratings_count: 1,
      updated_by: null,
    });
    const changed = await as(
      viewer,
      (tx) => tx`update public.recipe_ratings set stars = 5 where id = ${id} returning id`,
    );
    expect(changed).toHaveLength(1);
    await as(
      viewer,
      (tx) => tx`update public.recipe_ratings set deleted_at = now() where id = ${id}`,
    );
    expect(await totalsSeenBy(member, recipeId)).toMatchObject({
      stars_total: 0,
      ratings_count: 0,
    });
  });

  it('others in the household see only the totals, never who rated or how', async () => {
    const member = await signInAs(SEED.memberA);
    const admin = await signInAs(SEED.adminA);
    const recipeId = await insertRecipe(member);
    const mine = await rate(member, recipeId, 2);
    await rate(admin, recipeId, 5);
    expect((await ratingsSeenBy(admin)).every((row) => row.user_id === admin.userId)).toBe(true);
    expect((await ratingsSeenBy(member)).map((row) => row.id)).toContain(mine);
    expect(await totalsSeenBy(admin, recipeId)).toEqual({
      stars_total: 7,
      ratings_count: 2,
      updated_by: null,
    });
  });

  it("nobody writes or changes someone else's rating", async () => {
    const member = await signInAs(SEED.memberA);
    const admin = await signInAs(SEED.adminA);
    const recipeId = await insertRecipe(member);
    const id = await rate(member, recipeId, 4);
    const forged = await refusalCode(
      as(
        admin,
        (tx) => tx`insert into public.recipe_ratings (id, household_id, user_id, recipe_id, stars)
          values (${randomUUID()}, ${admin.householdId}, ${member.userId}, ${recipeId}, 1)`,
      ),
    );
    expect(forged).toBe(REFUSED);
    const changed = await as(
      admin,
      (tx) => tx`update public.recipe_ratings set stars = 1 where id = ${id} returning id`,
    );
    expect(changed).toHaveLength(0);
    expect(await totalsSeenBy(member, recipeId)).toMatchObject({
      stars_total: 4,
      ratings_count: 1,
    });
  });

  it("nobody reads another household's ratings or totals, or rates its recipes", async () => {
    const memberA = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const recipeA = await insertRecipe(memberA);
    await rate(memberA, recipeA, 5);
    expect(
      (await ratingsSeenBy(adminB)).every((row) => row.household_id === adminB.householdId),
    ).toBe(true);
    expect(await totalsSeenBy(adminB, recipeA)).toBeUndefined();
    expect(await refusalCode(rate(adminB, recipeA, 1))).toBe(REFUSED);
    const intoA = await refusalCode(
      as(
        adminB,
        (tx) => tx`insert into public.recipe_ratings (id, household_id, user_id, recipe_id, stars)
          values (${randomUUID()}, ${memberA.householdId}, ${adminB.userId}, ${recipeA}, 1)`,
      ),
    );
    expect(intoA).toBe(REFUSED);
  });

  it('no client writes the totals or calls the recount', async () => {
    const admin = await signInAs(SEED.adminA);
    const recipeId = await insertRecipe(admin);
    await rate(admin, recipeId, 3);
    expect(
      await refusalCode(
        as(
          admin,
          (tx) =>
            tx`update public.recipe_rating_totals set stars_total = 50 where id = ${recipeId}`,
        ),
      ),
    ).toBe(REFUSED);
    const other = await insertRecipe(admin);
    expect(
      await refusalCode(
        as(
          admin,
          (
            tx,
          ) => tx`insert into public.recipe_rating_totals (id, household_id, stars_total, ratings_count)
            values (${other}, ${admin.householdId}, 50, 10)`,
        ),
      ),
    ).toBe(REFUSED);
    expect(
      await refusalCode(as(admin, (tx) => tx`select public.recount_recipe_ratings(${recipeId})`)),
    ).toBe(REFUSED);
  });

  it('whole stars from 1 to 5, and one row per person and recipe', async () => {
    const fresh = await signInFresh(`rating-unique-${Date.now()}@example.test`);
    const recipeId = await insertRecipe(fresh);
    expect(await refusalCode(rate(fresh, recipeId, 0))).toBe('23514');
    expect(await refusalCode(rate(fresh, recipeId, 6))).toBe('23514');
    await rate(fresh, recipeId, 4);
    expect(await refusalCode(rate(fresh, recipeId, 2))).toBe('23505');
  });

  it('purging a recipe removes its ratings and totals', async () => {
    const member = await signInAs(SEED.memberA);
    const recipeId = await insertRecipe(member);
    await rate(member, recipeId, 4);
    await adminSql`update public.recipes set deleted_at = now() - interval '31 days' where id = ${recipeId}`;
    const purged = await as(
      member,
      (tx) => tx`delete from public.recipes where id = ${recipeId} returning id`,
    );
    expect(purged).toHaveLength(1);
    expect(
      await adminSql`select 1 from public.recipe_ratings where recipe_id = ${recipeId}`,
    ).toHaveLength(0);
    expect(
      await adminSql`select 1 from public.recipe_rating_totals where id = ${recipeId}`,
    ).toHaveLength(0);
  });
});
