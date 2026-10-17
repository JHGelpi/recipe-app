import { config } from '../config';
import { auth } from '../session/auth';

export type ParseRequestOutcome =
  'started' | 'busy' | 'not_found' | 'forbidden' | 'reauth' | 'retry';
export type ApiDeps = { fetch: typeof fetch; apiUrl: string; token: string };
export type AiUsage = { spentUsd: number; capUsd: number };

const OUTCOMES: Record<number, ParseRequestOutcome> = {
  202: 'started',
  409: 'busy',
  404: 'not_found',
  403: 'forbidden',
  401: 'reauth',
};

/** Asks the server to read an import (ADR-0012). Never throws. */
export async function requestParse(id: string, deps: ApiDeps): Promise<ParseRequestOutcome> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}/imports/${encodeURIComponent(id)}/parse`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}` },
    });
    return OUTCOMES[response.status] ?? 'retry';
  } catch {
    return 'retry';
  }
}

/** NFR-7: this month's AI spend, or null offline or on any failure. */
export async function fetchUsage(deps: ApiDeps): Promise<AiUsage | null> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}/imports/usage`, {
      headers: { Authorization: `Bearer ${deps.token}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<AiUsage>;
    return typeof body.spentUsd === 'number' && typeof body.capUsd === 'number'
      ? { spentUsd: body.spentUsd, capUsd: body.capUsd }
      : null;
  } catch {
    return null;
  }
}

/** Runs `fn` with the current session's token, or returns null when signed out. */
export async function withSession<T>(fn: (deps: ApiDeps) => Promise<T>): Promise<T | null> {
  const { data } = await auth.getSession();
  if (!data.session) return null;
  return fn({
    fetch: (input, init) => fetch(input, init),
    apiUrl: config.apiUrl,
    token: data.session.access_token,
  });
}
