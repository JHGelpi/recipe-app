// Which kind of link this visitor opened last (production spec §4): a friend
// link opened now beats an invite or share opened earlier in the tab.
const KEY = 'recipes.latestLink';
export type LinkKind = 'invite' | 'share' | 'friend';

export function markLatestLink(kind: LinkKind): void {
  globalThis.sessionStorage?.setItem(KEY, kind);
}

export function latestLink(): LinkKind | null {
  const kind = globalThis.sessionStorage?.getItem(KEY) ?? null;
  return kind === 'invite' || kind === 'share' || kind === 'friend' ? kind : null;
}
