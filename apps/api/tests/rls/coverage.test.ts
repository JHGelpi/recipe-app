import { expect, it } from 'vitest';
import { adminSql } from '../helpers/db';
import { TENANT_TABLES } from './registry';

it('every public table has RLS enabled and is in the test registry', async () => {
  const tables = await adminSql<{ name: string; rls: boolean }[]>`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname`;

  expect(tables.filter((table) => !table.rls).map((table) => table.name)).toEqual([]);
  expect(tables.map((table) => table.name)).toEqual([...TENANT_TABLES].sort());
});
