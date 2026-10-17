import { describe, expect, it } from 'vitest';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { jpegInfo } from './jpeg';

describe('jpegInfo', () => {
  it('reads the size from the frame header, past a comment', () => {
    expect(jpegInfo(syntheticJpeg(1568, 1176, 'FAKE_PHOTO'))).toEqual({
      width: 1568,
      height: 1176,
    });
  });

  it('reads a progressive frame header too', () => {
    const bytes = syntheticJpeg(30, 20);
    bytes[3] = 0xc2; // SOF0 → SOF2
    expect(jpegInfo(bytes)).toEqual({ width: 30, height: 20 });
  });

  it('refuses a PNG, text, an empty body and a truncated file', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(jpegInfo(png)).toBeNull();
    expect(jpegInfo(new TextEncoder().encode('<svg/>'))).toBeNull();
    expect(jpegInfo(new Uint8Array())).toBeNull();
    expect(jpegInfo(syntheticJpeg(10, 10).subarray(0, 12))).toBeNull();
    expect(jpegInfo(syntheticJpeg(10, 10).slice(0, -2))).toBeNull();
  });

  it('refuses a zero-sized frame and a segment that runs past the end', () => {
    expect(jpegInfo(syntheticJpeg(0, 10))).toBeNull();
    const bytes = syntheticJpeg(10, 10);
    bytes[4] = 0x7f; // SOF0 length far past the end
    expect(jpegInfo(bytes)).toBeNull();
  });
});
