import type Anthropic from '@anthropic-ai/sdk';
import prompt from './prompts/parse-recipe-photo.v2.md';
import type { ParseRequest } from './parseRecipe';

export const PHOTO_PROMPT_VERSION = 'parse-recipe-photo.v2';

/**
 * FR-7: the pages as JPEG image blocks, each labelled with its place, then
 * the household's tags. The tool and its validation are the text parser's.
 */
export function buildPhotoRequest(pages: Uint8Array[], householdTags: string[]): ParseRequest {
  const tags = householdTags.length > 0 ? householdTags.join(', ') : '(none yet)';
  const user: Anthropic.ContentBlockParam[] = pages.flatMap(
    (bytes, index): Anthropic.ContentBlockParam[] => [
      { type: 'text', text: `Page ${index + 1} of ${pages.length}` },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: Buffer.from(bytes).toString('base64'),
        },
      },
    ],
  );
  user.push({ type: 'text', text: `Tags this household already uses: ${tags}` });
  return { system: prompt, user };
}
