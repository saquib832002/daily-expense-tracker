/**
 * The annual statement.
 *
 * One screen, one job: pick a year, get a document. Everything hard about it —
 * where the year begins, which rows count, whether the totals reconcile — is
 * settled in `domain/fiscalYear` and `domain/statement` and tested there. What
 * is left here is choosing and waiting.
 *
 * The year-start setting lives on this screen rather than buried in More,
 * because this is the screen where getting it wrong is visible: a summary
 * running January to December is no use to somebody filing an Indian return,
 * and the moment they notice is the moment the fix should be in reach.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getBaseCurrency, getYearStartMonth, setYearStartMonth } from '@/db/queries';
import {
  fiscalYearLabel,
  fiscalYearOf,
  isCurrentFiscalYear,
  monthsElapsed,
  type FiscalYear,
  type YearStartMonth,
} from '@/domain/fiscalYear';
import { formatMinor } from '@/domain/money';
import { highlightsOf, type Statement } from '@/domain/statement';
import { t, useLanguage } from '@/i18n';
import {
  availableYears,
  exportStatement,
  statementFor,
  type StatementFormat,
} from '@/services/statement';
import { radius, space, type, useTheme } from '@/theme';
import { Button, Card, Screen, SectionLabel } from '@/ui';
import { Toast } from '@/ui/Toast';

/** The four starts worth offering as one tap. Anything else is the full list. */
const COMMON_STARTS: YearStartMonth[] = [1, 4, 7, 10];
const ALL_STARTS: YearStartMonth[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function monthName(month: YearStartMonth): string {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'long' }).format(
      new Date(2000, month - 1, 1),
    );
  } catch {
    return String(month);
  }
}

