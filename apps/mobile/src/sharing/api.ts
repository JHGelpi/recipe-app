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

async function call<T>(deps: ApiDeps, path: string, body?: unknown): Promise<Result<T>> {
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
        message: SHARE_MESSAGES[json?.error ?? ''] ?? 'Something went wrong. Try again.',
      };
    return { ok: true, value: json as T };
  } catch {
    return { ok: false, message: OFFLINE };
  }
}

export const createShare = (recipeId: string, deps: ApiDeps) =>
  call<{ code: string }>(deps, '/shares', { recipe_id: recipeId });
export const stopShares = (recipeId: string, deps: ApiDeps) =>
  call<{ stopped: number }>(deps, '/shares/stop', { recipe_id: recipeId });
export const saveShare = (code: string, deps: ApiDeps) =>
  call<{ recipe_id: string }>(deps, `/shares/${code}/save`);

/** No token: a shared page is readable by anyone with the link. */
export async function readShare(
  code: string,
  fetchImpl: typeof fetch,
  apiUrl: string,
): Promise<
  { ok: true; snapshot: ShareSnapshot; hasPhoto: boolean } | { ok: false; status: string }
> {
  try {
    const response = await fetchImpl(`${apiUrl}/shares/${encodeURIComponent(code)}`, {
      cache: 'no-store',
      headers: {},
    });
    const json = (await response.json().catch(() => null)) as {
      snapshot?: ShareSnapshot;
      has_photo?: boolean;
      status?: string;
    } | null;
    if (response.ok && json?.snapshot)
      return { ok: true, snapshot: json.snapshot, hasPhoto: Boolean(json.has_photo) };
    return { ok: false, status: json?.status ?? 'unknown' };
  } catch {
    return { ok: false, status: 'offline' };
  }
}
