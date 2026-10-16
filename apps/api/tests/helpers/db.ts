import postgres from 'postgres';
import { afterAll } from 'vitest';
import { env } from '../../../../test-support/env';
import type { Actor } from '../../../../test-support/auth';
import { createVerifier } from '../../src/auth/verify';
import { connect, createAsUser, type UserTx } from '../../src/db/asUser';

/** Superuser connection. Only for arranging or inspecting state no client can reach. */
export const adminSql = postgres(env.adminDbUrl, { max: 1, onnotice: () => {} });

const apiSql = connect(env.apiDbUrl);

/** The API's own helper, with the API's own login: the path production uses. */
export const asUser = createAsUser(
  apiSql,
  createVerifier({ audience: 'authenticated', jwksUrl: env.jwksUrl }),
);

export function as<T>(actor: Actor, fn: (tx: UserTx) => Promise<T>): Promise<T> {
  return asUser(actor.accessToken, fn);
}

/** Resolves to the Postgres error code a statement was refused with, or undefined if it ran. */
export async function refusalCode(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? 'no-code';
  }
}

afterAll(async () => {
  await adminSql.end();
  await apiSql.end();
});