export default function StatementScreen() {
  const theme = useTheme();
  useLanguage();

  const [startMonth, setStartMonth] = useState<YearStartMonth | null>(null);
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [selected, setSelected] = useState<FiscalYear | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [currency, setCurrency] = useState('INR');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<StatementFormat | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [allMonths, setAllMonths] = useState(false);

  const say = useCallback((message: string) => setToast(message), []);

  /** Re-read everything. Called on mount and whenever the year start changes. */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [month, base] = await Promise.all([getYearStartMonth(), getBaseCurrency()]);
      setStartMonth(month);
      setCurrency(base);
      const list = await availableYears();
      setYears(list);
      // Default to the most recent *finished* year if there is one — in April
      // nobody wants a statement covering three weeks. Otherwise the current.
      const finished = list.find((y) => !isCurrentFiscalYear(y, Date.now()));
      setSelected(finished ?? list[0] ?? fiscalYearOf(Date.now(), month));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void (async () => {
      const built = await statementFor(selected);
      if (!cancelled) setStatement(built);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const changeStart = useCallback(
    async (month: YearStartMonth) => {
      await setYearStartMonth(month);
      await reload();
    },
    [reload],
  );

  const send = useCallback(
    async (format: StatementFormat) => {
      if (!selected) return;
      setBusy(format);
      try {
        const result = await exportStatement(selected, format);
        if (!result.ok) {
          say(
            result.error === 'sharingUnavailable'
              ? t('statement.noSharing')
              : t('statement.failed'),
          );
        }
      } finally {
        setBusy(null);
      }
    },
    [selected, say],
  );

  const highlights = useMemo(
    () =>
      statement && selected
        ? highlightsOf(statement, monthsElapsed(selected, Date.now()))
        : null,
    [statement, selected],
  );

  const money = useCallback((minor: number) => formatMinor(minor, currency), [currency]);

  const monthLabel = useCallback((ms: number) => {
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(ms));
    } catch {
      return String(new Date(ms).getMonth() + 1);
    }
  }, []);

  if (loading || startMonth === null) {
    return (
      <Screen title={t('statement.title')}>
        <ActivityIndicator color={theme.accent} />
      </Screen>
    );
  }

  const provisional = selected ? isCurrentFiscalYear(selected, Date.now()) : false;
  const empty = statement !== null && statement.rowsCounted === 0;
  const starts = allMonths ? ALL_STARTS : COMMON_STARTS;

  return (
    <Screen title={t('statement.title')}>
      <Toast
        visible={toast !== null}
        tone="warn"
        title={toast ?? ''}
        onHide={() => setToast(null)}
      />

      {/* -------------------------------------------------------- the year */}
      <Card gap={space.sm}>
        <SectionLabel>{t('statement.pickYear')}</SectionLabel>
        <View style={styles.wrap}>
          {years.map((year) => {
            const active = selected?.start === year.start;
            return (
              <Pressable
                key={year.start}
                onPress={() => setSelected(year)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.pill,
                  {
                    borderColor: active ? theme.accent : theme.borderStrong,
                    backgroundColor: active
                      ? theme.accentSoft
                      : pressed
                        ? theme.surfaceAlt
                        : 'transparent',
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? theme.accent : theme.text,
                    fontWeight: active ? '700' : '500',
                    fontSize: type.body,
                  }}
                >
                  {fiscalYearLabel(year)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {provisional ? (
          <Text style={[styles.hint, { color: theme.warn }]}>{t('statement.provisional')}</Text>
        ) : null}
      </Card>

      {/* ------------------------------------------------------ the summary */}
      <Card gap={space.sm}>
        <SectionLabel>{t('statement.summary')}</SectionLabel>
        {statement === null ? (
          <ActivityIndicator color={theme.accent} />
        ) : empty ? (
          <Text style={[styles.hint, { color: theme.textDim }]}>{t('statement.empty')}</Text>
        ) : (
          <>
            <Figure label={t('statement.totalSpent')} value={money(highlights!.totalSpentMinor)} />
            <Figure
              label={t('statement.totalEarned')}
              value={money(highlights!.totalEarnedMinor)}
            />
            <Figure
              label={t('statement.net')}
              value={money(highlights!.netMinor)}
              tone={highlights!.netMinor < 0 ? 'bad' : 'good'}
            />
            <Figure
              label={t('statement.monthlyAverage')}
              value={money(highlights!.averageMonthlySpendMinor)}
            />
            {highlights!.biggestCategory ? (
              <Figure
                label={t('statement.biggest')}
                value={`${highlights!.biggestCategory.label} · ${money(
                  highlights!.biggestCategory.totalMinor,
                )}`}
              />
            ) : null}
            {highlights!.busiestMonth !== null ? (
              <Figure
                label={t('statement.busiest')}
                value={`${monthLabel(statement.months[highlights!.busiestMonth]!)} · ${money(
                  highlights!.busiestMonthAmountMinor,
                )}`}
              />
            ) : null}
          </>
        )}
      </Card>

      {/* ---------------------------------------------------- the breakdown */}
      {statement && !empty ? (
        <Card gap={space.xs}>
          <SectionLabel>{t('statement.byCategory')}</SectionLabel>
          {/* Horizontally scrollable on purpose: thirteen columns will never
              fit a phone, and shrinking the type until they do produces a
              table nobody can read. The PDF is the version for reading in
              full. */}
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <Row
                cells={[t('statement.category'), t('statement.total')]}
                bold
                colors={[theme.textDim, theme.textDim]}
              />
              {statement.expenses.lines.map((line) => (
                <Row
                  key={line.key}
                  cells={[line.label, money(line.totalMinor)]}
                  colors={[theme.text, theme.text]}
                />
              ))}
              <Row
                cells={[t('statement.expenses'), money(statement.expenses.totalMinor)]}
                bold
                colors={[theme.text, theme.text]}
              />
            </View>
          </ScrollView>
        </Card>
      ) : null}

      {/* -------------------------------------------------------- the files */}
      <Card gap={space.sm}>
        <SectionLabel>{t('statement.download')}</SectionLabel>
        <Button
          label={busy === 'pdf' ? t('statement.preparing') : t('statement.pdf')}
          onPress={() => void send('pdf')}
          disabled={busy !== null || empty}
        />
        <Button
          label={busy === 'xlsx' ? t('statement.preparing') : t('statement.xlsx')}
          variant="secondary"
          onPress={() => void send('xlsx')}
          disabled={busy !== null || empty}
        />
        <Button
          label={busy === 'csv' ? t('statement.preparing') : t('statement.csv')}
          variant="secondary"
          onPress={() => void send('csv')}
          disabled={busy !== null || empty}
        />
        <Text style={[styles.caveat, { color: theme.textDim }]}>{t('statement.privacy')}</Text>
      </Card>

      {/* --------------------------------------------------- the year start */}
      <Card gap={space.sm}>
        <SectionLabel>{t('statement.yearStart')}</SectionLabel>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('statement.yearStartHint')}</Text>
        <View style={styles.wrap}>
          {starts.map((month) => {
            const active = startMonth === month;
            return (
              <Pressable
                key={month}
                onPress={() => void changeStart(month)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.pill,
                  {
                    borderColor: active ? theme.accent : theme.borderStrong,
                    backgroundColor: active
                      ? theme.accentSoft
                      : pressed
                        ? theme.surfaceAlt
                        : 'transparent',
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? theme.accent : theme.text,
                    fontWeight: active ? '700' : '500',
                    fontSize: type.body,
                  }}
                >
                  {monthName(month)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {!allMonths ? (
          <Pressable onPress={() => setAllMonths(true)} hitSlop={8}>
            <Text style={{ color: theme.accent, fontSize: type.small }}>
              {t('statement.allMonths')}
            </Text>
          </Pressable>
        ) : null}
      </Card>
    </Screen>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}) {
  const theme = useTheme();
  const colour = tone === 'bad' ? theme.danger : tone === 'good' ? theme.income : theme.text;
  return (
    <View style={styles.figure}>
      <Text style={[styles.figureLabel, { color: theme.textDim }]}>{label}</Text>
      <Text style={[styles.figureValue, { color: colour }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Row({
  cells,
  bold,
  colors,
}: {
  cells: string[];
  bold?: boolean;
  colors: string[];
}) {
  return (
    <View style={styles.row}>
      {cells.map((cell, i) => (
        <Text
          key={i}
          numberOfLines={1}
          style={[
            i === 0 ? styles.cellLabel : styles.cellNumber,
            { color: colors[i] ?? '#000', fontWeight: bold ? '700' : '400' },
          ]}
        >
          {cell}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  hint: { fontSize: type.small, lineHeight: 19 },
  caveat: { fontSize: type.tiny, lineHeight: 16 },
  figure: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.md },
  figureLabel: { fontSize: type.small, flexShrink: 1 },
  figureValue: { fontSize: type.body, fontWeight: '700' },
  row: { flexDirection: 'row', paddingVertical: space.xs, gap: space.lg },
  cellLabel: { width: 180, fontSize: type.small },
  cellNumber: { width: 120, fontSize: type.small, textAlign: 'right' },
});
