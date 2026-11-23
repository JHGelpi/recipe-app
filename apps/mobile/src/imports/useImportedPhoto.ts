import { DISH_EDGE } from '@recipe-app/domain';
import { useEffect, useMemo, useState } from 'react';
import { preparePhoto } from '../photos/prepare';
import type { PhotoFile } from '../photos/repository';
import { usePhotoUri } from '../photos/usePhotoUri';
import { fetchImportImage, withSession } from './api';
import { pagePictureStep } from './review';
import type { ImportRecord } from './rows';

type Result = { state: 'none' | 'loading' | 'ready' | 'failed'; file: PhotoFile | null };
/** `settled` resolves once the picture is ready or has failed, so Save can wait for it. */
export type ImportedPhoto = Result & { settled: Promise<PhotoFile | null> };

const NONE: Result = { state: 'none', file: null };

function deferred() {
  let resolve: (file: PhotoFile | null) => void = () => undefined;
  const promise = new Promise<PhotoFile | null>((done) => (resolve = done));
  return { promise, resolve };
}

/**
 * FR-15, #116: the dish picture the import found, ready to save as the dish
 * photo. A link's picture comes through the server; a screenshot's is cut
 * from the page on this phone. Prepared while the review is open, because
 * saving ends the import.
 */
export function useImportedPhoto(
  record: ImportRecord | null | undefined,
  pages: { id: string }[],
): ImportedPhoto {
  const image = record?.status === 'ready' ? record.draft?.image : undefined;
  const pageId = image && 'page' in image ? (pages[image.page - 1]?.id ?? null) : null;
  const page = usePhotoUri(pageId);
  const [result, setResult] = useState<Result>(NONE);
  const id = record?.id;
  const imageKey = JSON.stringify(image ?? null);
  // Only a screenshot waits on its page; a link's picture must not refetch as it changes.
  const pageKey = pageId ? `${page.state} ${page.uri}` : '';
  // One per picture; settling it again is a no-op. imageKey stands for image.
  const settled = useMemo(deferred, [id, imageKey]);

  useEffect(() => {
    if (!image || !id) {
      settled.resolve(null);
      setResult(NONE);
      return;
    }
    let live = true;
    const finish = (file: PhotoFile | null) => {
      settled.resolve(file);
      if (live) setResult(file ? { state: 'ready', file } : { state: 'failed', file: null });
    };
    if ('url' in image) {
      setResult({ state: 'loading', file: null });
      void withSession((deps) => fetchImportImage(id, deps))
        .then((blob) => (blob ? preparePhoto(blob, DISH_EDGE) : null))
        .then(finish, () => finish(null));
    } else {
      const step = pagePictureStep(pageId, page.state);
      if (step === 'fail') finish(null);
      else if (step === 'wait' || !page.uri) setResult({ state: 'loading', file: null });
      else {
        const box = image.box;
        // Decoded as an image: the CSP's connect-src blocks fetch() of a blob: URL (ADR-0026).
        const img = new Image();
        img.src = page.uri;
        void img
          .decode()
          .then(() => preparePhoto(img, DISH_EDGE, box))
          .then(finish, () => finish(null));
      }
    }
    return () => {
      live = false;
    };
    // imageKey and pageKey stand for image and page in the dependencies.
  }, [id, imageKey, pageKey, settled]);

  return { ...result, settled: settled.promise };
}
