import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

const REFUSED = '42501';
const FOREIGN_KEY = '23503';

async function photoImport(actor: Actor): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) => tx`insert into public.imports (id, household_id, source_type)
               values (${id}, ${actor.householdId}, 'photo')`,
  );
  return id;
}

function insertPage(actor: Actor, importId: string, extra: Record<string, unknown> = {}) {
  const row = {
    id: randomUUID(),
    household_id: actor.householdId,
    kind: 'page',
    import_id: importId,
    position: 1,
    media_type: 'image/jpeg',
    bytes: 1000,
    width: 10,
    height: 10,
    ...extra,
  };
  return { id: row.id, run: as(actor, (tx) => tx`insert into public.photos ${tx(row)}`) };
}

async function visible(actor: Actor, id: string): Promise<boolean> {
  const rows = await as(actor, (tx) => tx`select id from public.photos where id = ${id}`);
  return rows.length === 1;
}

describe('photos RLS', () => {
  it('a member adds a page to their import; the other household cannot see it', async () => {
    const member = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const page = insertPage(member, await photoImport(member));
    await page.run;
    expect(await visible(member, page.id)).toBe(true);
    expect(await visible(adminB, page.id)).toBe(false);
  });

  it('refuses a page of another household’s import', async () => {
    const member = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const theirs = await photoImport(adminB);
    expect(await refusalCode(insertPage(member, theirs).run)).toBe(FOREIGN_KEY);
  });

  it('refuses a viewer, and a client claiming the file is uploaded', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const importId = await photoImport(member);
    expect(await refusalCode(insertPage(viewer, importId).run)).toBe(REFUSED);
    expect(await refusalCode(insertPage(member, importId, { uploaded_at: new Date() }).run)).toBe(
      REFUSED,
    );
  });

  it('the other household cannot update or delete a photo', async () => {
    const member = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const page = insertPage(member, await photoImport(member));
    await page.run;
    await adminSql`update public.photos set deleted_at = now() - interval '31 days' where id = ${page.id}`;
    const updated = await as(
      adminB,
      (tx) => tx`update public.photos set recipe_id = null where id = ${page.id} returning id`,
    );
    const deleted = await as(
      adminB,
      (tx) => tx`delete from public.photos where id = ${page.id} returning id`,
    );
    expect([updated.length, deleted.length]).toEqual([0, 0]);
  });

  it('refuses a recipe dish photo from another household', async () => {
    const adminA = await signInAs(SEED.adminA);
    const adminB = await signInAs(SEED.adminB);
    const theirs = insertPage(adminB, await photoImport(adminB));
    await theirs.run;
    expect(
      await refusalCode(
        as(
          adminA,
          (tx) => tx`update public.recipes set photo_id = ${theirs.id}
                     where id = '00000000-0000-0000-0000-0000000000c1'`,
        ),
      ),
    ).toBe(FOREIGN_KEY);
  });

  it('purges a photo dismissed over 30 days ago, and keeps a fresh one', async () => {
    const member = await signInAs(SEED.memberA);
    const importId = await photoImport(member);
    const old = insertPage(member, importId, { position: 1 });
    const fresh = insertPage(member, importId, { position: 2 });
    await old.run;
    await fresh.run;
    await adminSql`update public.photos set deleted_at = now() - interval '31 days' where id = ${old.id}`;
    await adminSql`update public.photos set deleted_at = now() where id = ${fresh.id}`;
    const purged = await as(
      member,
      (tx) => tx<{ id: string }[]>`
        delete from public.photos where id in (${old.id}, ${fresh.id}) returning id`,
    );
    expect(purged.map((row) => row.id)).toEqual([old.id]);
  });
});
