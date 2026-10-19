import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AUTH_STORAGE_KEY, auth, readSavedSession } from './auth';
import { config } from '../config';
import { normalizeEmail } from './email';
import { askForPass, INVITE_ONLY, isInviteOnly, LINK_EXPIRED, passSource } from './signupPass';
import {
  provisionalSession,
  resolveSession,
  sessionFromAuth,
  type SessionState,
} from './sessionState';

export type { SessionState } from './sessionState';

export type ActionResult = { ok: true } | { ok: false; message: string };

export type SessionValue = {
  state: SessionState;
  requestCode(email: string): Promise<ActionResult>;
  verifyCode(email: string, code: string): Promise<ActionResult>;
  signOut(): Promise<void>;
};

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.';

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  // Start from the saved session, so an offline start shows the list at once.
  const [state, setState] = useState<SessionState>(() => provisionalSession(readSavedSession()));
  // Set while the user's own sign-out runs, so the bridge knows to wipe.
  const signingOut = useRef(false);

  useEffect(() => {
    void auth.getSession().then((result) => setState(resolveSession(result, readSavedSession())));
    const { data } = auth.onAuthStateChange((event, session) => {
      // getSession above decides the start-up state, including the offline case.
      if (event === 'INITIAL_SESSION') return;
      if (session) {
        setState(sessionFromAuth(session));
      } else if (event === 'SIGNED_OUT') {
        setState({ status: 'signedOut', byUser: signingOut.current });
        signingOut.current = false;
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      state,
      async requestCode(input) {
        const email = normalizeEmail(input);
        if (!email) return { ok: false, message: 'Enter a valid email address.' };
        // A visitor from an invite, share or friend link gets a sign-up pass
        // first; existing accounts sign in whatever the pass says.
        const source = passSource();
        const pass = source
          ? await askForPass(source, email, {
              fetch: (input, init) => fetch(input, init),
              apiUrl: config.apiUrl,
            })
          : null;
        if (pass === 'offline') return { ok: false, message: UNREACHABLE };
        try {
          const { error } = await auth.signInWithOtp({ email });
          if (!error) return { ok: true };
          if (isInviteOnly(error)) {
            return { ok: false, message: pass === 'expired' ? LINK_EXPIRED : INVITE_ONLY };
          }
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
        signingOut.current = true;
        // Clear the saved session first. Offline with an expired token,
        // auth-js would retry renewing it for about 30 seconds and then return
        // an error without clearing anything.
        globalThis.localStorage?.removeItem(AUTH_STORAGE_KEY);
        setState({ status: 'signedOut', byUser: true });
        try {
          // With nothing saved this returns at once; scope 'local' never asks
          // the server.
          await auth.signOut({ scope: 'local' });
        } finally {
          // A later sign-out the user did not ask for must not count as theirs.
          signingOut.current = false;
        }
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
