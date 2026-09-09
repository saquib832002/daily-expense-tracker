import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  countInbox,
  expensePoints,
  getBaseCurrency,
  getFirstDayOfMonth,
  getMonthlyBudget,
  incomeInPeriod,
  listCategories,
  listCategoryBudgets,
  listRecent,
  spendByCategory,
  spentInPeriod,
} from '@/db/queries';
import type { Budget, Category, Transaction } from '@/db/schema';
import { computePace, monthBounds, periodProgress, type BudgetPace } from '@/domain/budget';
import { relativeDayKey } from '@/domain/dates';
import { formatMinor } from '@/domain/money';
import {
  dailyAverage,
  dailySeries,
  foldTail,
  niceMax,
  rankSlices,
  type SeriesPoint,
} from '@/domain/report';
import { dateLocale, formatDate, t } from '@/i18n';
import { radius, space, type, useTheme } from '@/theme';
import { EmptyState, ListRow, RowGroup, SectionLabel } from '@/ui';
import {
  Columns,
  Meter,
  RankedBars,
  SummaryTile,
  type ColumnPoint,
  type RankedBarItem,
} from '@/ui/charts';

const OTHER = '__other__';
/** A category budget this close to its limit is worth interrupting someone for. */
const AT_RISK = 0.75;

interface CategoryRisk {
  categoryId: string;
  label: string;
  icon: string | null;
  spentMinor: number;
  limitMinor: number;
  fraction: number;
}

