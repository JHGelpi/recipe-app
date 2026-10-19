import { usePowerSync } from '@powersync/react';
import { AISLES, typedRow, type ShoppingLine } from '@recipe-app/domain';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ShoppingLineSheet } from '../components/ShoppingLineSheet';
import { StatusLine } from '../components/StatusLine';
import { confirm } from '../components/confirm';
import { canWrite, type Claims } from '../session/claims';
import { addShoppingRows, clearList, clearTicked, setTicked } from '../shopping/repository';
import { useAisleChoices, useShoppingLines } from '../shopping/hooks';
import { colors, space } from '../theme';
import { Banner, Button, Card, IconButton, Screen, Text, TextField } from '../ui';

const FULL = 'Your list is full. Clear ticked items first.';

/** FR-31–FR-35 (shopping spec §3). */
export function ShoppingListScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const writer = canWrite(claims.role);
  const lines = useShoppingLines();
  const choices = useAisleChoices();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<ShoppingLine | null>(null);
  const toBuy = lines.filter((line) => !line.checked);
  const got = lines.filter((line) => line.checked);

  async function addTyped() {
    const row = typedRow(text, choices);
    if (!row) return;
    if ((await addShoppingRows(db, claims, [row])) === 'full') setMessage(FULL);
    else {
      setText('');
      setMessage(null);
    }
  }

  const lineView = (line: ShoppingLine) => (
    <View
      key={line.key}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 }}
    >
      {writer ? (
        <IconButton
          icon={line.checked ? 'checkmark-circle' : 'ellipse-outline'}
          label={line.checked ? `Need ${line.item}` : `Got ${line.item}`}
          onPress={() => void setTicked(db, claims, line.rowIds, !line.checked)}
        />
      ) : null}
      <Pressable
        role="button"
        style={{ flex: 1 }}
        onPress={() => setOpen(line)}
        aria-label={`${line.item}${line.amount ? `, ${line.amount}` : ''}`}
      >
        <Text
          style={
            line.checked ? { textDecorationLine: 'line-through', color: colors.muted } : undefined
          }
        >
          {line.item}
        </Text>
        {line.amount ? (
          <Text variant="small" tone="muted">
            {line.amount}
          </Text>
        ) : null}
      </Pressable>
      <IconButton
        icon="ellipsis-horizontal"
        label={`More for ${line.item}`}
        onPress={() => setOpen(line)}
      />
    </View>
  );

  return (
    <Screen>
      <Text role="heading" aria-level={1} variant="h1">
        Shopping list
      </Text>
      <StatusLine />
      {writer ? (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Add an item"
              value={text}
              onChangeText={setText}
              onSubmitEditing={() => void addTyped()}
              placeholder="2 lemons"
            />
          </View>
          <Button label="Add" onPress={() => void addTyped()} />
        </View>
      ) : null}
      {message ? (
        <Banner tone="danger" role="alert">
          {message}
        </Banner>
      ) : null}
      {lines.length === 0 ? (
        <Text tone="muted">
          Your list is empty. Add ingredients from a recipe, or type an item above.
        </Text>
      ) : null}
      {AISLES.map((aisle) => {
        const here = toBuy.filter((line) => line.aisle === aisle.id);
        return here.length === 0 ? null : (
          <Card key={aisle.id} title={aisle.label}>
            {here.map(lineView)}
          </Card>
        );
      })}
      {got.length > 0 ? (
        <Card title="Got it">
          {got.map(lineView)}
          {writer ? (
            <Button
              variant="secondary"
              label="Clear ticked"
              onPress={() => void clearTicked(db, claims)}
            />
          ) : null}
        </Card>
      ) : null}
      {writer && lines.length > 0 ? (
        <Button
          variant="ghost"
          icon="trash-outline"
          label="Clear list"
          onPress={async () => {
            if (await confirm('Clear the whole shopping list?')) await clearList(db, claims);
          }}
        />
      ) : null}
      <ShoppingLineSheet claims={claims} line={open} onClose={() => setOpen(null)} />
    </Screen>
  );
}
