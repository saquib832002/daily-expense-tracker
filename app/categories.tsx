import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { createCategory, hideCategory, listCategories, updateCategory } from '@/db/queries';
import type { Category } from '@/db/schema';
import { t } from '@/i18n';
import { space } from '@/theme';
import { Button, Chip, EmptyState, Field, ListRow, RowGroup, Screen, SectionLabel, Sheet } from '@/ui';

/** A small, deliberately boring palette. Enough to tell categories apart. */
const COLORS = [
  '#E8734A', '#4CA96B', '#4A82E8', '#B4801F', '#7A5AC8',
  '#D452A0', '#3FA9B5', '#D9544D', '#6B7079', '#8E5AD6',
];

const ICONS = [
  '🏷️', '🍽️', '🛒', '🚌', '⛽', '🏠', '💡', '📱', '🩺', '📚',
  '🛍️', '🎬', '🏦', '🛡️', '🎁', '✈️', '🧴', '🧹', '📦', '💼',
];

/**
 * Categories.
 *
 * Seeded categories carry a translation key so they render in the user's
 * language; ones the user creates carry a plain name. Hiding a category never
 * touches the transactions filed under it — history must not develop holes.
 */
export default function CategoriesScreen() {
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [list, setList] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏷️');
  const [color, setColor] = useState(COLORS[0]!);

  const load = useCallback(async () => {
    setList(await listCategories(kind));
  }, [kind]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openNew = useCallback(() => {
    setName('');
    setIcon('🏷️');
    setColor(COLORS[0]!);
    setEditing('new');
  }, []);

  const openEdit = useCallback((c: Category) => {
    setName(c.customName ?? t(c.nameKey ?? ''));
    setIcon(c.icon ?? '🏷️');
    setColor(c.color ?? COLORS[0]!);
    setEditing(c);
  }, []);

  const save = useCallback(async () => {
    if (!name.trim()) return;
    if (editing === 'new') {
      await createCategory({ name, kind, icon, color });
    } else if (editing) {
      await updateCategory(editing.id, { customName: name.trim(), icon, color });
    }
    setEditing(null);
    await load();
  }, [editing, name, kind, icon, color, load]);

  const hide = useCallback(
    (c: Category) => {
      Alert.alert(t('categories.hideTitle'), t('categories.hideBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('categories.hide'),
          style: 'destructive',
          onPress: async () => {
            await hideCategory(c.id);
            setEditing(null);
            await load();
          },
        },
      ]);
    },
    [load],
  );

  return (
    <Screen
      title={t('more.categories')}
      back
      right={<Chip label={t('categories.add')} onPress={openNew} active />}
    >
      <View style={styles.chips}>
        {(['expense', 'income'] as const).map((k) => (
          <Chip
            key={k}
            label={t(k === 'expense' ? 'add.expense' : 'add.income')}
            active={kind === k}
            onPress={() => setKind(k)}
          />
        ))}
      </View>

      {list.length === 0 ? (
        <EmptyState text={t('categories.empty')} />
      ) : (
        <RowGroup>
          {list.map((c, i) => (
            <ListRow
              key={c.id}
              icon={c.icon ?? '🏷️'}
              title={c.customName ?? t(c.nameKey ?? '')}
              subtitle={c.isSystem ? t('categories.builtIn') : t('categories.custom')}
              onPress={() => openEdit(c)}
              chevron
              last={i === list.length - 1}
            />
          ))}
        </RowGroup>
      )}

      <Sheet
        visible={editing !== null}
        title={editing === 'new' ? t('categories.add') : t('categories.edit')}
        onClose={() => setEditing(null)}
      >
        <Field label={t('categories.name')} value={name} onChangeText={setName} autoCapitalize="words" />

        <SectionLabel>{t('categories.icon')}</SectionLabel>
        <View style={styles.chips}>
          {ICONS.map((g) => (
            <Chip key={g} label={g} active={icon === g} onPress={() => setIcon(g)} />
          ))}
        </View>

        <SectionLabel>{t('categories.color')}</SectionLabel>
        <View style={styles.chips}>
          {COLORS.map((c) => (
            <Chip key={c} label="  " active={color === c} onPress={() => setColor(c)} />
          ))}
        </View>

        <View style={styles.actions}>
          <Button label={t('common.done')} onPress={save} disabled={!name.trim()} />
          {editing !== 'new' && editing ? (
            <Button label={t('categories.hide')} variant="secondary" onPress={() => hide(editing)} />
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actions: { gap: space.sm, paddingTop: space.md },
});
