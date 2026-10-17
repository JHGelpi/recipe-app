/** Opens the share sheet where there is one; otherwise copies the link. */
export async function shareLink(
  text: string,
  url: string,
): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.share) {
    try {
      await nav.share({ text, url });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await nav?.clipboard?.writeText(url).catch(() => undefined);
  return 'copied';
}
