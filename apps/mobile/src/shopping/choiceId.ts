// The id of a household's aisle choice is derived from the household and the
// item (shopping spec §4), so phones choosing offline write the same row and a
// later change is an update the server can always find (review I3).

// A fixed namespace for Dishkept's aisle choices (any v4 UUID, never changed).
const NAMESPACE = 'b7e1f0a2-5c3d-4e8f-9a1b-2c3d4e5f6a7b';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** RFC 4122 version 5: SHA-1 of the namespace's bytes and the name. */
export async function uuidV5(namespace: string, name: string): Promise<string> {
  const space = Uint8Array.from(
    namespace
      .replaceAll('-', '')
      .match(/../g)!
      .map((pair) => parseInt(pair, 16)),
  );
  const text = new TextEncoder().encode(name);
  const input = new Uint8Array(space.length + text.length);
  input.set(space);
  input.set(text, space.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input)).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const h = hex(digest);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function aisleChoiceId(householdId: string, itemKey: string): Promise<string> {
  return uuidV5(NAMESPACE, `${householdId}:${itemKey}`);
}
