import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

const entry = (householdId: string | null, recipeId: string | null = null) => ({
  id: randomUUID(),
  household_id: householdId,
  recipe_id: recipeId,
  recipe_title: 'Seed pancakes',
  cooked_on: '2026-10-20',
});

const cookPhoto = (householdId: string | null, cookLogId: string) => ({
  id: randomUUID(),
  household_id: householdId,
  kind: 'cook',
  cook_log_id: cookLogId,
  position: 1,
  media_type: 'image/jpeg',
  bytes: 10,
  width: 1,
  height: 1,
});

async function recipe(actor: Actor): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, 'Logged soup')`,
  );
  return id;
}

describe('cook logs (FR-37–FR-41)', () => {
  it('members log and edit; viewers read but cannot write', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const row = entry(member.householdId, await recipe(member));
    await as(member, (tx) => tx`insert into public.cook_logs ${tx(row)}`);
    await as(
      member,
      (tx) => tx`update public.cook_logs set notes = 'Kids loved it' where id = ${row.id}`,
    );
    expect(
      await as(viewer, (tx) => tx`select notes from public.cook_logs where id = ${row.id}`),
    ).toEqual([{ notes: 'Kids loved it' }]);
    expect(
      await refusalCode(
        as(viewer, (tx) => tx`insert into public.cook_logs ${tx(entry(viewer.householdId))}`),
      ),
    ).toBe('42501');
    const updated = await as(
      viewer,
      (tx) => tx`update public.cook_logs set notes = 'x' where id = ${row.id} returning id`,
    );
    expect(updated).toHaveLength(0);
    expect(
      await refusalCode(
        as(
          viewer,
          (tx) => tx`insert into public.photos ${tx(cookPhoto(viewer.householdId, row.id))}`,
        ),
      ),
    ).toBe('42501');
  });

  it('cooked_by is the person who logged it, and never changes', async () => {
    const member = await signInAs(SEED.memberA);
    const admin = await signInAs(SEED.adminA);
    const row = { ...entry(member.householdId), cooked_by: admin.userId };
    await as(member, (tx) => tx`insert into public.cook_logs ${tx(row)}`);
    await as(
      admin,
      (tx) =>
        tx`update public.cook_logs set cooked_by = ${admin.userId}, notes = 'x' where id = ${row.id}`,
    );
    const [stored] = await adminSql<{ cooked_by: string; updated_by: string }[]>`
      select cooked_by, updated_by from public.cook_logs where id = ${row.id}`;
    expect(stored).toEqual({ cooked_by: member.userId, updated_by: admin.userId });
  });

  it('another household cannot read, write, or point at the rows', async () => {
    const member = await signInAs(SEED.memberA);
    const other = await signInAs(SEED.adminB);
    const row = entry(member.householdId, await recipe(member));
    await as(member, (tx) => tx`insert into public.cook_logs ${tx(row)}`);
    expect(
      await as(other, (tx) => tx`select id from public.cook_logs where id = ${row.id}`),
    ).toHaveLength(0);
    expect(
      await refusalCode(
        as(other, (tx) => tx`insert into public.cook_logs ${tx(entry(member.householdId))}`),
      ),
    ).toBe('42501');
    const changed = await as(
      other,
      (tx) => tx`update public.cook_logs set notes = 'x' where id = ${row.id} returning id`,
    );
    expect(changed).toHaveLength(0);
    // Its own entry cannot name A's recipe, nor its photo A's entry (composite keys).
    expect(
      await refusalCode(
        as(
          other,
          (tx) => tx`insert into public.cook_logs ${tx(entry(other.householdId, row.recipe_id))}`,
        ),
      ),
    ).toBe('23503');
    expect(
      await refusalCode(
        as(
          other,
          (tx) => tx`insert into public.photos ${tx(cookPhoto(other.householdId, row.id))}`,
        ),
      ),
    ).toBe('23503');
  });

  it('a cook photo belongs to its entry only: no recipe, page, or missing position', async () => {
    const member = await signInAs(SEED.memberA);
    const recipeId = await recipe(member);
    const row = entry(member.householdId, recipeId);
    await as(member, (tx) => tx`insert into public.cook_logs ${tx(row)}`);
    await as(
      member,
      (tx) => tx`insert into public.photos ${tx(cookPhoto(member.householdId, row.id))}`,
    );
    for (const bad of [
      { ...cookPhoto(member.householdId, row.id), recipe_id: recipeId },
      { ...cookPhoto(member.householdId, row.id), position: null },
    ]) {
      expect(await refusalCode(as(member, (tx) => tx`insert into public.photos ${tx(bad)}`))).toBe(
        '23514',
      );
    }
    expect(
      await refusalCode(
        as(
          member,
          (tx) =>
            tx`insert into public.photos ${tx({ ...cookPhoto(member.householdId, row.id), kind: 'dish', position: null })}`,
        ),
      ),
    ).toBe('23514');
  });

  it('a blank title, an old date, or long notes are refused by the database', async () => {
    const member = await signInAs(SEED.memberA);
    for (const bad of [
      { ...entry(member.householdId), recipe_title: '  ' },
      { ...entry(member.householdId), cooked_on: '1999-12-31' },
      { ...entry(member.householdId), notes: 'x'.repeat(4001) },
    ]) {
      expect(
        await refusalCode(as(member, (tx) => tx`insert into public.cook_logs ${tx(bad)}`)),
      ).toBe('23514');
    }
  });

  it('purging a recipe keeps its entries and their photos; the entry loses only the link', async () => {
    const member = await signInAs(SEED.memberA);
    const recipeId = await recipe(member);
    const row = entry(member.householdId, recipeId);
    const photo = cookPhoto(member.householdId, row.id);
    await as(member, async (tx) => {
      await tx`insert into public.cook_logs ${tx(row)}`;
      await tx`insert into public.photos ${tx(photo)}`;
    });
    await adminSql`update public.recipes set deleted_at = now() - interval '31 days' where id = ${recipeId}`;
    // The API's purge order: photos, recipes (apps/api/src/app.ts).
    await as(member, async (tx) => {
      await tx`delete from public.photos where recipe_id in (
        select id from public.recipes where deleted_at < now() - interval '30 days')`;
      await tx`delete from public.recipes where id = ${recipeId}`;
    });
    const [kept] = await adminSql<{ recipe_id: string | null; recipe_title: string }[]>`
      select recipe_id, recipe_title from public.cook_logs where id = ${row.id}`;
    expect(kept).toEqual({ recipe_id: null, recipe_title: 'Seed pancakes' });
    expect(await adminSql`select id from public.photos where id = ${photo.id}`).toHaveLength(1);
  });

  it('only entries trashed over 30 days ago, and their photos, can be hard-deleted', async () => {
    const member = await signInAs(SEED.memberA);
    const fresh = entry(member.householdId);
    const old = entry(member.householdId);
    const live = entry(member.householdId);
    const oldPhoto = cookPhoto(member.householdId, old.id);
    const livePhoto = cookPhoto(member.householdId, live.id);
    await adminSql`insert into public.cook_logs ${adminSql({ ...fresh, deleted_at: new Date() })}`;
    await adminSql`insert into public.cook_logs ${adminSql([old, live])}`;
    await adminSql`insert into public.photos ${adminSql([oldPhoto, livePhoto])}`;
    await adminSql`update public.cook_logs set deleted_at = now() - interval '31 days' where id = ${old.id}`;
    const photos = await as(
      member,
      (tx) =>
        tx<
          { id: string }[]
        >`delete from public.photos where id in (${oldPhoto.id}, ${livePhoto.id}) returning id`,
    );
    expect(photos.map((r) => r.id)).toEqual([oldPhoto.id]);
    const gone = await as(
      member,
      (tx) =>
        tx<
          { id: string }[]
        >`delete from public.cook_logs where id in (${fresh.id}, ${old.id}, ${live.id}) returning id`,
    );
    expect(gone.map((r) => r.id)).toEqual([old.id]);
  });
});
