const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An 8-4-4-4-12 hex id, as the database's uuid columns accept. */
export function isGuid(value: string): boolean {
  return GUID.test(value);
}
