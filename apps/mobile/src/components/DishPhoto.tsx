import { usePowerSync } from '@powersync/react';
import { DISH_EDGE } from '@recipe-app/domain';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { pickPhotos } from '../photos/pick';
import { preparePhoto, PhotoReadError } from '../photos/prepare';
import { photoSaver } from '../photos/queue';
import { removeDishPhoto, setDishPhoto } from '../photos/repository';
import { canWrite, type Claims } from '../session/claims';
import { confirm } from './confirm';
import { PhotoImage } from './PhotoImage';

const link = { textDecorationLine: 'underline' } as const;

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
    <View style={{ gap: 6 }}>
      {photoId ? (
        <PhotoImage
          id={photoId}
          label="Dish photo"
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 6 }}
        />
      ) : null}
      {writer ? (
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <Pressable role="button" onPress={() => void choose()}>
            <Text style={link}>{photoId ? 'Change photo' : 'Add photo'}</Text>
          </Pressable>
          {photoId ? (
            <Pressable
              role="button"
              onPress={async () => {
                if (await confirm('Remove the dish photo?'))
                  await removeDishPhoto(db, claims, recipeId);
              }}
            >
              <Text style={{ ...link, color: '#b00020' }}>Remove photo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text role="alert" style={{ color: '#b00020' }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
