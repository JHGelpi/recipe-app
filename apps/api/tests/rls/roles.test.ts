import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { adminSql, refusalCode } from '../helpers/db';
import { TENANT_TABLES } from './registry';

describe('database roles (spec §4)', () => {
  it('api_login has no special attributes', async () => {
    const [role] = await adminSql`
      select rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb, rolreplication
      from pg_roles where rolname = 'api_login'`;
    expect(role).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  });

  it('api_login owns nothing and may only become "authenticated"', async () => {
    const owned = await adminSql`
      select c.relname from pg_class c join pg_roles r on r.oid = c.relowner
      where r.rolname in ('api_login', 'authenticated')`;
    expect(owned).toHaveLength(0);

    const memberOf = await adminSql<{ rolname: string }[]>`
      select g.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid
      join pg_roles u on u.oid = m.member
      where u.rolname = 'api_login'`;
    expect(memberOf.map((row) => row.rolname)).toEqual(['authenticated']);
  });

  it('powersync_repl is the only non-superuser that bypasses RLS', async () => {
    const roles = await adminSql<{ rolname: string }[]>`
      select rolname from pg_roles where rolbypassrls and not rolsuper order by rolname`;
    expect(roles.map((row) => row.rolname)).toEqual(['powersync_repl']);
  });

  it('"authenticated" holds exactly the intended table grants', async () => {
    const grants = await adminSql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
      order by table_name, privilege_type`;
    const byTable = Object.fromEntries(
      TENANT_TABLES.map((table) => [
        table,
        grants.filter((grant) => grant.table_name === table).map((grant) => grant.privilege_type),
      ]),
    );
    expect(byTable).toEqual({
      households: ['SELECT', 'UPDATE'],
      memberships: ['SELECT'],
      recipes: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
      favorites: ['INSERT', 'SELECT', 'UPDATE'],
      imports: ['INSERT', 'SELECT', 'UPDATE'],
      ai_usage: ['INSERT', 'SELECT', 'UPDATE'],
      photos: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
      substitutions: ['INSERT', 'SELECT', 'UPDATE'],
      invites: ['SELECT'],
      shares: ['DELETE', 'SELECT'],
      shopping_items: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
      aisle_choices: ['INSERT', 'SELECT', 'UPDATE'],
    });
  });

  it('api_login cannot read a table until it switches role', async () => {
    const sql = postgres(env.apiDbUrl, { max: 1, onnotice: () => {} });
    try {
      for (const table of TENANT_TABLES) {
        expect(await refusalCode(sql`select * from public.${sql(table)}`)).toBe('42501');
      }
    } finally {
      await sql.end();
    }
  });
});
