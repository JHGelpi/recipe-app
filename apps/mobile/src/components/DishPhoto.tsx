import { usePowerSync } from '@powersync/react';
import { DISH_EDGE } from '@recipe-app/domain';
import { useState } from 'react';
import { View } from 'react-native';
import { pickPhotos } from '../photos/pick';
import { preparePhoto, PhotoReadError } from '../photos/prepare';
import { photoSaver } from '../photos/queue';
import { removeDishPhoto, setDishPhoto } from '../photos/repository';
import { canWrite, type Claims } from '../session/claims';
import { radius, space } from '../theme';
import { Banner, Button } from '../ui';
import { confirm } from './confirm';
import { PhotoImage } from './PhotoImage';

/** FR-15: the recipe's dish photo, with Add / Change / Remove for admins and members. */
export function DishPhoto({
  claims,
  recipeId,
  photoId,
  editable,
}: {
  claims: Claims;
  recipeId: string;
  photoId: string | null;
  editable: boolean;
}) {
  const db = usePowerSync();
  const [error, setError] = useState<string | null>(null);
  const writer = editable && canWrite(claims.role);

  async function choose() {
    const [file] = await pickPhotos(false);
    if (!file) return;
    setError(null);
    try {
      await setDishPhoto(db, photoSaver(db), claims, recipeId, await preparePhoto(file, DISH_EDGE));
    } catch (caught) {
      setError(
        caught instanceof PhotoReadError ? caught.message : 'Could not save the photo. Try again.',
      );
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      {photoId ? (
        <PhotoImage
          id={photoId}
          label="Dish photo"
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.card }}
        />
      ) : null}
      {writer ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Button
            variant="secondary"
            icon="camera-outline"
            label={photoId ? 'Change photo' : 'Add photo'}
            onPress={() => void choose()}
          />
          {photoId ? (
            <Button
              variant="ghost"
              label="Remove photo"
              onPress={async () => {
                if (await confirm('Remove the dish photo?'))
                  await removeDishPhoto(db, claims, recipeId);
              }}
            />
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
    </View>
  );
}
