import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

const REFUSED = '42501';
const FOREIGN_KEY = '23503';
const RECIPE_A = '00000000-0000-0000-0000-0000000000c1';
const RECIPE_B = '00000000-0000-0000-0000-0000000000c2';

function insert(actor: Actor, recipeId: string) {
  const row = {
    id: randomUUID(),
    household_id: actor.householdId,
    recipe_id: recipeId,
    ingredient_id: randomUUID(),
    ingredient_raw: '1 cup buttermilk',
    note: 'Nothing works',
  };
  return {
    id: row.id,
    run: as(
      actor,
      (tx) => tx`
      insert into public.substitutions (id, household_id, recipe_id, ingredient_id, ingredient_raw, options, note)
      values (${row.id}, ${row.household_id}, ${row.recipe_id}, ${row.ingredient_id},
              ${row.ingredient_raw}, ${tx.json([])}, ${row.note})`,
    ),
  };
}

describe('substitutions RLS', () => {
  it('a member saves an answer; the other household cannot read or change it', async () => {
    const member = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const row = insert(member, RECIPE_A);
    await row.run;
    const seen = await as(
      adminB,
      (tx) => tx`select id from public.substitutions where id = ${row.id}`,
    );
    const changed = await as(
      adminB,
      (tx) => tx`update public.substitutions set note = 'x' where id = ${row.id} returning id`,
    );
    expect([seen.length, changed.length]).toEqual([0, 0]);
  });

  it('a viewer cannot change a remembered answer (spec §3)', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const row = insert(member, RECIPE_A);
    await row.run;
    const changed = await as(
      viewer,
      (tx) => tx`update public.substitutions set note = 'x' where id = ${row.id} returning id`,
    );
    expect(changed).toHaveLength(0);
  });

  it('refuses a viewer, and an answer for another household’s recipe', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const adminA = await signInAs(SEED.adminA);
    expect(await refusalCode(insert(viewer, RECIPE_A).run)).toBe(REFUSED);
    expect(await refusalCode(insert(adminA, RECIPE_B).run)).toBe(FOREIGN_KEY);
  });

  it('goes with its recipe when the trash purge removes it', async () => {
    const member = await signInAs(SEED.memberA);
    const recipeId = randomUUID();
    await as(
      member,
      (tx) => tx`insert into public.recipes (id, household_id, title)
                                values (${recipeId}, ${member.householdId}, 'Old cake')`,
    );
    const row = insert(member, recipeId);
    await row.run;
    await adminSql`update public.recipes set deleted_at = now() - interval '31 days' where id = ${recipeId}`;
    await as(member, (tx) => tx`delete from public.recipes where id = ${recipeId}`);
    expect(await adminSql`select id from public.substitutions where id = ${row.id}`).toHaveLength(
      0,
    );
  });
});
