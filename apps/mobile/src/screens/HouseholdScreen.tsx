import type { HouseholdRoleName, UnitSystem } from '@recipe-app/domain';
import { usePowerSync } from '@powersync/react';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { confirm } from '../components/confirm';
import { useUnitsPreference } from '../cooking/useUnitsPreference';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { withSession } from '../imports/api';
import {
  cancelInvite,
  createFriendLink,
  createInvite,
  friendUrl,
  inviteUrl,
  leaveHousehold,
  acceptedLine,
  listAcceptedFriendLinks,
  listAcceptedInvites,
  listFriendLinks,
  listInvites,
  removeMember,
  renameHousehold,
  revokeFriendLink,
  setMemberRole,
  type AcceptedInvite,
  type FriendLink,
  type PendingInvite,
  type Result,
} from '../household/api';
import { useHouseholdName, useMembers } from '../household/hooks';
import { shareLink } from '../household/share';
import { waitForUploads } from '../household/uploads';
import { auth } from '../session/auth';
import { clearFilter } from '../recipes/listFilter';
import { canWrite, type Claims } from '../session/claims';
import { useSession } from '../session/SessionProvider';
import { colors, radius, space, useAppearance, type Appearance } from '../theme';
import {
  Banner,
  Button,
  Card,
  Chip,
  Icon,
  PillTabs,
  RowCard,
  Screen,
  Text,
  TextField,
} from '../ui';

const ROLES: [HouseholdRoleName, string][] = [
  ['admin', 'Admin'],
  ['member', 'Member'],
  ['viewer', 'Viewer'],
];
const days = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

const UNITS_TABS: readonly { value: UnitSystem; label: string }[] = [
  { value: 'as_written', label: 'As written' },
  { value: 'us', label: 'US' },
  { value: 'metric', label: 'Metric' },
];

