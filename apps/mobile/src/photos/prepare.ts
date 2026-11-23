import { cropRect, fitWithin, type DishBox } from '@recipe-app/domain';
import type { PhotoFile } from './repository';

export const JPEG_QUALITY = 0.82;

export class PhotoReadError extends Error {
  constructor() {
    super("Couldn't open that photo");
  }
}

/**
 * Spec §6: the picked photo upright, scaled to `maxEdge` on the long side,
 * re-encoded as JPEG. Re-encoding drops EXIF, including the location.
 * With a `box`, only that part of it (#116: the dish cut from a screenshot).
 */
export async function preparePhoto(file: Blob, maxEdge: number, box?: DishBox): Promise<PhotoFile> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoReadError();
  }
  const crop = box
    ? cropRect(bitmap.width, bitmap.height, box)
    : { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const size = fitWithin(crop.width, crop.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoReadError();
  context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new PhotoReadError();
  return { blob, ...size };
}
