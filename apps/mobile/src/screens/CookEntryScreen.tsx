import { usePowerSync } from '@powersync/react';
import {
  COOK_LOG_LIMITS,
  DISH_EDGE,
  formatCookedOn,
  localDay,
  parseCookedOn,
} from '@recipe-app/domain';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { confirm } from '../components/confirm';
import { PhotoImage } from '../components/PhotoImage';
import { useCookName, useEntry, useEntryPhotos, type Entry } from '../cooklog/hooks';
import {
  addEntryPhotos,
  removeEntryPhoto,
  restoreEntry,
  setCookedOn,
  setEntryNotes,
  trashEntry,
} from '../cooklog/repository';
import { pickPhotos } from '../photos/pick';
import { preparePhoto, PhotoReadError } from '../photos/prepare';
import { photoSaver } from '../photos/queue';
import { canWrite, type Claims } from '../session/claims';
import { radius, space } from '../theme';
import { Banner, Button, Card, Chip, Screen, Text, TextField } from '../ui';

/** FR-37–FR-39: one meal: its day, notes and photos. */
export function CookEntryScreen({ claims, id }: { claims: Claims; id: string }) {
  const entry = useEntry(id);
  if (entry === undefined) return null;
  return (
    <Screen back={{ href: '/diary', label: 'Cook diary' }}>
      {entry === null ? (
        <Banner tone="danger" role="alert">
          This diary entry could not be read.
        </Banner>
      ) : (
        <EntryBody claims={claims} entry={entry} />
      )}
    </Screen>
  );
}

function EntryBody({ claims, entry }: { claims: Claims; entry: Entry }) {
  const db = usePowerSync();
  const writer = canWrite(claims.role) && !entry.deleted_at;
  const cookName = useCookName(claims.userId);
  const today = localDay(new Date());

  return (
    <>
      <Text role="heading" aria-level={1} variant="h1">
        {entry.title}
      </Text>
      <Text tone="muted">{`${formatCookedOn(entry.cooked_on, today)} · cooked by ${cookName(entry.cooked_by)}`}</Text>
      {entry.recipe_live && entry.recipe_id ? (
        <Link href={`/recipe/${entry.recipe_id}`} asChild>
          <Pressable role="link" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text tone="accent" style={{ textDecorationLine: 'underline' }}>
              Open the recipe
            </Text>
          </Pressable>
        </Link>
      ) : null}
      {entry.deleted_at ? (
        <Banner
          tone="tag"
          role="alert"
          action={
            canWrite(claims.role) ? (
              <Button
                variant="ghost"
                label="Restore"
                onPress={() => void restoreEntry(db, claims, entry.id)}
              />
            ) : null
          }
        >
          This entry is in the Trash
        </Banner>
      ) : null}
      {writer ? <DayCard claims={claims} entry={entry} today={today} /> : null}
      <NotesCard claims={claims} entry={entry} writer={writer} />
      <PhotosCard claims={claims} entry={entry} writer={writer} />
      {writer ? (
        <Button
          variant="danger"
          icon="trash-outline"
          label="Move to Trash"
          onPress={async () => {
            if (await confirm('Move this diary entry to the Trash?')) {
              await trashEntry(db, claims, entry.id);
              router.replace('/diary');
            }
          }}
        />
      ) : null}
    </>
  );
}

/** FR-37: log yesterday's dinner after the fact. */
function DayCard({ claims, entry, today }: { claims: Claims; entry: Entry; today: string }) {
  const db = usePowerSync();
  const [text, setText] = useState(entry.cooked_on);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(entry.cooked_on), [entry.cooked_on]);
  const yesterday = localDay(new Date(Date.now() - 86_400_000));
  const save = async (input: string) => {
    const parsed = parseCookedOn(input, today);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    setText(parsed.day);
    if (parsed.day !== entry.cooked_on) await setCookedOn(db, claims, entry.id, parsed.day);
  };
  return (
    <Card title="Date">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Chip
          label="Today"
          tone={entry.cooked_on === today ? 'selected' : 'neutral'}
          aria-pressed={entry.cooked_on === today}
          onPress={() => void save(today)}
        />
        <Chip
          label="Yesterday"
          tone={entry.cooked_on === yesterday ? 'selected' : 'neutral'}
          aria-pressed={entry.cooked_on === yesterday}
          onPress={() => void save(yesterday)}
        />
      </View>
      <TextField
        label="Cooked on (YYYY-MM-DD)"
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => void save(text)}
        error={error}
        trailing={
          text !== entry.cooked_on ? (
            <Button variant="ghost" label="Save date" onPress={() => void save(text)} />
          ) : null
        }
      />
    </Card>
  );
}

