import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs } from '../../../../test-support/auth';
import { signTestToken } from '../../../../test-support/tokens';
import { createVerifier, UnauthorizedError } from '../../src/auth/verify';
import { connect, createAsUser } from '../../src/db/asUser';
import { as, asUser, refusalCode } from '../helpers/db';
import { TENANT_TABLES } from './registry';

describe('asUser', () => {
  it.each([
    [
      'a tampered signature',
      async () => {
        const token = (await signInAs(SEED.adminA)).accessToken;
        return token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
      },
    ],
    ['an expired token', () => signTestToken({ sub: randomUUID() }, { expiresInSeconds: -60 })],
    ['another audience', () => signTestToken({ sub: randomUUID() }, { audience: 'someone-else' })],
    ['text that is not a token', async () => 'not-a-jwt'],
  ])('refuses %s before touching the database', async (_name, makeToken) => {
    const fn = vi.fn();
    await expect(asUser(await makeToken(), fn)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a validly signed token with no household claims reads nothing and cannot write', async () => {
    const token = await signTestToken({ sub: randomUUID() });
    for (const table of TENANT_TABLES) {
      expect(await asUser(token, (tx) => tx`select * from public.${tx(table)}`)).toHaveLength(0);
    }
    const admin = await signInAs(SEED.adminA);
    const code = await refusalCode(
      asUser(
        token,
        (tx) =>
          tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${admin.householdId}, 'No claims')`,
      ),
    );
    expect(code).toBe('42501');
  });

  it('claims and role do not leak to the next use of the same connection', async () => {
    // One connection, so the second transaction is guaranteed to reuse it.
    const sql = connect(env.apiDbUrl, { max: 1 });
    const single = createAsUser(
      sql,
      createVerifier({ audience: 'authenticated', jwksUrl: env.jwksUrl }),
    );
    try {
      const admin = await signInAs(SEED.adminA);
      const seen = await single(admin.accessToken, (tx) => tx`select id from public.recipes`);
      expect(seen.length).toBeGreaterThan(0);

      const after = await sql.begin(async (tx) => {
        const [state] = await tx<{ role: string; claims: string | null }[]>`
          select current_user as role, current_setting('request.jwt.claims', true) as claims`;
        await tx`set local role authenticated`;
        const rows = await tx`select id from public.recipes`;
        return { state, count: rows.length };
      });
      expect(after.state?.role).toBe('api_login');
      expect(after.state?.claims ?? '').toBe('');
      expect(after.count).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it('rolls everything back when the callback throws', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await expect(
      as(member, async (tx) => {
        await tx`insert into public.recipes (id, household_id, title) values (${id}, ${member.householdId}, 'Half done')`;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(
      await as(member, (tx) => tx`select id from public.recipes where id = ${id}`),
    ).toHaveLength(0);
  });
});
