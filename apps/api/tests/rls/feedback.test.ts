import { describe, expect, it } from 'vitest';
import { SEED, signInAs } from '../../../../test-support/auth';
import { asAnonymous } from '../helpers/anonymous';
import { adminSql, as, refusalCode } from '../helpers/db';

const reporterOf = async (actor: Awaited<ReturnType<typeof signInAs>>) => {
  const [row] = await as(
    actor,
    (tx) => tx<{ id: string }[]>`select public.feedback_reporter_id() as id`,
  );
  return row!.id;
};

describe('feedback reporter ids (FR-45)', () => {
  it('each person has one stable anonymous id, different from everyone else’s', async () => {
    const admin = await signInAs(SEED.adminA);
    const viewer = await signInAs(SEED.viewerA);
    const first = await reporterOf(admin);
    expect(first).toMatch(/^r-[0-9a-f]{6}$/);
    expect(await reporterOf(admin)).toBe(first);
    expect(await reporterOf(viewer)).not.toBe(first);
    // The owner can map it back to the account; no one else can.
    const [row] = await adminSql<{ user_id: string }[]>`
      select user_id from public.feedback_reporters where reporter_id = ${first}`;
    expect(row!.user_id).toBe(admin.userId);
  });

  it('nobody signed in, and no anonymous caller, can read or write the mapping', async () => {
    const member = await signInAs(SEED.memberA);
    await reporterOf(member);
    expect(await refusalCode(as(member, (tx) => tx`select * from public.feedback_reporters`))).toBe(
      '42501',
    );
    expect(
      await refusalCode(
        as(member, (tx) => tx`update public.feedback_reporters set reporter_id = 'r-000000'`),
      ),
    ).toBe('42501');
    expect(
      await refusalCode(asAnonymous((tx) => tx`select * from public.feedback_reporters`)),
    ).toBe('42501');
  });

  it('a caller with no session gets no id', async () => {
    expect(await refusalCode(asAnonymous((tx) => tx`select public.feedback_reporter_id()`))).toBe(
      '42501',
    );
  });
});
