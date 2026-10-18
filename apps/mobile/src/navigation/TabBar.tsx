import { Link, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReadyCount } from '../imports/hooks';
import { canWrite } from '../session/claims';
import { useSession } from '../session/SessionProvider';
import { colors, shadow, space } from '../theme';
import { Icon, Text, type IconName } from '../ui';
import { AddSheet } from './AddSheet';
import { activeTab, addLabel, showTabBar, type Tab } from './tabs';

const TABS: Record<Tab, { label: string; href: Href; icon: IconName; on: IconName }> = {
  recipes: { label: 'Recipes', href: '/', icon: 'book-outline', on: 'book' },
  favorites: { label: 'Favorites', href: '/favorites', icon: 'heart-outline', on: 'heart' },
  household: { label: 'Household', href: '/household', icon: 'people-outline', on: 'people' },
};

function TabLink({ tab, current }: { tab: Tab; current: boolean }) {
  const item = TABS[tab];
  return (
    <Link href={item.href} asChild>
      <Pressable
        role="link"
        aria-label={item.label}
        aria-current={current ? 'page' : undefined}
        style={{
          minWidth: 72,
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <Icon name={current ? item.on : item.icon} color={current ? colors.accent : colors.muted} />
        <Text variant="caption" tone={current ? 'accent' : 'muted'}>
          {item.label}
        </Text>
      </Pressable>
    </Link>
  );
}

/** Recipes · Favorites · + · Household (UI spec §4). */
export function TabBar() {
  const path = usePathname();
  const { state } = useSession();
  const insets = useSafeAreaInsets();
  const ready = useReadyCount();
  const [adding, setAdding] = useState(false);
  const claims = state.status === 'signedIn' ? state.claims : null;
  if (!claims || !showTabBar(path, true)) return null;
  const current = activeTab(path);
  return (
    <>
      <View
        role="navigation"
        aria-label="Main"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          backgroundColor: colors.raised,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingTop: space.xs,
          // Clear of the iPhone home indicator (Review Focus 2).
          paddingBottom: Math.max(insets.bottom, space.sm),
        }}
      >
        <TabLink tab="recipes" current={current === 'recipes'} />
        <TabLink tab="favorites" current={current === 'favorites'} />
        {/* Viewers cannot add recipes: no "+" for them (rule 4). */}
        {canWrite(claims.role) ? (
          <Pressable
            role="button"
            aria-label={addLabel(ready)}
            onPress={() => setAdding(true)}
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              marginTop: -24,
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
              ...shadow,
            }}
          >
            <Icon name="add" size={30} color={colors.onAccent} />
            {ready > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  minWidth: 20,
                  height: 20,
                  borderRadius: 10,
                  paddingHorizontal: 4,
                  backgroundColor: colors.tag,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="caption" tone="onAccent">
                  {ready}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
        <TabLink tab="household" current={current === 'household'} />
      </View>
      <AddSheet open={adding} ready={ready} onClose={() => setAdding(false)} />
    </>
  );
}
