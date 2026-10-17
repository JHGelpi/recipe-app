import { usePowerSync } from '@powersync/react';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { withSession } from '../imports/api';
import {
  acceptInvite,
  HOUSEHOLD_MESSAGES,
  previewInvite,
  type InvitePreview,
} from '../household/api';
import { setNotice } from '../household/notice';
import { setPendingInvite } from '../household/pendingInvite';
import { waitForUploads } from '../household/uploads';
import { auth } from '../session/auth';
import { useSession } from '../session/SessionProvider';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };
const STATUS_TEXT: Record<string, string> = {
  used: HOUSEHOLD_MESSAGES.invite_used!,
  expired: HOUSEHOLD_MESSAGES.invite_expired!,
  cancelled: HOUSEHOLD_MESSAGES.invite_cancelled!,
  unknown: HOUSEHOLD_MESSAGES.invite_unknown!,
};

/** FR-3: the page an invite link opens (spec §6). */
export function InviteScreen({ code }: { code: string }) {
  const { state } = useSession();
  useEffect(() => {
    if (state.status === 'signedOut') setPendingInvite(code);
  }, [state.status, code]);
  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') {
    return (
      <View style={{ padding: 16, gap: 12, maxWidth: 480 }}>
        <Text style={{ fontSize: 18 }}>
          You've been invited to a household. Sign in to see the invite.
        </Text>
        <Link href="/sign-in" style={{ textDecorationLine: 'underline' }}>
          Sign in
        </Link>
      </View>
    );
  }
  return <SignedInInvite code={code} />;
}

function SignedInInvite({ code }: { code: string }) {
  const db = usePowerSync();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      // The preview counts the recipes on the server, so this phone's
      // unsent ones must be there first.
      await waitForUploads(db);
      const result = await withSession((deps) => previewInvite(code, deps));
      if (!live || !result) return;
      if (result.ok) setPreview(result.value);
      else setMessage(result.message);
    })();
    return () => {
      live = false;
    };
  }, [code, db]);

  async function join() {
    if (!preview) return;
    setJoining(true);
    setMessage(null);
    // Unsent edits must reach the server before the data moves (Review Focus 1).
    if (!(await waitForUploads(db))) {
      setJoining(false);
      setMessage('Still saving your changes. Try again in a moment.');
      return;
    }
    const result = await withSession((deps) => acceptInvite(code, deps));
    if (!result?.ok) {
      setJoining(false);
      setMessage(result?.message ?? 'Sign in again to join');
      return;
    }
    setNotice({ kind: 'joined', name: preview.household_name });
    await auth.refreshSession();
    router.replace('/');
  }

  const name = preview?.household_name ?? 'household';
  const blocked = preview?.blocker === 'only_admin';
  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 480 }}>
      {!preview && !message ? <ActivityIndicator /> : null}
      {preview?.status === 'ok' ? (
        <>
          <Text style={{ fontSize: 20 }}>
            Join the {name} as a {ROLE_LABEL[preview.role ?? 'member']}
          </Text>
          {preview.moving_recipes > 0 ? (
            <Text>
              Your {preview.moving_recipes} {preview.moving_recipes === 1 ? 'recipe' : 'recipes'}{' '}
              will move to the {name}
            </Text>
          ) : null}
          {blocked ? <Text role="alert">{HOUSEHOLD_MESSAGES.only_admin}</Text> : null}
          {!blocked ? (
            <Pressable
              role="button"
              aria-disabled={joining}
              onPress={() => void join()}
              style={{
                backgroundColor: '#1a5d3a',
                borderRadius: 8,
                minHeight: 44,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16 }}>{joining ? 'Joining…' : 'Join'}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {preview?.status === 'already_member' ? <Text>You're already in the {name}</Text> : null}
      {preview && STATUS_TEXT[preview.status] ? (
        <Text role="alert">{STATUS_TEXT[preview.status]}</Text>
      ) : null}
      {message ? <Text role="alert">{message}</Text> : null}
      <Link href="/" style={{ textDecorationLine: 'underline' }}>
        All recipes
      </Link>
    </View>
  );
}
