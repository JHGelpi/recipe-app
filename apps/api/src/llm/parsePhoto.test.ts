import { describe, expect, it } from 'vitest';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { buildPhotoRequest } from './parsePhoto';

describe('buildPhotoRequest', () => {
  it('sends each page as a labelled JPEG, in order, then the household tags', () => {
    const pages = [syntheticJpeg(2, 2, 'one'), syntheticJpeg(2, 2, 'two')];
    const { system, user } = buildPhotoRequest(pages, ['dinner', 'quick']);
    expect(system).toContain('Page 1 of');
    expect(Array.isArray(user)).toBe(true);
    const blocks = user as {
      type: string;
      text?: string;
      source?: { media_type: string; data: string };
    }[];
    expect(blocks.map((block) => block.type)).toEqual(['text', 'image', 'text', 'image', 'text']);
    expect(blocks[0]?.text).toBe('Page 1 of 2');
    expect(blocks[2]?.text).toBe('Page 2 of 2');
    expect(blocks[1]?.source?.media_type).toBe('image/jpeg');
    expect(Buffer.from(blocks[3]!.source!.data, 'base64')).toEqual(Buffer.from(pages[1]!));
    expect(blocks[4]?.text).toBe('Tags this household already uses: dinner, quick');
  });

  it('says when the household has no tags yet', () => {
    const { user } = buildPhotoRequest([syntheticJpeg(2, 2)], []);
    expect((user as { text?: string }[]).at(-1)?.text).toBe(
      'Tags this household already uses: (none yet)',
    );
  });
});