/** FR-38: what to remember about tonight. */
function NotesCard({ claims, entry, writer }: { claims: Claims; entry: Entry; writer: boolean }) {
  const db = usePowerSync();
  const stored = entry.notes ?? '';
  const [text, setText] = useState(stored);
  const [saved, setSaved] = useState(false);
  useEffect(() => setText(stored), [stored]);
  if (!writer) {
    return stored ? (
      <Card title="Notes">
        <Text>{stored}</Text>
      </Card>
    ) : null;
  }
  const tooLong = text.length > COOK_LOG_LIMITS.notes;
  return (
    <Card title="Notes">
      <TextField
        label="Notes"
        hideLabel
        multiline
        value={text}
        onChangeText={(value) => {
          setText(value);
          setSaved(false);
        }}
        placeholder="Used thighs instead of breasts, kids loved it"
        error={tooLong ? `Notes must be ${COOK_LOG_LIMITS.notes} characters or fewer` : null}
        style={{ minHeight: 96 }}
      />
      {text !== stored ? (
        <Button
          label="Save notes"
          disabled={tooLong}
          onPress={async () => {
            await setEntryNotes(db, claims, entry.id, text);
            setSaved(true);
          }}
        />
      ) : saved ? (
        <Text tone="muted">Saved</Text>
      ) : null}
    </Card>
  );
}

/** FR-39: several photos of the meal, full screen and swipeable when tapped. */
function PhotosCard({ claims, entry, writer }: { claims: Claims; entry: Entry; writer: boolean }) {
  const db = usePowerSync();
  const photos = useEntryPhotos(entry.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!writer && photos.length === 0) return null;
  const room = COOK_LOG_LIMITS.photos - photos.length;

  async function add() {
    const files = await pickPhotos(true);
    if (files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const prepared = [];
      for (const file of files.slice(0, room)) prepared.push(await preparePhoto(file, DISH_EDGE));
      await addEntryPhotos(db, photoSaver(db), claims, entry.id, prepared);
      if (files.length > room) {
        setError(`An entry holds up to ${COOK_LOG_LIMITS.photos} photos; the rest were left out.`);
      }
    } catch (caught) {
      setError(
        caught instanceof PhotoReadError ? caught.message : 'Could not save the photo. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Photos">
      {photos.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {photos.map((photoId, index) => (
            <View key={photoId} style={{ gap: space.xs }}>
              <Link href={`/diary/${entry.id}/photos?at=${index}`} asChild>
                <Pressable role="link" aria-label={`Photo ${index + 1} of ${photos.length}`}>
                  <PhotoImage
                    id={photoId}
                    label={`Photo ${index + 1}`}
                    style={{ width: 96, height: 96, borderRadius: radius.field }}
                  />
                </Pressable>
              </Link>
              {writer ? (
                <Button
                  variant="ghost"
                  label="Remove"
                  aria-label={`Remove photo ${index + 1}`}
                  onPress={async () => {
                    if (await confirm('Remove this photo?')) {
                      await removeEntryPhoto(db, claims, photoId);
                    }
                  }}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {writer && room > 0 ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Button
            variant="secondary"
            icon="camera-outline"
            label={busy ? 'Saving…' : 'Add photos'}
            disabled={busy}
            onPress={() => void add()}
          />
        </View>
      ) : null}
      {error ? (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
      {writer ? (
        <Text variant="small" tone="muted">
          Photos are kept on this phone until they upload.
        </Text>
      ) : null}
    </Card>
  );
}
