import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';
import { asAnonymous } from '../helpers/anonymous';

const fresh = () =>
  signInFresh(`share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return 'ok';
  } catch (error) {
    return (error as { message?: string }).message ?? 'error';
  }
}

const snapshot = (title: string) => ({
  title,
  servings: 4,
  prep_minutes: null,
  cook_minutes: null,
  ingredients: [
    {
      id: randomUUID(),
      raw: '1 egg',
      quantity: 1,
      quantity_max: null,
      unit: null,
      item: 'egg',
      note: null,
      heading: false,
    },
  ],
  steps: [{ id: randomUUID(), text: 'Cook.' }],
  tags: ['test'],
  notes: '',
  source_url: null,
  source_author: null,
  household_name: 'Test household',
  shared_at: new Date().toISOString(),
  photo: null,
});

async function recipe(actor: Actor, title = 'Shared soup'): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, ${title})`,
  );
  return id;
}

async function share(
  actor: Actor,
  recipeId: string,
  title = 'Shared soup',
  id: string = randomUUID(),
  photo: { bytes: number; width: number; height: number } | null = null,
): Promise<string> {
  const [row] = await as(
    actor,
    (tx) => tx<{ token: string }[]>`
    select token from public.create_share(${id}, ${recipeId}, ${tx.json({ ...snapshot(title), photo })})`,
  );
  return row!.token;
}

const read = async (code: string) =>
  (
    await asAnonymous(
      (tx) =>
        tx<
          { status: string; snapshot: { title: string } | null }[]
        >`select status, snapshot from public.read_share(${code})`,
    )
  )[0]!;

