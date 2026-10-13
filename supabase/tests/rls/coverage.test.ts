import postgres from 'postgres';
import { expect, it } from 'vitest';
import { env } from '../../../test-support/env';
import { TENANT_TABLES } from './registry';

it('every public table has RLS enabled and is in the test registry', async () => {
  const sql = postgres(env.dbUrl, { max: 1 });
  const tables = await sql<{ name: string; rls: boolean }[]>`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname`;
  await sql.end();

  expect(tables.filter((table) => !table.rls).map((table) => table.name)).toEqual([]);
  expect(tables.map((table) => table.name)).toEqual([...TENANT_TABLES].sort());
});