const APPEARANCE_TABS: readonly { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** FR-42: invitations that were used, newest first (the last 30 days). */
function AcceptedList({ title, items }: { title: string; items: AcceptedInvite[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <Text role="heading" aria-level={3} variant="h3">
        {title}
      </Text>
      {items.map((item) => (
        <Text key={item.id} tone="muted">
          {acceptedLine(item)}
        </Text>
      ))}
    </>
  );
}

/** FR-3–FR-6: who is in the household, and (for Admins) invites and roles. */
export function HouseholdScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const { signOut } = useSession();
  const online = useNetworkOnline();
  const { appearance, setAppearance } = useAppearance();
  const { units, setUnits } = useUnitsPreference();
  const members = useMembers(claims.householdId);
  const name = useHouseholdName(claims.householdId);
  const admin = claims.role === 'admin';
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [acceptedInvites, setAcceptedInvites] = useState<AcceptedInvite[]>([]);
  const [acceptedFriends, setAcceptedFriends] = useState<AcceptedInvite[]>([]);
  const [inviteRole, setInviteRole] = useState<HouseholdRoleName>('member');
  const [shared, setShared] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!admin || !online) return;
    const result = await withSession(listInvites);
    if (result?.ok) setInvites(result.value);
    const accepted = await withSession(listAcceptedInvites);
    if (accepted?.ok) setAcceptedInvites(accepted.value);
  }, [admin, online]);
  useEffect(() => void refresh(), [refresh]);
  const [friendLinks, setFriendLinks] = useState<FriendLink[]>([]);
  const refreshFriendLinks = useCallback(async () => {
    if (!online) return;
    const result = await withSession(listFriendLinks);
    if (result?.ok) setFriendLinks(result.value);
    const accepted = await withSession(listAcceptedFriendLinks);
    if (accepted?.ok) setAcceptedFriends(accepted.value);
  }, [online]);
  useEffect(() => void refreshFriendLinks(), [refreshFriendLinks]);

  async function act<T>(run: () => Promise<Result<T> | null>, then?: (value: T) => void) {
    setMessage(null);
    const result = await run();
    if (!result) setMessage('Sign in again to change the household');
    else if (!result.ok) setMessage(result.message);
    else then?.(result.value);
  }

  async function invite() {
    await act(
      () => withSession((deps) => createInvite(inviteRole, deps)),
      async (created) => {
        const url = inviteUrl(created.code);
        setShared(url);
        const how = await shareLink(`Join the ${name ?? 'household'} on Dishkept: ${url}`, url);
        if (how === 'copied') setMessage('Link copied');
        void refresh();
      },
    );
  }

  return (
    <Screen back={{ href: '/', label: 'All recipes' }}>
      <Text role="heading" aria-level={1} variant="h1">
        Household
      </Text>
      <Card>
        {newName === null ? (
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <Text variant="h2" style={{ flex: 1 }}>
              {name ?? ''}
            </Text>
            {admin && online ? (
              <Button variant="ghost" label="Rename" onPress={() => setNewName(name ?? '')} />
            ) : null}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <TextField label="Household name" value={newName} onChangeText={setNewName} />
            </View>
            <Button
              label="Save"
              onPress={() =>
                void act(
                  () => withSession((deps) => renameHousehold(newName, deps)),
                  () => setNewName(null),
                )
              }
            />
          </View>
        )}
        {!online ? <Text tone="muted">Changing the household needs a connection</Text> : null}
      </Card>
      {message ? (
        <Banner tone={message === 'Link copied' ? 'accent' : 'danger'} role="alert">
          {message}
        </Banner>
      ) : null}

      <Card title="Members">
        {members.map((member) => {
          const label = member.email ?? 'Email not known yet';
          const me = member.user_id === claims.userId;
          return (
            <View
              key={member.user_id}
              style={{
                gap: space.sm,
                borderTopWidth: 1,
                borderColor: colors.line,
                paddingTop: space.md,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                {/* Wraps, so a long email never hides "(you)". */}
                <Text style={{ flex: 1 }}>
                  {label}
                  {me ? ' (you)' : ''}
                </Text>
                <Chip label={ROLES.find(([role]) => role === member.role)?.[1] ?? member.role} />
              </View>
              {member.created_at ? (
                <Text variant="small" tone="muted">
                  Joined {new Date(member.created_at).toLocaleDateString()}
                </Text>
              ) : null}
              {admin && online ? (
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: space.sm,
                    alignItems: 'center',
                  }}
                >
                  {ROLES.map(([role, text]) => (
                    <Chip
                      key={role}
                      label={text}
                      tone={member.role === role ? 'selected' : 'neutral'}
                      aria-label={`${text} role for ${label}`}
                      aria-pressed={member.role === role}
                      onPress={() =>
                        void act(() =>
                          withSession((deps) => setMemberRole(member.user_id, role, deps)),
                        )
                      }
                    />
                  ))}
                  {!me ? (
                    <Button
                      variant="ghost"
                      label="Remove"
                      aria-label={`Remove ${label}`}
                      onPress={async () => {
                        if (
                          await confirm(
                            `Remove ${label} from the household? They'll keep their account and get an empty household of their own. Recipes they added stay here.`,
                          )
                        ) {
                          await act(() =>
                            withSession((deps) => removeMember(member.user_id, deps)),
                          );
                        }
                      }}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      {admin && online ? (
        <Card title="Invite someone">
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {ROLES.map(([role, text]) => (
              <Chip
                key={role}
                label={text}
                tone={inviteRole === role ? 'selected' : 'neutral'}
                aria-pressed={inviteRole === role}
                onPress={() => setInviteRole(role)}
              />
            ))}
          </View>
          <Button full icon="share-outline" label="Share invite" onPress={() => void invite()} />
          {shared ? (
            <Text
              aria-label="Invite link"
              selectable
              variant="small"
              tone="accent"
              style={{
                backgroundColor: colors.raised,
                padding: space.sm,
                borderRadius: radius.field,
              }}
            >
              {shared}
            </Text>
          ) : null}
          {invites.length > 0 ? (
            <>
              <Text role="heading" aria-level={3} variant="h3">
                Pending invites
              </Text>
              {invites.map((pending) => (
                <View
                  key={pending.id}
                  style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}
                >
                  <Text tone="muted" style={{ flex: 1 }}>
                    {ROLES.find(([role]) => role === pending.role)?.[1]} · expires in{' '}
                    {days(pending.expires_at)} days
                  </Text>
                  <Button
                    variant="ghost"
                    label="Cancel"
                    onPress={() =>
                      void act(
                        () => withSession((deps) => cancelInvite(pending.id, deps)),
                        () => void refresh(),
                      )
                    }
                  />
                </View>
              ))}
            </>
          ) : null}
          <AcceptedList title="Accepted invites" items={acceptedInvites} />
        </Card>
      ) : null}

      {members.length > 1 && online ? (
        <Button
          variant="danger"
          label="Leave household"
          onPress={async () => {
            if (
              await confirm(
                'Leave the household? You will get an empty household of your own. The recipes stay here.',
              )
            ) {
              // Leaving wipes this phone's copy: unsent changes go first.
              if (!(await waitForUploads(db))) {
                setMessage('Still saving your changes. Try again in a moment.');
                return;
              }
              await act(
                () => withSession(leaveHousehold),
                async () => {
                  // The new household's data replaces this one on the list.
                  await auth.refreshSession();
                  router.replace('/');
                },
              );
            }
          }}
        />
      ) : null}
      {online ? (
        <>
          <Button
            variant="ghost"
            label="Invite a friend to Dishkept"
            onPress={() =>
              void act(
                () => withSession(createFriendLink),
                async ({ code }) => {
                  const url = friendUrl(code);
                  const how = await shareLink(
                    `Make your own recipe collection on Dishkept: ${url}`,
                    url,
                  );
                  if (how === 'copied') setMessage('Link copied');
                  void refreshFriendLinks();
                },
              )
            }
          />
          {friendLinks.length > 0 || acceptedFriends.length > 0 ? (
            <Card title="Friend links" level={3}>
              {friendLinks.map((link) => {
                const made = new Date(link.created_at).toLocaleDateString();
                return (
                  <View
                    key={link.id}
                    style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}
                  >
                    <Text tone="muted" style={{ flex: 1 }}>
                      Expires in {days(link.expires_at)} days · made {made}
                    </Text>
                    <Button
                      variant="ghost"
                      label="Revoke"
                      aria-label={`Revoke link made ${made}`}
                      onPress={async () => {
                        if (
                          !(await confirm(
                            'Revoke this link? Anyone who has it can no longer use it to join Dishkept.',
                          ))
                        )
                          return;
                        await act(
                          () => withSession((deps) => revokeFriendLink(link.id, deps)),
                          () => void refreshFriendLinks(),
                        );
                      }}
                    />
                  </View>
                );
              })}
              <AcceptedList title="Used links" items={acceptedFriends} />
            </Card>
          ) : null}
        </>
      ) : null}
      {/* A device setting, not household data, so viewers have it too (rule 4 doesn't apply). */}
      <Card title="Appearance">
        <PillTabs tabs={APPEARANCE_TABS} value={appearance} onChange={setAppearance} />
      </Card>
      {/* FR-23: a device setting too; recipes opened afresh start in these units. */}
      <Card title="Units">
        <PillTabs tabs={UNITS_TABS} value={units} onChange={setUnits} />
      </Card>
      <RowCard
        title="Cook diary"
        subtitle="What the household cooked, with notes and photos"
        href="/diary"
        leading={<Icon name="journal-outline" color={colors.muted} />}
        trailing={<Icon name="chevron-forward" color={colors.muted} />}
      />
      {canWrite(claims.role) ? (
        <RowCard
          title="Trash"
          subtitle="Deleted recipes and diary entries, kept for 30 days"
          href="/trash"
          leading={<Icon name="trash-outline" color={colors.muted} />}
          trailing={<Icon name="chevron-forward" color={colors.muted} />}
        />
      ) : null}
      <Button
        variant="secondary"
        icon="log-out-outline"
        label="Sign out"
        onPress={() => {
          clearFilter();
          void signOut();
        }}
      />
    </Screen>
  );
}
