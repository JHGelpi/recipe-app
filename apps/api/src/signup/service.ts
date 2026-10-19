import type { UserTx } from '../db/asUser';

export type PassKind = 'invite' | 'share' | 'friend';
export type SignupService = {
  grant(kind: PassKind, code: string, email: string): Promise<boolean>;
};

type Anonymous = <T>(fn: (tx: UserTx) => Promise<T>) => Promise<T>;

/** Production spec §4: a 24-hour sign-up pass from a live link, asked for signed out. */
export function createSignupService(deps: { asAnonymous: Anonymous }): SignupService {
  return {
    async grant(kind, code, email) {
      const [row] = await deps.asAnonymous(
        (tx) =>
          tx<{ ok: boolean }[]>`select public.grant_signup_pass(${kind}, ${code}, ${email}) as ok`,
      );
      return row?.ok === true;
    },
  };
}
