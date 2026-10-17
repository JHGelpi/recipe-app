import type { WatchedAttachmentItem } from '@powersync/web';

/**
 * Spec §6: every live recipe's dish photo is kept on the phone, so lists and
 * recipes look complete offline. Pages are not watched: they are kept only
 * until uploaded, then fetched when opened.
 */
export const DISH_PHOTOS_SQL = `select p.id from recipes r join photos p on p.id = r.photo_id
  where r.deleted_at is null and p.deleted_at is null`;

export function watchedPhotos(rows: { id: unknown }[]): WatchedAttachmentItem[] {
  return rows.flatMap((row) =>
    typeof row.id === 'string'
      ? [{ id: row.id, fileExtension: 'jpg', mediaType: 'image/jpeg' }]
      : [],
  );
}
