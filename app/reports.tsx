import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  expensePoints,
  getBaseCurrency,
  getFirstDayOfMonth,
  incomeInPeriod,
  listCategories,
  spendByCategory,
  spentInPeriod,
} from '@/db/queries';
import type { Category } from '@/db/schema';
import { monthBounds, periodProgress } from '@/domain/budget';
import { addMonths, startOfDay } from '@/domain/dates';
import { formatMinor } from '@/domain/money';
import {
  changeFraction,
  dailyAverage,
  dailySeries,
  foldTail,
  monthlySeries,
  niceMax,
  rankSlices,
  type SeriesPoint,
} from '@/domain/report';
import { dateLocale, t } from '@/i18n';
import { space, type, useTheme } from '@/theme';
import { Card, EmptyState, Screen, SectionLabel } from '@/ui';
import { Columns, RankedBars, Stat, type ColumnPoint, type RankedBarItem } from '@/ui/charts';

const OTHER = '__other__';

/**
 * Where the money went.
 *
 * Three questions, in the order people ask them: how much, on what, and when.
 * Both charts are single-series and drawn from a common baseline, because both
 * are magnitude questions.
 */
export default function ReportsScreen() {
  const theme = useTheme();

  const [cursor, setCursor] = useState(() => Date.now());
  const [currency, setCurrency] = useState('INR');
  const [firstDay, setFirstDay] = useState(1);
  const [spent, setSpent] = useState(0);
  const [income, setIncome] = useState(0);
  const [prevSpent, setPrevSpent] = useState(0);
  const [categoryById, setCategoryById] = useState<Record<string, Category>>({});
  const [byCategory, setByCategory] = useState<{ categoryId: string | null; amountMinor: number }[]>([]);
  const [days, setDays] = useState<SeriesPoint[]>([]);
  const [months, setMonths] = useState<SeriesPoint[]>([]);

  const load = useCallback(async () => {
    const base = await getBaseCurrency();
    const anchor = await getFirstDayOfMonth();
    const bounds = monthBounds(cursor, anchor);
    const prev = monthBounds(addMonths(cursor, -1), anchor);

    const cats = [...(await listCategories('expense')), ...(await listCategories('income'))];
    const map: Record<string, Category> = {};
    for (const c of cats) map[c.id] = c;

    // Twelve months back covers the month-on-month chart in one query.
    const yearStart = monthBounds(addMonths(cursor, -11), anchor).start;
    const yearPoints = await expensePoints(yearStart, bounds.end);

    setCurrency(base);
    setFirstDay(anchor);
    setSpent(await spentInPeriod(bounds.start, bounds.end));
    setPrevSpent(await spentInPeriod(prev.start, prev.end));
    setIncome(await incomeInPeriod(bounds.start, bounds.end));
    setCategoryById(map);
    setByCategory(await spendByCategory(bounds.start, bounds.end));
    setDays(dailySeries(yearPoints, bounds.start, bounds.end));
    setMonths(monthlySeries(yearPoints, cursor, 6, anchor));
  }, [cursor]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const bounds = useMemo(() => monthBounds(cursor, firstDay), [cursor, firstDay]);
  const progress = useMemo(
    () => periodProgress(Math.min(Date.now(), bounds.end), bounds),
    [bounds],
  );

  const monthLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(dateLocale(), { month: 'long', year: 'numeric' }).format(
        new Date(cursor),
      );
    } catch {
      return new Date(cursor).toDateString();
    }
  }, [cursor]);

  const atCurrentMonth = startOfDay(addMonths(cursor, 1)) > Date.now();

  /* ------- by category: rank, fold the tail, label every row --------------- */
  const rankedItems: RankedBarItem[] = useMemo(() => {
    const ranked = rankSlices(
      byCategory.map((c) => ({ key: c.categoryId ?? OTHER, amountMinor: c.amountMinor })),
    );
    return foldTail(ranked, 7, OTHER).map((slice) => {
      const cat = slice.key === OTHER ? null : categoryById[slice.key];
      return {
        key: slice.key,
        label: cat
          ? (cat.customName ?? t(cat.nameKey ?? ''))
          : t('reports.other'),
        icon: cat?.icon ?? '▫️',
        amountMinor: slice.amountMinor,
        fraction: slice.fraction,
        amountLabel: formatMinor(slice.amountMinor, currency, { compact: true }),
        tint: cat?.color ?? theme.textDim,
      };
    });
  }, [byCategory, categoryById, currency, theme.textDim]);

  /* ------- day by day ------------------------------------------------------ */
  const dayPoints: ColumnPoint[] = useMemo(
    () =>
      days.map((p, i) => {
        const d = new Date(p.at).getDate();
        return {
          key: String(p.at),
          amountMinor: p.amountMinor,
          // Label every fifth column, so the axis stays readable on a phone.
          label: i === 0 || d % 5 === 0 ? String(d) : '',
          highlight: startOfDay(Date.now()) === p.at,
        };
      }),
    [days],
  );

  const avgPerDay = dailyAverage(spent, Math.max(1, progress.daysElapsed));

  /* ------- month on month -------------------------------------------------- */
  const monthPoints: ColumnPoint[] = useMemo(() => {
    const fmt = (ms: number) => {
      try {
        return new Intl.DateTimeFormat(dateLocale(), { month: 'narrow' }).format(new Date(ms));
      } catch {
        return String(new Date(ms).getMonth() + 1);
      }
    };
    return months.map((p, i) => ({
      key: String(p.at),
      amountMinor: p.amountMinor,
      label: fmt(p.at),
      highlight: i === months.length - 1,
    }));
  }, [months]);

  const change = changeFraction(spent, prevSpent);

  return (
    <Screen title={t('reports.title')} back>
      {/* Month stepper ---------------------------------------------------- */}
      <View style={styles.monthRow}>
        <Text style={[styles.navArrow, { color: theme.accent }]} onPress={() => setCursor(addMonths(cursor, -1))}>
          ‹
        </Text>
        <Text style={[styles.month, { color: theme.text }]}>{monthLabel}</Text>
        <Text
          style={[styles.navArrow, { color: atCurrentMonth ? theme.border : theme.accent }]}
          onPress={() => !atCurrentMonth && setCursor(addMonths(cursor, 1))}
        >
          ›
        </Text>
      </View>

      {/* How much --------------------------------------------------------- */}
      <View style={styles.statRow}>
        <Stat
          label={t('reports.spent')}
          value={formatMinor(spent, currency, { compact: true })}
          hint={
            change == null
              ? t('reports.noComparison')
              : change >= 0
                ? t('reports.upOnLast', { pct: Math.round(Math.abs(change) * 100) })
                : t('reports.downOnLast', { pct: Math.round(Math.abs(change) * 100) })
          }
          tone={change == null ? 'neutral' : change > 0.1 ? 'warn' : 'good'}
        />
        <Stat
          label={t('reports.perDay')}
          value={formatMinor(avgPerDay, currency, { compact: true })}
          hint={t('reports.overDays', { days: Math.max(1, progress.daysElapsed) })}
        />
      </View>

      <View style={styles.statRow}>
        <Stat label={t('reports.income')} value={formatMinor(income, currency, { compact: true })} />
        <Stat
          label={t('reports.net')}
          value={formatMinor(income - spent, currency, { compact: true, signed: true })}
          tone={income - spent >= 0 ? 'good' : 'bad'}
        />
      </View>

      {/* On what ---------------------------------------------------------- */}
      <SectionLabel>{t('reports.byCategory')}</SectionLabel>
      {rankedItems.length === 0 ? (
        <EmptyState text={t('reports.empty')} />
      ) : (
        <Card>
          <RankedBars items={rankedItems} />
        </Card>
      )}

      {/* When ------------------------------------------------------------- */}
      <SectionLabel>{t('reports.dayByDay')}</SectionLabel>
      <Card>
        <Columns
          points={dayPoints}
          maxLabel={formatMinor(niceMax(Math.max(...days.map((d) => d.amountMinor), 0)), currency, {
            compact: true,
          })}
          averageMinor={avgPerDay}
        />
        <Text style={[styles.caption, { color: theme.textDim }]}>
          {t('reports.dashedIsAverage')}
        </Text>
      </Card>

      <SectionLabel>{t('reports.monthOnMonth')}</SectionLabel>
      <Card>
        <Columns
          points={monthPoints}
          maxLabel={formatMinor(niceMax(Math.max(...months.map((m) => m.amountMinor), 0)), currency, {
            compact: true,
          })}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navArrow: { fontSize: 26, paddingHorizontal: space.md },
  month: { fontSize: type.body, fontWeight: '600' },
  statRow: { flexDirection: 'row', gap: space.sm },
  caption: { fontSize: type.tiny, paddingTop: space.xs },
});
