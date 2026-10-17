/**
 * A few bytes with a JPEG's markers and a baseline frame header: enough for
 * the API's checks and for the fake Claude to read the comment, not a
 * viewable picture. The comment travels in a COM segment.
 */
export function syntheticJpeg(
  width: number,
  height: number,
  comment = '',
): Uint8Array<ArrayBuffer> {
  const text = [...new TextEncoder().encode(comment)];
  const com =
    text.length > 0 ? [0xff, 0xfe, (text.length + 2) >> 8, (text.length + 2) & 0xff, ...text] : [];
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    ...com,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00, // SOF0
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00, // SOS
    0x00,
    0x00, // scan data
    0xff,
    0xd9, // EOI
  ]);
}