describe('shares', () => {
  it('anyone with the code reads only the snapshot, with no claims at all', async () => {
    const cook = await fresh();
    const code = await share(cook, await recipe(cook));
    expect(await read(code)).toMatchObject({ status: 'ok', snapshot: { title: 'Shared soup' } });
    expect(await read('x'.repeat(43))).toMatchObject({ status: 'unknown', snapshot: null });
    // Empty claims still see no rows through RLS.
    expect(await asAnonymous((tx) => tx`select id from public.shares`)).toHaveLength(0);
    expect(await asAnonymous((tx) => tx`select id from public.recipes`)).toHaveLength(0);
  });

  it('a viewer may share; another household may not share a recipe it cannot see', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    const member = await signInAs(SEED.memberA);
    const recipeId = await recipe(member);
    expect(await outcome(share(viewer, recipeId))).toBe('ok');
    expect(await outcome(share(adminB, recipeId))).toBe('forbidden');
  });

  it('stopping ends every link; a viewer cannot stop; the Trash pauses links', async () => {
    const cook = await fresh();
    const recipeId = await recipe(cook);
    const first = await share(cook, recipeId);
    await adminSql`update public.recipes set deleted_at = now() where id = ${recipeId}`;
    expect((await read(first)).status).toBe('trashed');
    await adminSql`update public.recipes set deleted_at = null where id = ${recipeId}`;
    expect((await read(first)).status).toBe('ok');
    const viewer = await signInAs(SEED.viewerA);
    expect(await outcome(as(viewer, (tx) => tx`select public.stop_shares(${recipeId})`))).toBe(
      'forbidden',
    );
    const [stopped] = await as(
      cook,
      (tx) => tx<{ n: number }[]>`select public.stop_shares(${recipeId}) as n`,
    );
    expect(stopped?.n).toBe(1);
    expect((await read(first)).status).toBe('stopped');
  });

  it('saving copies into the caller’s household with new ids; viewers and the same household are refused', async () => {
    const owner = await fresh();
    const saver = await fresh();
    const code = await share(owner, await recipe(owner, 'Grandma pie'), 'Grandma pie');
    const [saved] = await as(
      saver,
      (tx) => tx<{ recipe_id: string }[]>`select * from public.save_share(${code})`,
    );
    const [row] = await adminSql<
      { household_id: string; title: string; source_text: string; ingredients: { id: string }[] }[]
    >`
      select household_id, title, source_text, ingredients from public.recipes where id = ${saved!.recipe_id}`;
    expect(row).toMatchObject({
      household_id: saver.householdId,
      title: 'Grandma pie',
      source_text: 'Shared by the Test household',
    });
    // Fresh ids: the copy's ingredient is not the snapshot's.
    const shared = (await read(code)).snapshot as unknown as { ingredients: { id: string }[] };
    expect(row!.ingredients[0]!.id).not.toBe(shared.ingredients[0]!.id);
    expect(await outcome(as(owner, (tx) => tx`select * from public.save_share(${code})`))).toBe(
      'own_household',
    );
    const viewer = await signInAs(SEED.viewerA);
    expect(await outcome(as(viewer, (tx) => tx`select * from public.save_share(${code})`))).toBe(
      'forbidden',
    );
  });

  it('a caller with no claims cannot stop anyone’s links', async () => {
    const cook = await fresh();
    const recipeId = await recipe(cook);
    const code = await share(cook, recipeId);
    expect(await outcome(asAnonymous((tx) => tx`select public.stop_shares(${recipeId})`))).toBe(
      'forbidden',
    );
    expect((await read(code)).status).toBe('ok');
  });

  it('another household cannot read or stop the shares table', async () => {
    const owner = await fresh();
    const other = await fresh();
    const recipeId = await recipe(owner);
    await share(owner, recipeId);
    expect(await as(other, (tx) => tx`select id from public.shares`)).toHaveLength(0);
    expect(await outcome(as(other, (tx) => tx`select public.stop_shares(${recipeId})`))).toBe(
      'forbidden',
    );
  });

  it('a person alone who shared brings their links when they join a household (Final 1)', async () => {
    const admin = await fresh();
    const joiner = await fresh();
    const recipeId = await recipe(joiner);
    const withPhoto = randomUUID();
    const code = await share(joiner, recipeId, 'Shared soup', withPhoto, {
      bytes: 10,
      width: 1,
      height: 1,
    });
    const stoppedId = randomUUID();
    await share(joiner, recipeId, 'Shared soup', stoppedId);
    await as(joiner, (tx) => tx`select public.stop_shares(${recipeId})`);
    const fresher = await share(joiner, recipeId);
    const [invite] = await as(
      admin,
      (tx) =>
        tx<
          { token: string }[]
        >`select token from public.create_invite('member'::public.household_role)`,
    );
    const [result] = await as(
      joiner,
      (tx) =>
        tx<{ moved_photos: string[] }[]>`select * from public.accept_invite(${invite!.token})`,
    );
    // The share's photo copy is a file to move too; the share without a photo has none.
    expect(result!.moved_photos).toContain(withPhoto);
    expect(result!.moved_photos).not.toContain(stoppedId);
    const left = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.shares where household_id = ${joiner.householdId}`;
    expect(left[0]!.n).toBe(0);
    expect((await read(fresher)).status).toBe('ok');
    expect((await read(code)).status).toBe('stopped');
  });
});

describe('kept link codes (bug batch §4)', () => {
  it('a live link is reused with the new snapshot; another household’s or a stopped link is refused', async () => {
    const cook = await signInFresh(`share-keep-${randomUUID()}@example.test`);
    const other = await signInFresh(`share-other-${randomUUID()}@example.test`);
    const recipe = randomUUID();
    await as(
      cook,
      (tx) =>
        tx`insert into public.recipes (id, household_id, title) values (${recipe}, ${cook.householdId}, 'Kept soup')`,
    );
    const snap = (title: string) => ({ title });
    const create = (actor: Actor, id: string, title: string) =>
      as(
        actor,
        (tx) => tx<{ id: string; token: string }[]>`
        select * from public.create_share(${id}::uuid, ${recipe}::uuid, ${tx.json(snap(title))})`,
      );
    const id = randomUUID();
    const [first] = await create(cook, id, 'One');
    const [again] = await create(cook, id, 'Two');
    expect(again!.token).toBe(first!.token);
    const [row] = await adminSql<{ title: string; kept: string }[]>`
      select snapshot ->> 'title' as title, kept_code as kept from public.shares where id = ${id}`;
    expect(row).toEqual({ title: 'Two', kept: first!.token });
    expect(await refusalCode(create(other, id, 'Theirs'))).toBe('P0001');
    await as(cook, (tx) => tx`select public.stop_shares(${recipe}::uuid)`);
    expect(await refusalCode(create(cook, id, 'Three'))).toBe('P0001');
  });
});
