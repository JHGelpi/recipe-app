import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { as, refusalCode } from '../helpers/db';

const REFUSED = '42501';
const CHECK_FAILED = '23514';

function insertImport(actor: Actor, id = randomUUID()) {
  return as(
    actor,
    (tx) => tx`insert into public.imports (id, household_id, source_type, source_text)
      values (${id}, ${actor.householdId}, 'text', 'Soup')`,
  ).then(() => id);
}

async function insertRecipe(actor: Actor): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, 'R')`,
  );
  return id;
}

function addSpend(actor: Actor, householdId: string | null, micro: number) {
  return as(
    actor,
    (tx) => tx`insert into public.ai_usage (household_id, month, spent_microusd)
      values (${householdId}, date_trunc('month', now())::date, ${micro})
      on conflict (household_id, month)
      do update set spent_microusd = public.ai_usage.spent_microusd + excluded.spent_microusd`,
  );
}

describe('imports', () => {
  it('a member creates an import that starts pending', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertImport(member);
    const [row] = await as(
      member,
      (tx) => tx<{ status: string }[]>`select status from public.imports where id = ${id}`,
    );
    expect(row?.status).toBe('pending');
  });

  it('a viewer cannot create or change an import', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    expect(await refusalCode(insertImport(viewer))).toBe(REFUSED);
    const id = await insertImport(member);
    const changed = await as(
      viewer,
      (tx) => tx`update public.imports set deleted_at = now() where id = ${id} returning id`,
    );
    expect(changed).toHaveLength(0);
  });

  it('another household neither reads nor changes an import', async () => {
    const member = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const id = await insertImport(member);
    expect(
      await as(adminB, (tx) => tx`select id from public.imports where id = ${id}`),
    ).toHaveLength(0);
    const changed = await as(
      adminB,
      (tx) => tx`update public.imports set status = 'parsing' where id = ${id} returning id`,
    );
    expect(changed).toHaveLength(0);
  });

  it('an import may point only at a recipe of its own household', async () => {
    const member = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const mine = await insertRecipe(member);
    const theirs = await insertRecipe(adminB);
    const id = await insertImport(member);
    expect(
      await refusalCode(
        as(member, (tx) => tx`update public.imports set recipe_id = ${theirs} where id = ${id}`),
      ),
    ).toBe(REFUSED);
    expect(
      await refusalCode(
        as(member, (tx) => tx`update public.imports set recipe_id = ${mine} where id = ${id}`),
      ),
    ).toBeUndefined();
  });

  it('a new import cannot arrive already saved, and a text import carries text only', async () => {
    const member = await signInAs(SEED.memberA);
    const recipe = await insertRecipe(member);
    expect(
      await refusalCode(
        as(
          member,
          (
            tx,
          ) => tx`insert into public.imports (id, household_id, source_type, source_text, recipe_id)
          values (${randomUUID()}, ${member.householdId}, 'text', 'Soup', ${recipe})`,
        ),
      ),
    ).toBe(REFUSED);
    expect(
      await refusalCode(
        as(
          member,
          (
            tx,
          ) => tx`insert into public.imports (id, household_id, source_type, source_text, source_url)
          values (${randomUUID()}, ${member.householdId}, 'text', 'Soup', 'https://example.com')`,
        ),
      ),
    ).toBe(CHECK_FAILED);
  });
});

describe('ai_usage', () => {
  it('a member records spend for their own household and reads it back', async () => {
    const member = await signInAs(SEED.memberA);
    await addSpend(member, member.householdId, 5);
    const rows = await as(
      member,
      (tx) => tx<{ spent_microusd: string }[]>`select spent_microusd from public.ai_usage`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('nobody writes spend for another household, and viewers write none', async () => {
    const memberA = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const viewer = await signInAs(SEED.viewerA);
    expect(await refusalCode(addSpend(adminB, memberA.householdId, 5))).toBe(REFUSED);
    expect(await refusalCode(addSpend(viewer, viewer.householdId, 5))).toBe(REFUSED);
  });
});
