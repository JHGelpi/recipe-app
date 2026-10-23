import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { adminSql } from '../helpers/db';

const fresh = () =>
  signInFresh(`hh-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

function call(
  actor: Actor,
  method: string,
  path: string,
  body?: unknown,
  raw?: Uint8Array<ArrayBuffer>,
) {
  return fetch(`${env.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${actor.accessToken}`,
      'Content-Type': raw ? 'image/jpeg' : 'application/json',
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

async function invite(admin: Actor, role = 'member'): Promise<string> {
  const response = await call(admin, 'POST', '/invites', { role });
  expect(response.status).toBe(201);
  return ((await response.json()) as { code: string }).code;
}

describe('household endpoints', () => {
  it('invite, list, preview and accept; the joiner is then in the household', async () => {
    const admin = await fresh();
    const joiner = await fresh();
    const code = await invite(admin);
    const listed = (await (await call(admin, 'GET', '/invites')).json()) as unknown[];
    expect(listed).toHaveLength(1);
    const preview = await (await call(joiner, 'POST', '/invites/preview', { token: code })).json();
    expect(preview).toMatchObject({ status: 'ok', role: 'member', moving_recipes: 0 });
    const accepted = await call(joiner, 'POST', '/invites/accept', { token: code });
    expect(accepted.status).toBe(200);
    const [row] = await adminSql<
      { household_id: string }[]
    >`select household_id from public.memberships where user_id = ${joiner.userId}`;
    expect(row?.household_id).toBe(admin.householdId);
    expect((await call(joiner, 'POST', '/invites/accept', { token: code })).status).toBe(409);
  });

  it('refuses a non-Admin, cancels, changes a role, keeps the last Admin, removes, and leaves', async () => {
    const admin = await fresh();
    const member = await fresh();
    await call(member, 'POST', '/invites/accept', { token: await invite(admin) });
    expect((await call(member, 'POST', '/invites', { role: 'member' })).status).toBe(403);
    expect((await call(member, 'GET', '/invites')).status).toBe(403);
    const pending = (await (await call(admin, 'POST', '/invites', { role: 'viewer' })).json()) as {
      id: string;
    };
    expect((await call(admin, 'DELETE', `/invites/${pending.id}`)).status).toBe(204);
    expect((await call(admin, 'DELETE', `/invites/${pending.id}`)).status).toBe(404);
    expect(
      (await call(admin, 'PATCH', `/members/${member.userId}`, { role: 'viewer' })).status,
    ).toBe(204);
    expect(
      (await call(admin, 'PATCH', `/members/${admin.userId}`, { role: 'member' })).status,
    ).toBe(409);
    expect((await call(admin, 'PATCH', '/household', { name: 'Test kitchen' })).status).toBe(204);
    expect((await call(member, 'PATCH', '/household', { name: 'Mine now' })).status).toBe(403);
    expect((await call(admin, 'DELETE', `/members/${member.userId}`)).status).toBe(204);
    expect((await call(admin, 'POST', '/household/leave')).status).toBe(409);
  });

  it('moves a lone joiner’s photo files with their rows', async () => {
    const admin = await fresh();
    const joiner = await fresh();
    const importId = randomUUID();
    const photo = randomUUID();
    const upload = await call(joiner, 'POST', '/upload', {
      ops: [
        {
          op: 'put',
          table: 'imports',
          id: importId,
          data: { household_id: joiner.householdId, source_type: 'photo' },
        },
        {
          op: 'put',
          table: 'photos',
          id: photo,
          data: {
            household_id: joiner.householdId,
            kind: 'page',
            import_id: importId,
            position: 1,
            media_type: 'image/jpeg',
            bytes: 40,
            width: 4,
            height: 4,
          },
        },
      ],
    });
    expect(upload.status).toBe(200);
    expect(
      (await call(joiner, 'PUT', `/photos/${photo}`, undefined, syntheticJpeg(4, 4))).status,
    ).toBe(204);
    await call(joiner, 'POST', '/invites/accept', { token: await invite(admin) });
    expect((await call(admin, 'GET', `/photos/${photo}`)).status).toBe(200);
  });

  it('friend links are listed to a viewer and revoked once; then the link reads as ended', async () => {
    const admin = await fresh();
    const viewer = await fresh();
    await call(viewer, 'POST', '/invites/accept', { token: await invite(admin, 'viewer') });
    const viewerNow = await signInFresh(viewer.email);
    const made = await call(viewerNow, 'POST', '/friend-links', {});
    const { code } = (await made.json()) as { code: string };
    const listed = (await (await call(admin, 'GET', '/friend-links')).json()) as { id: string }[];
    expect(listed).toHaveLength(1);
    expect((await call(viewerNow, 'DELETE', `/friend-links/${listed[0]!.id}`)).status).toBe(204);
    expect((await call(admin, 'DELETE', `/friend-links/${listed[0]!.id}`)).status).toBe(404);
    const status = await fetch(`${env.apiUrl}/friend-links/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(await status.json()).toEqual({ status: 'ended' });
  });

  it('a Member lists and revokes only their own friend links; the Admin sees all (#33)', async () => {
    const admin = await fresh();
    const member = await fresh();
    await call(member, 'POST', '/invites/accept', { token: await invite(admin, 'member') });
    const memberNow = await signInFresh(member.email);
    await call(admin, 'POST', '/friend-links', {});
    await call(memberNow, 'POST', '/friend-links', {});
    const mine = (await (await call(memberNow, 'GET', '/friend-links')).json()) as { id: string }[];
    const all = (await (await call(admin, 'GET', '/friend-links')).json()) as { id: string }[];
    expect(mine).toHaveLength(1);
    expect(all).toHaveLength(2);
    const adminsLink = all.find((link) => link.id !== mine[0]!.id)!;
    expect((await call(memberNow, 'DELETE', `/friend-links/${adminsLink.id}`)).status).toBe(404);
    expect((await call(admin, 'DELETE', `/friend-links/${mine[0]!.id}`)).status).toBe(204);
  });

  it('a used invite leaves the pending list for the history, and a second use is refused (FR-42)', async () => {
    const admin = await fresh();
    const joiner = await fresh();
    const late = await fresh();
    const code = await invite(admin);
    expect((await call(joiner, 'POST', '/invites/accept', { token: code })).status).toBe(200);
    const second = await call(late, 'POST', '/invites/accept', { token: code });
    expect([second.status, await second.json()]).toEqual([409, { error: 'invite_used' }]);
    expect(await (await call(admin, 'GET', '/invites')).json()).toEqual([]);
    const history = (await (await call(admin, 'GET', '/invites/accepted')).json()) as {
      email: string | null;
    }[];
    expect(history.map((row) => row.email)).toEqual([joiner.email]);
    expect((await call(joiner, 'GET', '/invites/accepted')).status).toBe(403);
  });

  it('a friend link used to make an account leaves the list for the history and reads as used (FR-42)', async () => {
    const sender = await fresh();
    const made = (await (await call(sender, 'POST', '/friend-links', {})).json()) as {
      code: string;
    };
    const email = `friend-${randomUUID()}@example.test`;
    const pass = await fetch(`${env.apiUrl}/signup-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'friend', code: made.code, email }),
    });
    expect(pass.status).toBe(204);
    await signInFresh(email);
    expect(await (await call(sender, 'GET', '/friend-links')).json()).toEqual([]);
    const history = (await (await call(sender, 'GET', '/friend-links/accepted')).json()) as {
      email: string;
    }[];
    expect(history.map((row) => row.email)).toEqual([email]);
    const status = await fetch(`${env.apiUrl}/friend-links/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: made.code }),
    });
    expect(await status.json()).toEqual({ status: 'used' });
  });
});
