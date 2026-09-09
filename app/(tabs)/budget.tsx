import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  clearCategoryBudget,
  getBaseCurrency,
  getFirstDayOfMonth,
  getMonthlyBudget,
  listCategories,
  listCategoryBudgets,
  setCategoryBudget,
  setMonthlyBudget,
  spendByCategory,
  spentInPeriod,
} from '@/db/queries';
import type { Category } from '@/db/schema';
import { computePace, monthBounds, type BudgetPace } from '@/domain/budget';
import { formatMinor, minorToDecimalString, parseAmountToMinor } from '@/domain/money';
import { t } from '@/i18n';
import { radius, space, type, useTheme } from '@/theme';
import { Button, Card, EmptyState, Field, Screen, SectionLabel, Sheet } from '@/ui';

interface CategoryRow {
  category: Category;
  limitMinor: number | null;
  spentMinor: number;
  pace: BudgetPace | null;
}

/**
 * Budgets: one for the month overall, and one per category for the handful of
 * things that actually run away with the money.
 *
 * Every bar carries a marker showing where the calendar says you should be —
 * 78% spent is fine on day 25 and alarming on day 8, and that distinction is
 * the entire point of the screen.
 */
export default function BudgetScreen() {
  const theme = useTheme();

  const [currency, setCurrency] = useState('INR');
  const [overall, setOverall] = useState<BudgetPace | null>(null);
  const [overallDraft, setOverallDraft] = useState('');
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    const base = await getBaseCurrency();
    const firstDay = await getFirstDayOfMonth();
    const bounds = monthBounds(Date.now(), firstDay);

    const limit = await getMonthlyBudget();
    const spent = await spentInPeriod(bounds.start, bounds.end);

    const cats = await listCategories('expense');
    const budgetRows = await listCategoryBudgets();
    const spendRows = await spendByCategory(bounds.start, bounds.end);

    const limitByCategory = new Map(budgetRows.map((b) => [b.categoryId!, b.amountMinor]));
    const spentByCategory = new Map(spendRows.map((s) => [s.categoryId ?? '', s.amountMinor]));

    setCurrency(base);
    setOverall(limit != null ? computePace(spent, limit, Date.now(), bounds) : null);
    setOverallDraft(limit != null ? minorToDecimalString(limit, base) : '');

    setRows(
      cats
        .map((category) => {
          const limitMinor = limitByCategory.get(category.id) ?? null;
          const spentMinor = spentByCategory.get(category.id) ?? 0;
          return {
            category,
            limitMinor,
            spentMinor,
            pace: limitMinor != null ? computePace(spentMinor, limitMinor, Date.now(), bounds) : null,
          };
        })
        // Budgeted categories first, then anything you have actually spent on.
        .filter((r) => r.limitMinor != null || r.spentMinor > 0)
        .sort((a, b) => {
          if ((a.limitMinor != null) !== (b.limitMinor != null)) return a.limitMinor != null ? -1 : 1;
          return b.spentMinor - a.spentMinor;
        }),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const saveOverall = useCallback(async () => {
    const minor = parseAmountToMinor(overallDraft, currency);
    if (minor == null || minor <= 0) return;
    await setMonthlyBudget(minor, currency);
    await load();
  }, [overallDraft, currency, load]);

  const saveCategory = useCallback(async () => {
    if (!editing) return;
    const minor = parseAmountToMinor(draft, currency);
    if (minor == null || minor <= 0) return;
    await setCategoryBudget(editing.category.id, minor, currency);
    setEditing(null);
    await load();
  }, [editing, draft, currency, load]);

  const removeCategory = useCallback(async () => {
    if (!editing) return;
    await clearCategoryBudget(editing.category.id);
    setEditing(null);
    await load();
  }, [editing, load]);

  const paceColor = (pace: BudgetPace | null) =>
    pace?.status === 'over' ? theme.danger : pace?.status === 'warn' ? theme.warn : theme.accent;

  return (
    <Screen title={t('budget.title')}>
      {/* Overall ---------------------------------------------------------- */}
      <Card>
        <SectionLabel>{t('budget.monthly')}</SectionLabel>

        <View style={styles.inputRow}>
          <Field
            label=""
            value={overallDraft}
            onChangeText={setOverallDraft}
            keyboardType="decimal-pad"
            placeholder="0"
            style={styles.inputFlex}
          />
          <Button label={t('budget.set')} onPress={saveOverall} />
        </View>

        {overall ? (
          <>
            <PaceBar pace={overall} color={paceColor(overall)} />
            <Text style={[styles.meta, { color: theme.text }]}>
              {t('budget.spent', {
                spent: formatMinor(overall.spentMinor, currency, { compact: true }),
                limit: formatMinor(overall.limitMinor, currency, { compact: true }),
              })}
            </Text>
            <Text style={[styles.meta, { color: paceColor(overall) }]}>
              {overall.remainingMinor >= 0
                ? t('budget.remaining', {
                    amount: formatMinor(overall.remainingMinor, currency, { compact: true }),
                  })
                : t('budget.over', {
                    amount: formatMinor(Math.abs(overall.remainingMinor), currency, { compact: true }),
                  })}
            </Text>
            <Text style={[styles.pace, { color: theme.textDim }]}>
              {t('budget.pace', {
                elapsed: Math.round(overall.fractionElapsed * 100),
                spent: Math.round(overall.fractionSpent * 100),
              })}
            </Text>
          </>
        ) : (
          <Text style={[styles.meta, { color: theme.textDim }]}>{t('budget.none')}</Text>
        )}
      </Card>

      {/* Per category ----------------------------------------------------- */}
      <SectionLabel>{t('budget.byCategory')}</SectionLabel>

      {rows.length === 0 ? (
        <EmptyState text={t('budget.noCategories')} />
      ) : (
        <View style={styles.list}>
          {rows.map((row) => {
            const color = paceColor(row.pace);
            return (
              <Pressable
                key={row.category.id}
                onPress={() => {
                  setEditing(row);
                  setDraft(row.limitMinor != null ? minorToDecimalString(row.limitMinor, currency) : '');
                }}
                style={({ pressed }) => [
                  styles.catCard,
                  {
                    backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View style={styles.catHead}>
                  <Text style={styles.catIcon}>{row.category.icon ?? '•'}</Text>
                  <Text style={[styles.catName, { color: theme.text }]} numberOfLines={1}>
                    {row.category.customName ?? t(row.category.nameKey ?? '')}
                  </Text>
                  <Text style={[styles.catAmount, { color: theme.text }]}>
                    {formatMinor(row.spentMinor, currency, { compact: true })}
                  </Text>
                </View>

                {row.pace ? (
                  <>
                    <PaceBar pace={row.pace} color={color} />
                    <Text style={[styles.catMeta, { color }]}>
                      {row.pace.remainingMinor >= 0
                        ? t('budget.remaining', {
                            amount: formatMinor(row.pace.remainingMinor, currency, { compact: true }),
                          })
                        : t('budget.over', {
                            amount: formatMinor(Math.abs(row.pace.remainingMinor), currency, {
                              compact: true,
                            }),
                          })}
                      {'  ·  '}
                      {formatMinor(row.pace.limitMinor, currency, { compact: true })}
                    </Text>
                  </>
                ) : (
                  <Text style={[styles.catMeta, { color: theme.textDim }]}>
                    {t('budget.tapToSet')}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      <Sheet
        visible={editing !== null}
        title={
          editing
            ? (editing.category.customName ?? t(editing.category.nameKey ?? ''))
            : t('budget.set')
        }
        onClose={() => setEditing(null)}
      >
        <Field
          label={t('budget.monthlyLimit')}
          value={draft}
          onChangeText={setDraft}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        <View style={styles.sheetActions}>
          <Button label={t('common.done')} onPress={saveCategory} />
          {editing?.limitMinor != null ? (
            <Button label={t('budget.remove')} variant="secondary" onPress={removeCategory} />
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

/** A spend bar with a marker showing where the calendar says you should be. */
function PaceBar({ pace, color }: { pace: BudgetPace; color: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
      <View
        style={[
          styles.fill,
          {
            backgroundColor: color,
            width: `${Math.min(100, Math.max(0, pace.fractionSpent * 100))}%`,
          },
        ]}
      />
      <View
        style={[
          styles.marker,
          {
            left: `${Math.min(100, pace.fractionElapsed * 100)}%`,
            backgroundColor: theme.text,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' },
  inputFlex: { minWidth: 0 },
  meta: { fontSize: type.body },
  pace: { fontSize: type.small },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden', position: 'relative' },
  fill: { height: '100%', borderRadius: radius.pill },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 2, opacity: 0.5 },
  list: { gap: space.sm },
  catCard: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  catIcon: { fontSize: 18 },
  catName: { flex: 1, fontSize: type.body },
  catAmount: { fontSize: type.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  catMeta: { fontSize: type.small },
  sheetActions: { gap: space.sm, paddingTop: space.md },
});
