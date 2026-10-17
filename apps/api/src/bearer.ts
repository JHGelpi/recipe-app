/** The token of an `Authorization: Bearer …` header, or null. */
export function bearer(header: string | undefined): string | null {
  return /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? null;
}
