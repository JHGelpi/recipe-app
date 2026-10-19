import { adminSql } from './db';

/** The gate is shared state: callers must switch it off in a finally/afterEach. */
export async function setGate(on: boolean): Promise<void> {
  await adminSql`update public.signup_settings set gate_on = ${on}`;
}

export async function allow(email: string): Promise<void> {
  await adminSql`insert into public.signup_allowed (email) values (${email.trim().toLowerCase()})
    on conflict do nothing`;
}

export async function clearGateRows(emails: string[]): Promise<void> {
  const lower = emails.map((email) => email.trim().toLowerCase());
  await adminSql`delete from public.signup_allowed where email = any(${lower})`;
  await adminSql`delete from public.signup_passes where email = any(${lower})`;
}
