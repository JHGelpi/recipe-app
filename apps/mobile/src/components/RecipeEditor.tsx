import { useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useHouseholdTags } from '../recipes/hooks';
import { valuesFromForm, type RecipeForm, type RecipeValues } from '../recipes/form';
import type { RecipeRecord } from '../recipes/rows';
import { normalizeTags } from '@recipe-app/domain';
import { space } from '../theme';
import { Button, Card, Chip, Screen, Text, TextField } from '../ui';
import { confirm } from './confirm';

type Props = {
  initial: RecipeForm;
  previous: RecipeRecord | null;
  onSave: (values: RecipeValues) => Promise<void>;
  onCancel: () => void;
  /** FR-11: fields to highlight until edited. */
  flagged?: (keyof RecipeForm)[];
  cancelLabel?: string;
  /** Asked before cancelling every time; by default only when something changed. */
  cancelPrompt?: string;
  header?: ReactNode;
};

/** One form for new and existing recipes. Nothing is written until it is valid. */
export function RecipeEditor({
  initial,
  previous,
  onSave,
  onCancel,
  flagged = [],
  cancelLabel = 'Cancel',
  cancelPrompt,
  header,
}: Props) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof RecipeForm, string>>>({});
  const [busy, setBusy] = useState(false);
  // A ref, not state: two taps in one frame both see the state as not busy.
  const saving = useRef(false);
  const householdTags = useHouseholdTags();
  const current = normalizeTags(form.tags);
  const suggestions = householdTags.filter((tag) => !current.includes(tag));
  const changed = (Object.keys(form) as (keyof RecipeForm)[]).some(
    (key) => form[key] !== initial[key],
  );

  const set = (key: keyof RecipeForm) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (saving.current) return; // a double tap must not save twice
    const result = valuesFromForm(form, previous, () => crypto.randomUUID());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    saving.current = true;
    setBusy(true);
    setErrors({});
    try {
      await onSave(result.values);
    } catch {
      setErrors({ title: 'Could not save the recipe. Try again.' });
      saving.current = false;
      setBusy(false);
    }
  }

  async function cancel() {
    if (cancelPrompt !== undefined) {
      if (await confirm(cancelPrompt)) onCancel();
      return;
    }
    if (!changed || (await confirm('Discard your changes?'))) onCancel();
  }

  const unsure = (key: keyof RecipeForm) => flagged.includes(key) && form[key] === initial[key];

  function field(key: keyof RecipeForm, label: string, extra: object = {}) {
    return (
      <View style={{ gap: space.xs }}>
        {unsure(key) ? (
          <Text variant="small" tone="tag">
            Check this
          </Text>
        ) : null}
        <TextField
          label={label}
          value={form[key]}
          onChangeText={set(key)}
          warn={unsure(key)}
          error={errors[key] ?? null}
          {...extra}
        />
      </View>
    );
  }

  const multiline = {
    multiline: true,
    numberOfLines: 6,
    textAlignVertical: 'top' as const,
    style: { minHeight: 132 },
  };
  const numeric = { keyboardType: 'number-pad' as const, inputMode: 'numeric' as const };
  const decimal = { keyboardType: 'decimal-pad' as const, inputMode: 'decimal' as const };

  return (
    <Screen>
      {header}
      <Card>
        {field('title', 'Title')}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>{field('servings', 'Servings', numeric)}</View>
          <View style={{ flex: 1 }}>{field('prep', 'Prep (min)', numeric)}</View>
          <View style={{ flex: 1 }}>{field('cook', 'Cook (min)', numeric)}</View>
        </View>
      </Card>
      <Card>
        {field('ingredients', 'Ingredients', {
          ...multiline,
          placeholder: 'One per line, e.g. 2 cups flour, sifted',
        })}
        {field('steps', 'Steps', { ...multiline, placeholder: 'One step per line' })}
      </Card>
      <Card>
        {field('tags', 'Tags', {
          placeholder: 'Comma-separated, e.g. dinner, quick',
          autoCapitalize: 'none',
        })}
        {suggestions.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {suggestions.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                aria-label={`Add tag ${tag}`}
                onPress={() => set('tags')([...current, tag].join(', '))}
              />
            ))}
          </View>
        ) : null}
        {field('notes', 'Notes', multiline)}
      </Card>
      {/* FR-43: optional; blank fields store nothing. */}
      <Card title="Nutrition (per serving)">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <View style={{ flexGrow: 1, flexBasis: 120 }}>
            {field('calories', 'Calories (kcal)', decimal)}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 120 }}>
            {field('protein_g', 'Protein (g)', decimal)}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 120 }}>
            {field('carbs_g', 'Carbohydrates (g)', decimal)}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 120 }}>{field('fat_g', 'Fat (g)', decimal)}</View>
        </View>
      </Card>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button full label="Save" aria-disabled={busy} onPress={() => void save()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button full variant="secondary" label={cancelLabel} onPress={() => void cancel()} />
        </View>
      </View>
    </Screen>
  );
}
