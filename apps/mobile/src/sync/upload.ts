import {
  AISLE_CHOICE_CLIENT_FIELDS,
  COOK_LOG_CLIENT_FIELDS,
  FAVORITE_CLIENT_FIELDS,
  IMPORT_CLIENT_FIELDS,
  PERSON_SETTINGS_CLIENT_FIELDS,
  PHOTO_CLIENT_FIELDS,
  RECIPE_CLIENT_FIELDS,
  RECIPE_RATING_CLIENT_FIELDS,
  SHOPPING_ITEM_CLIENT_FIELDS,
} from '@recipe-app/domain';

export type UploadOp = {
  op: 'put' | 'patch' | 'delete';
  table: string;
  id: string;
  data?: Record<string, unknown>;
};

/** The parts of a PowerSync CRUD entry this module needs. */
export type CrudLike = {
  op: string;
  table: string;
  id: string;
  opData?: Record<string, unknown>;
};

export type Rejection = { id: string; reason: string };

export type SendResult =
  { outcome: 'done'; rejected: Rejection[] } | { outcome: 'retry' } | { outcome: 'reauth' };

export type SendDeps = { fetch: typeof fetch; url: string; token: string };

/** Fields the client may upload, per table. Server-owned fields never leave the device. */
const CLIENT_FIELDS: Record<string, readonly string[]> = {
  recipes: RECIPE_CLIENT_FIELDS,
  favorites: FAVORITE_CLIENT_FIELDS,
  imports: IMPORT_CLIENT_FIELDS,
  photos: PHOTO_CLIENT_FIELDS,
  shopping_items: SHOPPING_ITEM_CLIENT_FIELDS,
  aisle_choices: AISLE_CHOICE_CLIENT_FIELDS,
  cook_logs: COOK_LOG_CLIENT_FIELDS,
  recipe_ratings: RECIPE_RATING_CLIENT_FIELDS,
  person_settings: PERSON_SETTINGS_CLIENT_FIELDS,
};

// The local database stores these as JSON text; the API expects arrays.
const JSON_FIELDS: Record<string, readonly string[]> = {
  recipes: ['ingredients', 'steps', 'tags', 'nutrition'],
};

function decoded(table: string, key: string, value: unknown): unknown {
  if (typeof value !== 'string' || !(JSON_FIELDS[table] ?? []).includes(key)) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Left as text: the server rejects it rather than the upload loop failing.
    return value;
  }
}

function pickClientFields(table: string, data: Record<string, unknown> = {}) {
  const allowed = CLIENT_FIELDS[table] ?? [];
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key, value]) => allowed.includes(key) && value !== undefined)
      .map(([key, value]) => [key, decoded(table, key, value)]),
  );
}

export function toUploadOps(entries: CrudLike[]): UploadOp[] {
  const ops: UploadOp[] = [];
  for (const entry of entries) {
    if (entry.op === 'DELETE') {
      ops.push({ op: 'delete', table: entry.table, id: entry.id });
      continue;
    }
    const data = pickClientFields(entry.table, entry.opData);
    if (entry.op === 'PUT') {
      // A new row: null columns carry no information, so leave them out.
      const present = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== null),
      );
      ops.push({ op: 'put', table: entry.table, id: entry.id, data: present });
    } else if (Object.keys(data).length > 0) {
      ops.push({ op: 'patch', table: entry.table, id: entry.id, data });
    }
  }
  return ops;
}

function isResults(
  body: unknown,
): body is { results: { id: string; status: string; reason?: string }[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { results?: unknown }).results)
  );
}

/**
 * Sends one batch to /upload and says what the caller should do next.
 * - done: finished; drop the batch (rejected ops are listed for logging)
 * - retry: temporary failure; keep the batch queued
 * - reauth: the token was refused; refresh the session, then retry
 */
export async function sendOps(ops: UploadOp[], deps: SendDeps): Promise<SendResult> {
  let response: Response;
  try {
    response = await deps.fetch(deps.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deps.token}`,
      },
      body: JSON.stringify({ ops }),
    });
  } catch {
    return { outcome: 'retry' };
  }

  if (response.status === 401) return { outcome: 'reauth' };
  if (response.status >= 500) return { outcome: 'retry' };
  if (!response.ok) {
    // The server will never accept this batch. Dropping it keeps one bad
    // batch from blocking every later change.
    const reason = `http_${response.status}`;
    return { outcome: 'done', rejected: ops.map((op) => ({ id: op.id, reason })) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { outcome: 'retry' };
  }
  if (!isResults(body)) return { outcome: 'retry' };

  const rejected = body.results
    .filter((result) => result.status === 'rejected')
    .map((result) => ({ id: result.id, reason: result.reason ?? 'unknown' }));
  return { outcome: 'done', rejected };
}
