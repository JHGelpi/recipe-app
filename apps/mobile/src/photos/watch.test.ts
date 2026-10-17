import { expect, it } from 'vitest';
import { watchedPhotos } from './watch';

it('keeps every live recipe’s dish photo as a JPEG to download', () => {
  expect(watchedPhotos([{ id: 'p1' }, { id: null }, { id: 'p2' }])).toEqual([
    { id: 'p1', fileExtension: 'jpg', mediaType: 'image/jpeg' },
    { id: 'p2', fileExtension: 'jpg', mediaType: 'image/jpeg' },
  ]);
});
