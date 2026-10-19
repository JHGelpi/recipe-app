import { usePowerSync } from '@powersync/react';
import { AISLES, typedRow, type ShoppingLine } from '@recipe-app/domain';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ShoppingLineSheet } from '../components/ShoppingLineSheet';
import { StatusLine } from '../components/StatusLine';
import { confirm } from '../components/confirm';
import { canWrite, type Claims } from '../session/claims';
import { addShoppingRows, clearList, clearTicked, setTicked } from '../shopping/repository';
import { useAisleChoices, useShoppingLines } from '../shopping/hooks';
import { openLine, typedError } from '../shopping/screen';
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
  // The sheet follows the live line, and closes once another phone removed it.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = openLine(lines, openKey);
  useEffect(() => {
    if (openKey !== null && open === null) setOpenKey(null);
  }, [openKey, open]);
  const toBuy = lines.filter((line) => !line.checked);
  const got = lines.filter((line) => line.checked);

  async function addTyped() {
    const error = typedError(text);
    if (error) {
      setMessage(error);
      return;
    }
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
      role="group"
      aria-label={`${line.item}${line.amount ? `, ${line.amount}` : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 }}
    >
      {writer ? (
        <IconButton
          icon={line.checked ? 'checkmark-circle' : 'ellipse-outline'}
          label={line.checked ? `Need ${line.item}` : `Got ${line.item}`}
          onPress={() => void setTicked(db, claims, line.rowIds, !line.checked)}
        />
      ) : null}
      {/* A tap target only: More is the line's one keyboard stop besides its tick. */}
      <Pressable focusable={false} style={{ flex: 1 }} onPress={() => setOpenKey(line.key)}>
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
        onPress={() => setOpenKey(line.key)}
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
          {writer
            ? 'Your list is empty. Add ingredients from a recipe, or type an item above.'
            : 'The list is empty.'}
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
              onPress={() => void clearTicked(db, claims, lines)}
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
      <ShoppingLineSheet claims={claims} line={open} onClose={() => setOpenKey(null)} />
    </Screen>
  );
}
