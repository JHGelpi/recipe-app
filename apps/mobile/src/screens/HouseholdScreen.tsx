import type { HouseholdRoleName } from '@recipe-app/domain';
import { usePowerSync } from '@powersync/react';
import { Link, router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { confirm } from '../components/confirm';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { withSession } from '../imports/api';
import {
  cancelInvite,
  createInvite,
  inviteUrl,
  leaveHousehold,
  listInvites,
  removeMember,
  renameHousehold,
  setMemberRole,
  type PendingInvite,
  type Result,
} from '../household/api';
import { useHouseholdName, useMembers } from '../household/hooks';
import { shareLink } from '../household/share';
import { waitForUploads } from '../household/uploads';
import { auth } from '../session/auth';
import type { Claims } from '../session/claims';

const ROLES: [HouseholdRoleName, string][] = [
  ['admin', 'Admin'],
  ['member', 'Member'],
  ['viewer', 'Viewer'],
];
const link = { textDecorationLine: 'underline' } as const;
const box = { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 } as const;
const days = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/** FR-3–FR-6: who is in the household, and (for Admins) invites and roles. */
export function HouseholdScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const online = useNetworkOnline();
  const members = useMembers(claims.householdId);
  const name = useHouseholdName(claims.householdId);
  const admin = claims.role === 'admin';
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [inviteRole, setInviteRole] = useState<HouseholdRoleName>('member');
  const [shared, setShared] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!admin || !online) return;
    const result = await withSession(listInvites);
    if (result?.ok) setInvites(result.value);
  }, [admin, online]);
  useEffect(() => void refresh(), [refresh]);

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
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 640 }}>
      <Link href="/" style={link}>
        All recipes
      </Link>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Household
      </Text>
      {newName === null ? (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 18 }}>{name ?? ''}</Text>
          {admin && online ? (
            <Pressable role="button" onPress={() => setNewName(name ?? '')} style={box}>
              <Text style={link}>Rename</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            aria-label="Household name"
            value={newName}
            onChangeText={setNewName}
            style={{ borderWidth: 1, borderColor: '#888', borderRadius: 6, padding: 8, flex: 1 }}
          />
          <Pressable
            role="button"
            style={box}
            onPress={() =>
              void act(
                () => withSession((deps) => renameHousehold(newName, deps)),
                () => setNewName(null),
              )
            }
          >
            <Text style={link}>Save</Text>
          </Pressable>
        </View>
      )}

      {!online ? (
        <Text style={{ color: '#555' }}>Changing the household needs a connection</Text>
      ) : null}
      {message ? (
        <Text role="alert" style={{ color: message === 'Link copied' ? '#1a5d3a' : '#b00020' }}>
          {message}
        </Text>
      ) : null}

      <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
        Members
      </Text>
      {members.map((member) => {
        const label = member.email ?? 'Email not known yet';
        const me = member.user_id === claims.userId;
        return (
          <View
            key={member.user_id}
            style={{ gap: 4, borderTopWidth: 1, borderColor: '#ddd', paddingTop: 8 }}
          >
            <Text>
              {label}
              {me ? ' (you)' : ''}
            </Text>
            <Text style={{ color: '#555' }}>
              {ROLES.find(([role]) => role === member.role)?.[1] ?? member.role}
              {member.created_at
                ? ` · joined ${new Date(member.created_at).toLocaleDateString()}`
                : ''}
            </Text>
            {admin && online ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {ROLES.map(([role, text]) => (
                  <Pressable
                    key={role}
                    role="button"
                    aria-label={`${text} role for ${label}`}
                    aria-pressed={member.role === role}
                    style={box}
                    onPress={() =>
                      void act(() =>
                        withSession((deps) => setMemberRole(member.user_id, role, deps)),
                      )
                    }
                  >
                    <Text style={{ fontWeight: member.role === role ? '700' : '400' }}>{text}</Text>
                  </Pressable>
                ))}
                {!me ? (
                  <Pressable
                    role="button"
                    aria-label={`Remove ${label}`}
                    style={box}
                    onPress={async () => {
                      if (
                        await confirm(
                          `Remove ${label} from the household? They'll keep their account and get an empty household of their own. Recipes they added stay here.`,
                        )
                      ) {
                        await act(() => withSession((deps) => removeMember(member.user_id, deps)));
                      }
                    }}
                  >
                    <Text style={{ ...link, color: '#b00020' }}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      {admin && online ? (
        <View style={{ gap: 8 }}>
          <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
            Invite someone
          </Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {ROLES.map(([role, text]) => (
              <Pressable
                key={role}
                role="button"
                aria-pressed={inviteRole === role}
                onPress={() => setInviteRole(role)}
                style={{
                  ...box,
                  borderRadius: 6,
                  backgroundColor: inviteRole === role ? '#e6f0ea' : 'transparent',
                }}
              >
                <Text style={{ fontWeight: inviteRole === role ? '700' : '400' }}>{text}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            role="button"
            onPress={() => void invite()}
            style={{
              backgroundColor: '#1a5d3a',
              borderRadius: 8,
              minHeight: 44,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16 }}>Share invite</Text>
          </Pressable>
          {shared ? (
            <Text
              aria-label="Invite link"
              selectable
              style={{ backgroundColor: '#f4f4f4', padding: 8, borderRadius: 6 }}
            >
              {shared}
            </Text>
          ) : null}
          {invites.length > 0 ? (
            <>
              <Text role="heading" aria-level={3} style={{ fontWeight: '600' }}>
                Pending invites
              </Text>
              {invites.map((pending) => (
                <View
                  key={pending.id}
                  style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}
                >
                  <Text style={{ flex: 1 }}>
                    {ROLES.find(([role]) => role === pending.role)?.[1]} · expires in{' '}
                    {days(pending.expires_at)} days
                  </Text>
                  <Pressable
                    role="button"
                    style={box}
                    onPress={() =>
                      void act(
                        () => withSession((deps) => cancelInvite(pending.id, deps)),
                        () => void refresh(),
                      )
                    }
                  >
                    <Text style={link}>Cancel</Text>
                  </Pressable>
                </View>
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      {members.length > 1 && online ? (
        <Pressable
          role="button"
          style={box}
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
        >
          <Text style={{ ...link, color: '#b00020' }}>Leave household</Text>
        </Pressable>
      ) : null}
      <Pressable
        role="button"
        style={box}
        onPress={() => {
          const url = globalThis.location?.origin ?? '';
          void shareLink(`Make your own recipe collection: ${url}`, url).then((how) => {
            if (how === 'copied') setMessage('Link copied');
          });
        }}
      >
        <Text style={link}>Invite a friend to Dishkept</Text>
      </Pressable>
    </ScrollView>
  );
}
