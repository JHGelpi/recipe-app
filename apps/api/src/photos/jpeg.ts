export type JpegInfo = { width: number; height: number };

// SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not.
const isFrameHeader = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * The size in a JPEG's frame header, or null when the bytes are not a whole
 * JPEG (spec §4). Reads the markers themselves; the declared type is ignored.
 */
export function jpegInfo(bytes: Uint8Array): JpegInfo | null {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) return null; // cut short
  let i = 2;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end or scan before any frame header
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2 || i + 2 + length > n) return null;
    if (isFrameHeader(marker)) {
      if (length < 7) return null;
      const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
      const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + length;
  }
  return null;
}
