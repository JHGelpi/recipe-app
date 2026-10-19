// apps/api/src/import/charset.ts
const META = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i;

/**
 * A page's bytes as text in its own charset (spec §3): the Content-Type's,
 * else a <meta charset> in the first 2 KB, else UTF-8. An unknown label reads
 * as UTF-8.
 */
export function decodePage(bytes: Uint8Array, contentType: string): string {
  const declared =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ??
    META.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 2048)))?.[1] ??
    'utf-8';
  try {
    return new TextDecoder(declared).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
