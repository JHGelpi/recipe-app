import { usePowerSync } from '@powersync/react';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ZodError } from 'zod';
import { createRecipe } from '../recipes/repository';
import type { Claims } from '../session/claims';

export function AddRecipeForm({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return; // a double tap must not create two recipes
    setBusy(true);
    setMessage(null);
    try {
      await createRecipe(db, claims, title);
      setTitle('');
    } catch (error) {
      setMessage(
        error instanceof ZodError
          ? (error.issues[0]?.message ?? 'That title is not valid.')
          : 'Could not save the recipe. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        aria-label="Recipe title"
        value={title}
        onChangeText={setTitle}
        onSubmitEditing={submit}
        placeholder="Recipe title"
        style={{ borderWidth: 1, borderColor: '#888', borderRadius: 6, padding: 10, fontSize: 16 }}
      />
      {message ? (
        <Text role="alert" style={{ color: '#b00020' }}>
          {message}
        </Text>
      ) : null}
      <Pressable
        role="button"
        aria-disabled={busy}
        onPress={submit}
        style={{ backgroundColor: '#1a5d3a', borderRadius: 6, padding: 12 }}
      >
        <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>Add recipe</Text>
      </Pressable>
    </View>
  );
}
