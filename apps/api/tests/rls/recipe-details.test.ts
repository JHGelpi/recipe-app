import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

async function insertRecipe(actor: Actor, title = 'Detail soup'): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, ${title})`,
  );
  return id;
}

async function trashDaysAgo(id: string, days: number): Promise<void> {
  // Arranged as the superuser: a client can only set deleted_at to "now".
  await adminSql`update public.recipes set deleted_at = now() - make_interval(days => ${days}) where id = ${id}`;
}

async function exists(id: string): Promise<boolean> {
  const rows = await adminSql`select 1 from public.recipes where id = ${id}`;
  return rows.length === 1;
}

function purge(actor: Actor, id: string) {
  return as(
    actor,
    (tx) =>
      tx`delete from public.recipes where id = ${id} and deleted_at < now() - interval '30 days' returning id`,
  );
}

describe('recipe details', () => {
  it('a member stores every new column', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    const ingredients = [{ id: randomUUID(), raw: '1 egg' }];
    await as(
      member,
      (tx) => tx`update public.recipes set servings = 4, prep_minutes = 10, cook_minutes = 20,
        ingredients = ${tx.json(ingredients)}, steps = ${tx.json([{ id: randomUUID(), text: 'Mix' }])},
        tags = ${['quick', 'eggs']}, notes = 'Shared note' where id = ${id}`,
    );
    const [row] = await as(
      member,
      (tx) => tx<{ servings: number; tags: string[]; ingredients: unknown[] }[]>`
        select servings, tags, ingredients from public.recipes where id = ${id}`,
    );
    expect(row?.servings).toBe(4);
    expect(row?.tags).toEqual(['quick', 'eggs']);
    expect(row?.ingredients).toHaveLength(1);
  });

  it('a viewer cannot change the new columns', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const id = await insertRecipe(member);
    const updated = await as(
      viewer,
      (tx) => tx`update public.recipes set notes = 'viewer was here' where id = ${id} returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it.each([
    ['servings = 0', 'servings = 0'],
    ['servings = 1000', 'servings = 1000'],
    ['prep_minutes = -1', 'prep_minutes = -1'],
    ['cook_minutes = 10001', 'cook_minutes = 10001'],
    ['ingredients as an object', `ingredients = '{}'::jsonb`],
    ['steps as a string', `steps = '"mix"'::jsonb`],
    ['201 ingredients', `ingredients = (select jsonb_agg(x) from generate_series(1, 201) x)`],
    ['101 steps', `steps = (select jsonb_agg(x) from generate_series(1, 101) x)`],
    ['31 tags', `tags = (select array_agg(x::text) from generate_series(1, 31) x)`],
    ['notes over 10000', `notes = repeat('a', 10001)`],
  ])('the database refuses %s', async (_label, assignment) => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    const code = await refusalCode(
      as(member, (tx) => tx.unsafe(`update public.recipes set ${assignment} where id = $1`, [id])),
    );
    expect(code?.startsWith('2')).toBe(true);
  });
});

describe('trash purge policy', () => {
  it.each([SEED.adminA, SEED.memberA])(
    '%s purges household trash older than 30 days',
    async (email) => {
      const member = await signInAs(SEED.memberA);
      const actor = await signInAs(email);
      const id = await insertRecipe(member);
      await trashDaysAgo(id, 31);
      expect(await purge(actor, id)).toHaveLength(1);
      expect(await exists(id)).toBe(false);
    },
  );

  it('nobody purges trash younger than 30 days or a recipe not in the trash', async () => {
    const admin = await signInAs(SEED.adminA);
    const young = await insertRecipe(admin);
    await trashDaysAgo(young, 29);
    const live = await insertRecipe(admin);
    await as(admin, (tx) => tx`delete from public.recipes where id in (${young}, ${live})`);
    expect(await exists(young)).toBe(true);
    expect(await exists(live)).toBe(true);
  });

  it('a viewer cannot purge, nor can another household', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    const id = await insertRecipe(member);
    await trashDaysAgo(id, 31);
    expect(await purge(viewer, id)).toHaveLength(0);
    expect(await purge(adminB, id)).toHaveLength(0);
    expect(await exists(id)).toBe(true);
  });

  it('purging a recipe removes its favorites', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    await as(
      member,
      (tx) => tx`insert into public.favorites (id, household_id, user_id, recipe_id)
        values (${randomUUID()}, ${member.householdId}, ${member.userId}, ${id})`,
    );
    await trashDaysAgo(id, 31);
    await purge(member, id);
    const left = await adminSql`select 1 from public.favorites where recipe_id = ${id}`;
    expect(left).toHaveLength(0);
  });
});

describe('deleted_at is stamped by the server', () => {
  // The purge is irreversible, so the 30 days must start at the server's
  // clock, not a device's (a wrong clock, or a back-dated upload).
  it('a member cannot back-date a trash time to purge at once', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    await as(
      member,
      (tx) => tx`update public.recipes set deleted_at = '2000-01-01T00:00:00Z' where id = ${id}`,
    );
    const [row] = await adminSql<{ recent: boolean }[]>`
      select deleted_at > now() - interval '1 minute' as recent from public.recipes where id = ${id}`;
    expect(row?.recent).toBe(true);
    expect(await purge(member, id)).toHaveLength(0);
    expect(await exists(id)).toBe(true);
  });

  it('keeps the original trash time when a trashed recipe is saved again', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    await trashDaysAgo(id, 10);
    await as(
      member,
      (tx) => tx`update public.recipes set deleted_at = now(), notes = 'edited' where id = ${id}`,
    );
    const [row] = await adminSql<{ days: number }[]>`
      select extract(day from now() - deleted_at)::int as days from public.recipes where id = ${id}`;
    expect(row?.days).toBe(10);
  });

  it('restore clears it, and a later trash starts a new 30 days', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    await trashDaysAgo(id, 40);
    await as(member, (tx) => tx`update public.recipes set deleted_at = null where id = ${id}`);
    await as(
      member,
      (tx) => tx`update public.recipes set deleted_at = '2000-01-01T00:00:00Z' where id = ${id}`,
    );
    expect(await purge(member, id)).toHaveLength(0);
  });

  it('a recipe inserted already trashed gets the server time', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await as(
      member,
      (tx) => tx`insert into public.recipes (id, household_id, title, deleted_at)
        values (${id}, ${member.householdId}, 'Born trashed', '2000-01-01T00:00:00Z')`,
    );
    expect(await purge(member, id)).toHaveLength(0);
  });
});
