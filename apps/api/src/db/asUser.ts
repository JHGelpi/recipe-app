import postgres from 'postgres';
import type { VerifyToken } from '../auth/verify';

export type Sql = postgres.Sql;
export type UserTx = postgres.TransactionSql;
export type AsUser = <T>(token: string, fn: (tx: UserTx) => Promise<T>) => Promise<T>;

/** Connects as the API's login role. That role can do nothing until asUser switches role. */
export function connect(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, { max: options.max ?? 10, onnotice: () => {} });
}

/**
 * The only way the API touches the database (spec §4).
 * Verifies the token, then runs `fn` in one transaction as the non-privileged
 * role `authenticated`, with the verified claims visible to RLS policies.
 * `set local` and the transaction-local setting both end with the transaction,
 * so nothing carries over to the next request on the same connection.
 */
export function createAsUser(sql: Sql, verify: VerifyToken): AsUser {
  return async <T>(token: string, fn: (tx: UserTx) => Promise<T>): Promise<T> => {
    const claims = await verify(token);
    const result = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      return fn(tx);
    });
    return result as T;
  };
}

/** For the health check: proves the database answers, reads no table. */
export function createPing(sql: Sql): () => Promise<void> {
  return async () => {
    await sql`select 1`;
  };
}
