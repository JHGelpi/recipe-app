import postgres from 'postgres';
import type { TokenClaims, VerifyToken } from '../auth/verify';

export type Sql = postgres.Sql;
export type UserTx = postgres.TransactionSql;
export type AsUser = <T>(token: string, fn: (tx: UserTx) => Promise<T>) => Promise<T>;
export type AsClaims = <T>(claims: TokenClaims, fn: (tx: UserTx) => Promise<T>) => Promise<T>;

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
  const asClaims = createAsClaims(sql);
  return async <T>(token: string, fn: (tx: UserTx) => Promise<T>): Promise<T> =>
    asClaims(await verify(token), fn);
}

/**
 * asUser without the token check, for work that outlives its request (an
 * import parse, ADR-0012). The claims must come from asUser's verifier
 * earlier in that request; the role and RLS are exactly asUser's.
 */
export function createAsClaims(sql: Sql): AsClaims {
  return async <T>(claims: TokenClaims, fn: (tx: UserTx) => Promise<T>): Promise<T> => {
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
