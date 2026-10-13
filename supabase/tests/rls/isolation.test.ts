import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { env } from '../../../test-support/env';
import { SEED, signInAs, signInFresh, type Actor } from '../helpers/auth';
import { TENANT_COLUMN, TENANT_TABLES } from './registry';

const RLS_VIOLATION = '42501';

async function insertRecipe(actor: Actor, title: string): Promise<string> {
  const id = randomUUID();
  const { error } = await actor.client
    .from('recipes')
    .insert({ id, household_id: actor.householdId, title });
  expect(error).toBeNull();
  return id;
}

async function titleOf(actor: Actor, id: string): Promise<string | undefined> {
  const { data, error } = await actor.client.from('recipes').select('title').eq('id', id);
  expect(error).toBeNull();
  return data?.[0]?.title as string | undefined;
}

describe('cross-household isolation', () => {
  it('seeded users carry the expected claims', async () => {
    const adminA = await signInAs(SEED.adminA);
    const memberA = await signInAs(SEED.memberA);
    const viewerA = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    expect([adminA.role, memberA.role, viewerA.role, adminB.role]).toEqual([
      'admin',
      'member',
      'viewer',
      'admin',
    ]);
    expect(memberA.householdId).toBe(adminA.householdId);
    expect(viewerA.householdId).toBe(adminA.householdId);
    expect(adminB.householdId).not.toBe(adminA.householdId);
  });

  it.each(TENANT_TABLES)('household B reads none of household A rows in %s', async (table) => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const column = TENANT_COLUMN[table];

    const targeted = await b.client.from(table).select('*').eq(column, a.householdId);
    expect(targeted.error).toBeNull();
    expect(targeted.data).toEqual([]);

    const everything = await b.client.from(table).select(column);
    expect(everything.error).toBeNull();
    const tenants = new Set(
      (everything.data as unknown as Record<string, string>[]).map((row) => row[column]),
    );
    expect([...tenants]).toEqual([b.householdId]);
  });

  it('household B cannot insert a recipe into household A', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const { error } = await b.client
      .from('recipes')
      .insert({ id: randomUUID(), household_id: a.householdId, title: 'Intruder' });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it('household B cannot update a recipe in household A', async () => {
    const a = await signInAs(SEED.memberA);
    const b = await signInAs(SEED.adminB);
    const id = await insertRecipe(a, 'Original');
    const { data, error } = await b.client
      .from('recipes')
      .update({ title: 'Hacked' })
      .eq('id', id)
      .select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await titleOf(a, id)).toBe('Original');
  });

  it('a recipe cannot be moved into another household', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const id = await insertRecipe(b, 'Mine');
    const { error } = await b.client
      .from('recipes')
      .update({ household_id: a.householdId })
      .eq('id', id);
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});

describe('roles', () => {
  it('a viewer can read recipes', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const { data, error } = await viewer.client.from('recipes').select('title');
    expect(error).toBeNull();
    expect(data?.map((row) => row.title)).toContain('Seed pancakes');
  });

  it('a viewer cannot insert', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const { error } = await viewer.client
      .from('recipes')
      .insert({ id: randomUUID(), household_id: viewer.householdId, title: 'Nope' });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it('a viewer cannot update', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const id = await insertRecipe(member, 'Untouched');
    const { data, error } = await viewer.client
      .from('recipes')
      .update({ title: 'Changed' })
      .eq('id', id)
      .select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await titleOf(member, id)).toBe('Untouched');
  });

  it('a member can insert, read, and update', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member, 'Draft');
    const { error } = await member.client.from('recipes').update({ title: 'Final' }).eq('id', id);
    expect(error).toBeNull();
    expect(await titleOf(member, id)).toBe('Final');
  });

  it('only an admin can rename the household', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    const asMember = await member.client
      .from('households')
      .update({ name: 'Member was here' })
      .eq('id', member.householdId)
      .select('id');
    expect(asMember.data).toEqual([]);
    const asAdmin = await admin.client
      .from('households')
      .update({ name: 'Household A' })
      .eq('id', admin.householdId)
      .select('id');
    expect(asAdmin.error).toBeNull();
    expect(asAdmin.data).toHaveLength(1);
  });
});

