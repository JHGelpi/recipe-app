import { usePowerSync } from '@powersync/react';
import { householdPhrase } from '@recipe-app/domain';
import { Link, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
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
import { colors, type } from '../theme';
import { Banner, Button, Card, Screen, Text } from '../ui';

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
      <Screen>
        <Card>
          <Text variant="h2">You've been invited to a household. Sign in to see the invite.</Text>
          <Link
            href="/sign-in"
            style={[type.label, { color: colors.accent, textDecorationLine: 'underline' }]}
          >
            Sign in
          </Link>
        </Card>
      </Screen>
    );
  }
  return <SignedInInvite code={code} />;
}

function SignedInInvite({ code }: { code: string }) {
  const db = usePowerSync();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // A second tap before the first finishes must not post again.
  const busy = useRef(false);

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
    if (!preview || busy.current) return;
    busy.current = true;
    setJoining(true);
    setMessage(null);
    // Unsent edits must reach the server before the data moves (Review Focus 1).
    if (!(await waitForUploads(db))) {
      busy.current = false;
      setJoining(false);
      setMessage('Still saving your changes. Try again in a moment.');
      return;
    }
    const result = await withSession((deps) => acceptInvite(code, deps));
    if (!result?.ok) {
      busy.current = false;
      setJoining(false);
      setMessage(result?.message ?? 'Sign in again to join');
      return;
    }
    setNotice({
      kind: 'joined',
      name: preview.household_name,
      householdId: result.value.household_id,
    });
    await auth.refreshSession();
    router.replace('/');
  }

  const name = householdPhrase(preview?.household_name, 'the household');
  const blocked = preview?.blocker === 'only_admin';
  return (
    <Screen back={{ href: '/', label: 'All recipes' }}>
      {!preview && !message ? <ActivityIndicator color={colors.accent} /> : null}
      {preview?.status === 'ok' ? (
        <Card>
          <Text variant="h2">
            Join {name} as a {ROLE_LABEL[preview.role ?? 'member']}
          </Text>
          {preview.moving_recipes > 0 ? (
            <Text tone="muted">
              Your {preview.moving_recipes} {preview.moving_recipes === 1 ? 'recipe' : 'recipes'}{' '}
              will move to {name}
            </Text>
          ) : null}
          {blocked ? (
            <Banner tone="tag" role="alert">
              {HOUSEHOLD_MESSAGES.only_admin}
            </Banner>
          ) : null}
          {!blocked ? (
            <Button
              full
              label={joining ? 'Joining…' : 'Join'}
              aria-disabled={joining}
              onPress={() => void join()}
            />
          ) : null}
        </Card>
      ) : null}
      {preview?.status === 'already_member' ? <Text>You're already in {name}</Text> : null}
      {preview && STATUS_TEXT[preview.status] ? (
        <Banner tone="danger" role="alert">
          {STATUS_TEXT[preview.status]}
        </Banner>
      ) : null}
      {message ? (
        <Banner tone="danger" role="alert">
          {message}
        </Banner>
      ) : null}
    </Screen>
  );
}