/**
 * Home is a dashboard, and a dashboard is not "everything we know".
 *
 * It answers four questions, in the order a person actually asks them:
 *   1. How did the month go?       → three squares: spent, income, budget
 *   2. Can I still spend today?    → the one number those three imply
 *   3. What is about to go wrong?  → only the budgets actually at risk
 *   4. Where is it going, and when? → the two magnitude charts
 * Recent transactions come last, because they are for correcting a mistake
 * rather than for understanding a month.
 *
 * The three squares are equal in size on purpose. They are read as a set, and
 * making one of them bigger would be claiming it matters more than the other
 * two — which is a claim about your month, not about the data.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [currency, setCurrency] = useState('INR');
  const [firstDay, setFirstDay] = useState(1);
  const [spent, setSpent] = useState(0);
  const [income, setIncome] = useState(0);
  const [pace, setPace] = useState<BudgetPace | null>(null);
  const [byCategory, setByCategory] = useState<{ categoryId: string | null; amountMinor: number }[]>(
    [],
  );
  const [categoryBudgets, setCategoryBudgets] = useState<Budget[]>([]);
  const [days, setDays] = useState<SeriesPoint[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [categoryById, setCategoryById] = useState<Record<string, Category>>({});
  const [inbox, setInbox] = useState(0);

  const load = useCallback(async () => {
    const base = await getBaseCurrency();
    const anchor = await getFirstDayOfMonth();
    const bounds = monthBounds(Date.now(), anchor);

    const spentMinor = await spentInPeriod(bounds.start, bounds.end);
    const limit = await getMonthlyBudget();

    const map: Record<string, Category> = {};
    for (const c of [...(await listCategories('expense')), ...(await listCategories('income'))]) {
      map[c.id] = c;
    }

    setCurrency(base);
    setFirstDay(anchor);
    setSpent(spentMinor);
    setIncome(await incomeInPeriod(bounds.start, bounds.end));
    setPace(limit != null ? computePace(spentMinor, limit, Date.now(), bounds) : null);
    setCategoryById(map);
    setByCategory(await spendByCategory(bounds.start, bounds.end));
    setCategoryBudgets(await listCategoryBudgets());
    setDays(dailySeries(await expensePoints(bounds.start, bounds.end), bounds.start, bounds.end));
    setRecent(await listRecent(5));
    setInbox(await countInbox());
  }, []);

  // Reload whenever the tab comes back into view, so a new expense shows up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const bounds = useMemo(() => monthBounds(Date.now(), firstDay), [firstDay]);
  const progress = useMemo(() => periodProgress(Date.now(), bounds), [bounds]);

  const monthLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(dateLocale(), { month: 'long' }).format(new Date());
    } catch {
      return '';
    }
  }, []);

  const categoryName = useCallback(
    (id: string | null): string => {
      const cat = id ? categoryById[id] : null;
      if (!cat) return t('reports.other');
      return cat.customName ?? (cat.nameKey ? t(cat.nameKey) : t('reports.other'));
    },
    [categoryById],
  );

  /* ---- where it's going: rank, fold the tail, label every row ------------- */
  const rankedItems: RankedBarItem[] = useMemo(() => {
    const ranked = rankSlices(
      byCategory.map((c) => ({ key: c.categoryId ?? OTHER, amountMinor: c.amountMinor })),
    );
    return foldTail(ranked, 5, OTHER).map((slice) => ({
      key: slice.key,
      label: slice.key === OTHER ? t('reports.other') : categoryName(slice.key),
      icon: slice.key === OTHER ? '•' : (categoryById[slice.key]?.icon ?? '•'),
      amountMinor: slice.amountMinor,
      fraction: slice.fraction,
      amountLabel: formatMinor(slice.amountMinor, currency, { compact: true }),
    }));
  }, [byCategory, categoryById, categoryName, currency]);

  /* ---- only the category budgets actually in trouble ---------------------- */
  const risks: CategoryRisk[] = useMemo(() => {
    const spentByCat = new Map(byCategory.map((c) => [c.categoryId ?? OTHER, c.amountMinor]));
    return categoryBudgets
      .flatMap((b) => {
        if (!b.categoryId || b.amountMinor <= 0) return [];
        const used = spentByCat.get(b.categoryId) ?? 0;
        const fraction = used / b.amountMinor;
        if (fraction < AT_RISK) return [];
        return [
          {
            categoryId: b.categoryId,
            label: categoryName(b.categoryId),
            icon: categoryById[b.categoryId]?.icon ?? null,
            spentMinor: used,
            limitMinor: b.amountMinor,
            fraction,
          },
        ];
      })
      .sort((a, b) => b.fraction - a.fraction)
      .slice(0, 3);
  }, [categoryBudgets, byCategory, categoryById, categoryName]);

  /* ---- day by day -------------------------------------------------------- */
  const columns: ColumnPoint[] = useMemo(() => {
    const today = new Date().setHours(0, 0, 0, 0);
    return days.map((point, i) => {
      const day = new Date(point.at).getDate();
      // Label the 1st and then every fifth day. A tick under all 30 columns is
      // unreadable on a phone and tells the reader nothing extra.
      const labelled = i === 0 || day % 5 === 0;
      return {
        key: String(point.at),
        amountMinor: point.amountMinor,
        label: labelled ? String(day) : '',
        highlight: point.at === today,
      };
    });
  }, [days]);

  const averageMinor = useMemo(
    () => dailyAverage(spent, Math.max(1, progress.daysElapsed)),
    [spent, progress.daysElapsed],
  );

  const peakMinor = useMemo(() => Math.max(...days.map((d) => d.amountMinor), 0), [days]);

  const net = income - spent;
  const hasAnything = recent.length > 0 || spent > 0 || income > 0;

  const statusColor =
    pace?.status === 'over' ? theme.danger : pace?.status === 'warn' ? theme.warn : theme.accent;

  const greeting =
    new Date().getHours() < 12
      ? t('home.morning')
      : new Date().getHours() < 17
        ? t('home.afternoon')
        : t('home.evening');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Who and when --------------------------------------------------- */}
        <View style={styles.header}>
          <View style={styles.headerMain}>
            <Text style={[styles.greeting, { color: theme.text }]}>{greeting}</Text>
            <Text style={[styles.headerSub, { color: theme.textDim }]}>
              {monthLabel}
              {'  ·  '}
              {progress.daysRemaining === 1
                ? t('home.dayLeft')
                : t('home.daysLeft', { days: progress.daysRemaining })}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/reports')}
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerLink,
              { borderColor: theme.border, backgroundColor: pressed ? theme.surfaceAlt : theme.surface },
            ]}
          >
            <Text style={[styles.headerLinkText, { color: theme.accent }]}>{t('home.reports')}</Text>
          </Pressable>
        </View>

        {/* Waiting for a tap ---------------------------------------------- */}
        {inbox > 0 ? (
          <Pressable
            onPress={() => router.push('/inbox')}
            style={({ pressed }) => [
              styles.inbox,
              {
                backgroundColor: pressed ? theme.accentSoft : theme.surface,
                borderColor: theme.accent,
              },
            ]}
          >
            <Text style={styles.inboxIcon}>📥</Text>
            <Text style={[styles.inboxText, { color: theme.text }]}>
              {t('inbox.waiting', { count: inbox })}
            </Text>
            <Text style={{ color: theme.accent, fontSize: 18 }}>›</Text>
          </Pressable>
        ) : null}

        {/* 1. The summary, in three squares ------------------------------ */}
        <View style={styles.tiles}>
          <SummaryTile
            label={t('home.tileSpent')}
            value={formatMinor(spent, currency, { compact: true })}
            hint={
              spent > 0
                ? t('home.perDay', {
                    amount: formatMinor(averageMinor, currency, { compact: true }),
                  })
                : t('home.tileNothingYet')
            }
            accent={theme.expense}
            onPress={() => router.push('/history')}
          />
          <SummaryTile
            label={t('home.tileIncome')}
            value={formatMinor(income, currency, { compact: true })}
            hint={
              income > 0 || spent > 0
                ? net >= 0
                  ? t('home.savedAmount', {
                      amount: formatMinor(net, currency, { compact: true }),
                    })
                  : t('home.overspentAmount', {
                      amount: formatMinor(-net, currency, { compact: true }),
                    })
                : t('home.tileNothingYet')
            }
            hintColor={net >= 0 ? theme.income : theme.expense}
            accent={theme.income}
            onPress={() => router.push('/history')}
          />
          <SummaryTile
            label={t('home.tileBudget')}
            value={pace ? formatMinor(pace.limitMinor, currency, { compact: true }) : '—'}
            hint={
              pace
                ? t('home.pctUsed', { pct: Math.round(pace.fractionSpent * 100) })
                : t('home.tileNotSet')
            }
            hintColor={pace ? statusColor : undefined}
            accent={theme.text}
            onPress={() => router.push('/budget')}
          />
        </View>

        {/* 2. And the one number those three imply ------------------------ */}
        <View style={[styles.pace, { backgroundColor: theme.heroBg }]}>
          {pace ? (
            <>
              <View style={styles.paceTop}>
                <Text style={[styles.paceLabel, { color: theme.heroDim }]}>
                  {t('home.remaining')}
                </Text>
                <View style={styles.pill}>
                  <View style={[styles.pillDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.pillText, { color: theme.text }]}>
                    {pace.status === 'over'
                      ? t('home.paceOver')
                      : pace.status === 'warn'
                        ? t('home.paceWarn')
                        : t('home.paceOk')}
                  </Text>
                </View>
              </View>

              <Text
                style={[
                  styles.paceValue,
                  { color: pace.status === 'over' ? theme.danger : theme.text },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatMinor(Math.max(pace.remainingMinor, 0), currency, { compact: true })}
              </Text>

              <View style={styles.paceMeter}>
                <Meter
                  fraction={pace.fractionSpent}
                  paceFraction={pace.fractionElapsed}
                  color={statusColor}
                  trackColor={theme.heroTrack}
                  height={10}
                />
              </View>

              <Text style={[styles.paceMeta, { color: theme.heroDim }]}>
                {pace.remainingMinor < 0
                  ? t('home.overBudget', {
                      amount: formatMinor(Math.abs(pace.remainingMinor), currency, {
                        compact: true,
                      }),
                    })
                  : t('home.perDay', {
                      amount: formatMinor(pace.dailyAllowanceMinor, currency, { compact: true }),
                    })}
                {'  ·  '}
                {t('home.markerIsToday')}
              </Text>
            </>
          ) : (
            <Pressable onPress={() => router.push('/budget')} hitSlop={8} style={styles.paceEmpty}>
              <View style={styles.paceEmptyMain}>
                <Text style={[styles.paceLabel, { color: theme.heroDim }]}>
                  {t('home.noBudget')}
                </Text>
                <Text style={[styles.paceEmptyText, { color: theme.text }]}>
                  {t('home.setBudget')}
                </Text>
              </View>
              <Text style={{ color: theme.accent, fontSize: 20 }}>›</Text>
            </Pressable>
          )}
        </View>

        {hasAnything ? (
          <>
            {/* 3. What is about to go wrong? ----------------------------- */}
            {risks.length > 0 ? (
              <View
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <SectionLabel>{t('home.atRisk')}</SectionLabel>
                {risks.map((risk) => {
                  const over = risk.fraction >= 1;
                  return (
                    <Pressable
                      key={risk.categoryId}
                      onPress={() => router.push('/budget')}
                      style={styles.riskRow}
                    >
                      <View style={styles.riskHead}>
                        <Text style={styles.riskIcon}>{risk.icon ?? '•'}</Text>
                        <Text style={[styles.riskLabel, { color: theme.text }]} numberOfLines={1}>
                          {risk.label}
                        </Text>
                        <Text
                          style={[styles.riskAmount, { color: over ? theme.danger : theme.warn }]}
                        >
                          {over
                            ? t('home.overBy', {
                                amount: formatMinor(risk.spentMinor - risk.limitMinor, currency, {
                                  compact: true,
                                }),
                              })
                            : t('home.leftOf', {
                                amount: formatMinor(risk.limitMinor - risk.spentMinor, currency, {
                                  compact: true,
                                }),
                              })}
                        </Text>
                      </View>
                      <Meter
                        fraction={risk.fraction}
                        color={over ? theme.danger : theme.warn}
                        trackColor={theme.surfaceAlt}
                        height={6}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* 4a. Where is it going? ------------------------------------ */}
            {rankedItems.length > 0 ? (
              <View
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <SectionLabel>{t('home.whereGoing')}</SectionLabel>
                <RankedBars items={rankedItems} />
              </View>
            ) : null}

            {/* 4b. When? ------------------------------------------------- */}
            {peakMinor > 0 ? (
              <View
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <SectionLabel>{t('home.dayByDay')}</SectionLabel>
                <Columns
                  points={columns}
                  height={110}
                  averageMinor={averageMinor}
                  maxLabel={formatMinor(niceMax(peakMinor), currency, { compact: true })}
                />
                <Text style={[styles.hint, { color: theme.textDim }]}>
                  {t('home.averageIs', {
                    amount: formatMinor(averageMinor, currency, { compact: true }),
                  })}
                </Text>
              </View>
            ) : null}

            {/* Last, and smallest: the ledger ---------------------------- */}
            <View style={styles.sectionHead}>
              <SectionLabel>{t('home.recent')}</SectionLabel>
              <Pressable onPress={() => router.push('/history')} hitSlop={8}>
                <Text style={[styles.seeAll, { color: theme.accent }]}>{t('home.seeAll')}</Text>
              </Pressable>
            </View>

            <RowGroup>
              {recent.map((tx, i) => {
                const catName = tx.categoryId ? categoryName(tx.categoryId) : null;
                const dayKey = relativeDayKey(tx.occurredAt);
                return (
                  <ListRow
                    key={tx.id}
                    icon={(tx.categoryId ? categoryById[tx.categoryId]?.icon : null) ?? '•'}
                    title={tx.merchant || catName || t('add.expense')}
                    subtitle={dayKey ? t(dayKey) : formatDate(tx.occurredAt)}
                    value={formatMinor(tx.amountMinor, tx.currency, {
                      compact: true,
                      signed: true,
                    })}
                    valueColor={tx.amountMinor >= 0 ? theme.income : theme.text}
                    onPress={() => router.push(`/txn/${tx.id}`)}
                    last={i === recent.length - 1}
                  />
                );
              })}
            </RowGroup>
          </>
        ) : (
          <EmptyState text={t('home.empty')} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },

  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerMain: { flex: 1, gap: 2 },
  greeting: { fontSize: type.title, fontWeight: '600', letterSpacing: -0.3 },
  headerSub: { fontSize: type.small },
  headerLink: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 },
  headerLinkText: { fontSize: type.small, fontWeight: '600' },

  inbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  inboxIcon: { fontSize: 20 },
  inboxText: { flex: 1, fontSize: type.small, fontWeight: '600' },

  tiles: { flexDirection: 'row', gap: space.sm },

  pace: { borderRadius: radius.lg, padding: space.lg, gap: 2 },
  paceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paceLabel: { fontSize: type.tiny, letterSpacing: 0.7, textTransform: 'uppercase' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillDot: { width: 7, height: 7, borderRadius: radius.pill },
  pillText: { fontSize: type.tiny, fontWeight: '600' },
  // Proportional figures, not tabular: equal-width digits make a big number
  // look loose.
  paceValue: { fontSize: 32, fontWeight: '700', letterSpacing: -1, marginTop: space.xs },
  paceMeter: { marginTop: space.md, marginBottom: space.xs },
  paceMeta: { fontSize: type.small },
  paceEmpty: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  paceEmptyMain: { flex: 1, gap: 2 },
  paceEmptyText: { fontSize: type.body, fontWeight: '600' },

  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md },

  hint: { fontSize: type.tiny, lineHeight: 15 },

  riskRow: { gap: space.xs },
  riskHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  riskIcon: { fontSize: 15 },
  riskLabel: { flex: 1, fontSize: type.small },
  riskAmount: { fontSize: type.small, fontWeight: '600' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAll: { fontSize: type.small, fontWeight: '600' },
});