describe('no hard deletes', () => {
  it.each([SEED.adminA, SEED.memberA, SEED.viewerA])('%s cannot delete a recipe', async (email) => {
    const member = await signInAs(SEED.memberA);
    const actor = await signInAs(email);
    const id = await insertRecipe(member, 'Keep me');
    const { data, error } = await actor.client.from('recipes').delete().eq('id', id).select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await titleOf(member, id)).toBe('Keep me');
  });

  it('an admin cannot delete the household or a membership', async () => {
    const admin = await signInAs(SEED.adminA);
    const household = await admin.client
      .from('households')
      .delete()
      .eq('id', admin.householdId)
      .select('id');
    expect(household.data).toEqual([]);
    const membership = await admin.client
      .from('memberships')
      .delete()
      .eq('household_id', admin.householdId)
      .select('id');
    expect(membership.data).toEqual([]);
    const remaining = await admin.client.from('memberships').select('id');
    expect(remaining.data).toHaveLength(3);
  });
});

describe('server-owned fields', () => {
  it('ignores client values for created_at, updated_at, and updated_by', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const spoofed = '2000-01-01T00:00:00+00:00';
    const inserted = await member.client
      .from('recipes')
      .insert({
        id,
        household_id: member.householdId,
        title: 'Clock test',
        created_at: spoofed,
        updated_at: spoofed,
        updated_by: admin.userId,
      })
      .select('created_at, updated_at, updated_by')
      .single();
    expect(inserted.error).toBeNull();
    const oneMinuteAgo = Date.now() - 60_000;
    expect(new Date(inserted.data!.created_at).getTime()).toBeGreaterThan(oneMinuteAgo);
    expect(new Date(inserted.data!.updated_at).getTime()).toBeGreaterThan(oneMinuteAgo);
    expect(inserted.data!.updated_by).toBe(member.userId);

    const updated = await admin.client
      .from('recipes')
      .update({ title: 'Clock test 2', created_at: spoofed, updated_by: member.userId })
      .eq('id', id)
      .select('created_at, updated_by')
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data!.created_at).toBe(inserted.data!.created_at);
    expect(updated.data!.updated_by).toBe(admin.userId);
  });
});

describe('memberships are read-only for clients', () => {
  it('rejects insert and ignores update', async () => {
    const admin = await signInAs(SEED.adminA);
    const viewer = await signInAs(SEED.viewerA);
    const inserted = await admin.client
      .from('memberships')
      .insert({ household_id: admin.householdId, user_id: randomUUID(), role: 'member' });
    expect(inserted.error).not.toBeNull();

    const promoted = await viewer.client
      .from('memberships')
      .update({ role: 'admin' })
      .eq('user_id', viewer.userId)
      .select('id');
    expect(promoted.data).toEqual([]);
    const own = await viewer.client.from('memberships').select('role').eq('user_id', viewer.userId);
    expect(own.data?.[0]?.role).toBe('viewer');
  });
});

describe('no household claim', () => {
  it('a user without an active membership reads nothing and cannot write', async () => {
    const email = `orphan-${randomUUID()}@example.test`;
    const first = await signInFresh(email);
    expect(first.householdId).not.toBeNull();

    // Direct database access as the local superuser, used only to arrange
    // state that no client can create. Not the service-role key.
    const sql = postgres(env.dbUrl, { max: 1 });
    await sql`update public.memberships set deleted_at = now() where user_id = ${first.userId}`;
    await sql.end();

    await new Promise((resolve) => setTimeout(resolve, 1100)); // auth.email.max_frequency
    const orphan = await signInFresh(email);
    expect(orphan.householdId).toBeNull();
    expect(orphan.role).toBeNull();

    for (const table of TENANT_TABLES) {
      const { data, error } = await orphan.client.from(table).select('*');
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    const { error } = await orphan.client
      .from('recipes')
      .insert({ id: randomUUID(), household_id: first.householdId, title: 'Orphan write' });
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});
