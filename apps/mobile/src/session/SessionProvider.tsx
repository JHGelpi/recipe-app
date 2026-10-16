import type { Session } from '@supabase/auth-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth } from './auth';
import { claimsFromToken, type Claims } from './claims';
import { normalizeEmail } from './email';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; userId: string; claims: Claims | null };

export type ActionResult = { ok: true } | { ok: false; message: string };

export type SessionValue = {
  state: SessionState;
  requestCode(email: string): Promise<ActionResult>;
  verifyCode(email: string, code: string): Promise<ActionResult>;
  signOut(): Promise<void>;
};

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.';

function toState(session: Session | null): SessionState {
  if (!session) return { status: 'signedOut' };
  return {
    status: 'signedIn',
    userId: session.user.id,
    claims: claimsFromToken(session.access_token),
  };
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    void auth.getSession().then(({ data }) => setState(toState(data.session)));
    const { data } = auth.onAuthStateChange((_event, session) => setState(toState(session)));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      state,
      async requestCode(input) {
        const email = normalizeEmail(input);
        if (!email) return { ok: false, message: 'Enter a valid email address.' };
        try {
          const { error } = await auth.signInWithOtp({ email });
          if (!error) return { ok: true };
          return {
            ok: false,
            message: error.status ? 'Could not send a code. Try again in a moment.' : UNREACHABLE,
          };
        } catch {
          return { ok: false, message: UNREACHABLE };
        }
      },
      async verifyCode(input, code) {
        const email = normalizeEmail(input);
        const token = code.trim();
        if (!email || !/^\d{6}$/.test(token)) {
          return { ok: false, message: 'Enter the 6-digit code from the email.' };
        }
        try {
          const { error } = await auth.verifyOtp({ email, token, type: 'email' });
          if (!error) return { ok: true };
          return {
            ok: false,
            message: error.status ? 'That code is incorrect or has expired.' : UNREACHABLE,
          };
        } catch {
          return { ok: false, message: UNREACHABLE };
        }
      },
      async signOut() {
        // scope 'local' clears this device's session even when offline.
        await auth.signOut({ scope: 'local' });
      },
    }),
    [state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
