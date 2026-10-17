import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useHouseholdTags } from '../recipes/hooks';
import { valuesFromForm, type RecipeForm, type RecipeValues } from '../recipes/form';
import type { RecipeRecord } from '../recipes/rows';
import { normalizeTags } from '@recipe-app/domain';
import { confirm } from './confirm';

const input = {
  borderWidth: 1,
  borderColor: '#888',
  borderRadius: 6,
  padding: 10,
  fontSize: 16,
} as const;
const amber = { borderColor: '#d08700', borderWidth: 2, backgroundColor: '#fff8e6' } as const;
const button = { backgroundColor: '#1a5d3a', borderRadius: 6, padding: 12, flex: 1 } as const;

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
  const householdTags = useHouseholdTags();
  const current = normalizeTags(form.tags);
  const suggestions = householdTags.filter((tag) => !current.includes(tag));
  const changed = (Object.keys(form) as (keyof RecipeForm)[]).some(
    (key) => form[key] !== initial[key],
  );

  const set = (key: keyof RecipeForm) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (busy) return; // a double tap must not save twice
    const result = valuesFromForm(form, previous, () => crypto.randomUUID());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await onSave(result.values);
    } catch {
      setErrors({ title: 'Could not save the recipe. Try again.' });
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
      <View style={{ gap: 4 }}>
        <Text>{label}</Text>
        {unsure(key) ? <Text style={{ color: '#8a5a00' }}>Check this</Text> : null}
        <TextInput
          aria-label={label}
          value={form[key]}
          onChangeText={set(key)}
          style={unsure(key) ? { ...input, ...amber } : input}
          {...extra}
        />
        {errors[key] ? (
          <Text role="alert" style={{ color: '#b00020' }}>
            {errors[key]}
          </Text>
        ) : null}
      </View>
    );
  }

  const multiline = { multiline: true, numberOfLines: 6, textAlignVertical: 'top' as const };
  const numeric = { keyboardType: 'number-pad' as const, inputMode: 'numeric' as const };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 640 }}>
      {header}
      {field('title', 'Title')}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>{field('servings', 'Servings', numeric)}</View>
        <View style={{ flex: 1 }}>{field('prep', 'Prep (min)', numeric)}</View>
        <View style={{ flex: 1 }}>{field('cook', 'Cook (min)', numeric)}</View>
      </View>
      {field('ingredients', 'Ingredients', {
        ...multiline,
        placeholder: 'One per line, e.g. 2 cups flour, sifted',
      })}
      {field('steps', 'Steps', { ...multiline, placeholder: 'One step per line' })}
      {field('tags', 'Tags', {
        placeholder: 'Comma-separated, e.g. dinner, quick',
        autoCapitalize: 'none',
      })}
      {suggestions.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {suggestions.map((tag) => (
            <Pressable
              key={tag}
              role="button"
              aria-label={`Add tag ${tag}`}
              onPress={() => set('tags')([...current, tag].join(', '))}
              style={{
                borderWidth: 1,
                borderColor: '#1a5d3a',
                borderRadius: 12,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text>{tag}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {field('notes', 'Notes', multiline)}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable role="button" aria-disabled={busy} onPress={() => void save()} style={button}>
          <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>Save</Text>
        </Pressable>
        <Pressable
          role="button"
          onPress={() => void cancel()}
          style={{ ...button, backgroundColor: '#666' }}
        >
          <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>{cancelLabel}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
