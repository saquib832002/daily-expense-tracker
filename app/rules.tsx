import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import {
  createRule,
  deleteRule,
  listCategories,
  listRules,
  updateRule,
} from '@/db/queries';
import type { Category, Rule } from '@/db/schema';
import { isValidPattern, type MatchType } from '@/domain/rules';
import { t } from '@/i18n';
import { space, type, useTheme } from '@/theme';
import { Button, Chip, EmptyState, Field, ListRow, RowGroup, Screen, SectionLabel, Sheet } from '@/ui';

const MATCH_TYPES: MatchType[] = ['contains', 'equals', 'startsWith', 'regex'];

/**
 * Rules: "anything from SWIGGY is Food".
 *
 * Together with what the app learns from your corrections, this is the whole
 * of its categorisation. No API, no cost, works offline, and you can read
 * exactly why any transaction ended up where it did.
 */
export default function RulesScreen() {
  const theme = useTheme();
  const [list, setList] = useState<Rule[]>([]);
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);

  const [matchType, setMatchType] = useState<string>('contains');
  const [matchValue, setMatchValue] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setList(await listRules());
    setCategoryList(await listCategories('expense'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openNew = useCallback(() => {
    setMatchType('contains');
    setMatchValue('');
    setCategoryId(null);
    setEditing('new');
  }, []);

  const openEdit = useCallback((r: Rule) => {
    setMatchType(r.matchType);
    setMatchValue(r.matchValue);
    setCategoryId(r.setCategoryId);
    setEditing(r);
  }, []);

  const valid = isValidPattern(matchType, matchValue) && categoryId !== null;

  const save = useCallback(async () => {
    if (!valid) return;
    if (editing === 'new') {
      await createRule({ matchType, matchValue, setCategoryId: categoryId });
    } else if (editing) {
      await updateRule(editing.id, { matchType, matchValue: matchValue.trim(), setCategoryId: categoryId });
    }
    setEditing(null);
    await load();
  }, [valid, editing, matchType, matchValue, categoryId, load]);

  const remove = useCallback(async () => {
    if (!editing || editing === 'new') return;
    await deleteRule(editing.id);
    setEditing(null);
    await load();
  }, [editing, load]);

  const nameOf = (id: string | null) => {
    const c = categoryList.find((x) => x.id === id);
    return c ? (c.customName ?? t(c.nameKey ?? '')) : '—';
  };

  return (
    <Screen
      title={t('more.rules')}
      back
      right={<Chip label={t('rules.add')} onPress={openNew} active />}
    >
      <Text style={[styles.lead, { color: theme.textDim }]}>{t('rules.lead')}</Text>

      {list.length === 0 ? (
        <EmptyState text={t('rules.empty')} />
      ) : (
        <RowGroup>
          {list.map((r, i) => (
            <ListRow
              key={r.id}
              icon={r.isEnabled ? '⚡' : '💤'}
              title={t(`rules.match.${r.matchType}`, { value: r.matchValue })}
              subtitle={`→ ${nameOf(r.setCategoryId)}`}
              onPress={() => openEdit(r)}
              chevron
              last={i === list.length - 1}
            />
          ))}
        </RowGroup>
      )}

      <Sheet
        visible={editing !== null}
        title={editing === 'new' ? t('rules.add') : t('rules.edit')}
        onClose={() => setEditing(null)}
      >
        <SectionLabel>{t('rules.when')}</SectionLabel>
        <View style={styles.chips}>
          {MATCH_TYPES.map((m) => (
            <Chip
              key={m}
              label={t(`rules.type.${m}`)}
              active={matchType === m}
              onPress={() => setMatchType(m)}
            />
          ))}
        </View>

        <Field
          label={t('rules.value')}
          value={matchValue}
          onChangeText={setMatchValue}
          placeholder={t('rules.valueHint')}
          autoCapitalize="none"
        />
        {matchType === 'regex' && matchValue.trim() && !isValidPattern('regex', matchValue) ? (
          <Text style={{ color: theme.danger, fontSize: type.small }}>{t('rules.badRegex')}</Text>
        ) : null}

        <SectionLabel>{t('rules.then')}</SectionLabel>
        <View style={styles.chips}>
          {categoryList.map((c) => (
            <Chip
              key={c.id}
              label={`${c.icon ?? ''} ${c.customName ?? t(c.nameKey ?? '')}`.trim()}
              active={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </View>

        {editing !== 'new' && editing ? (
          <View style={styles.switchRow}>
            <Text style={{ color: theme.text, fontSize: type.body }}>{t('rules.enabled')}</Text>
            <Switch
              value={editing.isEnabled === 1}
              onValueChange={async (on) => {
                await updateRule(editing.id, { isEnabled: on ? 1 : 0 });
                await load();
                setEditing({ ...editing, isEnabled: on ? 1 : 0 });
              }}
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button label={t('common.done')} onPress={save} disabled={!valid} />
          {editing !== 'new' && editing ? (
            <Button label={t('common.delete')} variant="secondary" onPress={remove} />
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: type.small, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  actions: { gap: space.sm, paddingTop: space.md },
});
