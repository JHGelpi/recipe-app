import type { ShareSnapshot } from '@recipe-app/domain';
import type { ApiDeps } from '../imports/api';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };
export const SHARE_MESSAGES: Record<string, string> = {
  forbidden: "Viewers can't add recipes. Ask an admin of your household.",
  own_household: 'This recipe is already in your household',
  share_unavailable: 'This recipe is no longer shared',
  not_found: 'This recipe could not be shared',
};
const OFFLINE = 'Sharing a link needs a connection';

async function call<T>(
  deps: ApiDeps,
  path: string,
  body: unknown,
  fallback: string,
): Promise<Result<T>> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok)
      return {
        ok: false,
        message: SHARE_MESSAGES[json?.error ?? ''] ?? fallback,
      };
    return { ok: true, value: json as T };
  } catch {
    return { ok: false, message: OFFLINE };
  }
}

export const createShare = (recipeId: string, deps: ApiDeps) =>
  call<{ code: string }>(
    deps,
    '/shares',
    { recipe_id: recipeId },
    "Couldn't make a link. Try again.",
  );
export const stopShares = (recipeId: string, deps: ApiDeps) =>
  call<{ stopped: number }>(
    deps,
    '/shares/stop',
    { recipe_id: recipeId },
    "Couldn't stop sharing. Try again.",
  );
export const saveShare = (code: string, deps: ApiDeps) =>
  call<{ recipe_id: string }>(
    deps,
    `/shares/${code}/save`,
    undefined,
    "Couldn't save this recipe. Try again.",
  );

/**
 * Readable by anyone with the link. A signed-in reader's token, when given,
 * only tells whether the share is from their own household.
 */
export async function readShare(
  code: string,
  fetchImpl: typeof fetch,
  apiUrl: string,
  token?: string | null,
): Promise<
  | { ok: true; snapshot: ShareSnapshot; hasPhoto: boolean; own: boolean }
  | { ok: false; status: string }
> {
  try {
    const response = await fetchImpl(`${apiUrl}/shares/${encodeURIComponent(code)}`, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (response.status >= 500) return { ok: false, status: 'error' };
    const json = (await response.json().catch(() => null)) as {
      snapshot?: ShareSnapshot;
      has_photo?: boolean;
      own?: boolean;
      status?: string;
    } | null;
    if (response.ok && json?.snapshot)
      return {
        ok: true,
        snapshot: json.snapshot,
        hasPhoto: Boolean(json.has_photo),
        own: json.own === true,
      };
    return { ok: false, status: json?.status ?? 'unknown' };
  } catch {
    return { ok: false, status: 'offline' };
  }
}
