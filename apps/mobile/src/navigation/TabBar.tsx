import { Link, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReadyCount } from '../imports/hooks';
import { useToBuyCount } from '../shopping/hooks';
import { canWrite } from '../session/claims';
import { useSession } from '../session/SessionProvider';
import { colors, shadow, space } from '../theme';
import { Icon, Text, type IconName } from '../ui';
import { AddSheet } from './AddSheet';
import { activeTab, addLabel, listLabel, showTabBar, type Tab } from './tabs';

const TABS: Record<Tab, { label: string; href: Href; icon: IconName; on: IconName }> = {
  recipes: { label: 'Recipes', href: '/', icon: 'book-outline', on: 'book' },
  favorites: { label: 'Favorites', href: '/favorites', icon: 'heart-outline', on: 'heart' },
  list: { label: 'List', href: '/list', icon: 'cart-outline', on: 'cart' },
  household: { label: 'Household', href: '/household', icon: 'people-outline', on: 'people' },
};

/** The amber count on "+" and on List. */
function Badge({ count }: { count: number }) {
  return (
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
        {count}
      </Text>
    </View>
  );
}

function TabLink({
  tab,
  current,
  name,
  badge = 0,
}: {
  tab: Tab;
  current: boolean;
  name?: string;
  badge?: number;
}) {
  const item = TABS[tab];
  return (
    <Link href={item.href} asChild>
      <Pressable
        role="link"
        aria-label={name ?? item.label}
        aria-current={current ? 'page' : undefined}
        style={{
          flex: 1,
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <View>
          <Icon
            name={current ? item.on : item.icon}
            color={current ? colors.accent : colors.muted}
          />
          {badge > 0 ? <Badge count={badge} /> : null}
        </View>
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
  const toBuy = useToBuyCount();
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
          <View style={{ flex: 1, alignItems: 'center' }}>
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
              {ready > 0 ? <Badge count={ready} /> : null}
            </Pressable>
          </View>
        ) : null}
        <TabLink tab="list" current={current === 'list'} name={listLabel(toBuy)} badge={toBuy} />
        <TabLink tab="household" current={current === 'household'} />
      </View>
      <AddSheet open={adding} ready={ready} onClose={() => setAdding(false)} />
    </>
  );
}
