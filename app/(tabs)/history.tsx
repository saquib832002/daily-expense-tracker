import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getBaseCurrency, getFirstDayOfMonth, listCategories, listTransactions } from '@/db/queries';
import type { Category, Transaction } from '@/db/schema';
import { addMonths, relativeDayKey, startOfDay } from '@/domain/dates';
import { monthBounds } from '@/domain/budget';
import { formatMinor, sumMinor } from '@/domain/money';
import { dateLocale, formatDate, t } from '@/i18n';
import { radius, space, type, useTheme } from '@/theme';
import { EmptyState, ListRow } from '@/ui';

/**
 * The month's ledger, grouped by day, with a month stepper and a search box.
 *
 * SectionList is still fine at this size. FlashList replaces it in Phase 3,
 * once there are enough rows for the difference to be visible on a real phone.
 */
export default function HistoryScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [cursor, setCursor] = useState(() => Date.now());
  const [rows, setRows] = useState<Transaction[]>([]);
  const [categoryById, setCategoryById] = useState<Record<string, Category>>({});
  const [currency, setCurrency] = useState('INR');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const base = await getBaseCurrency();
    const firstDay = await getFirstDayOfMonth();
    const bounds = monthBounds(cursor, firstDay);

    const expense = await listCategories('expense');
    const income = await listCategories('income');
    const map: Record<string, Category> = {};
    for (const c of [...expense, ...income]) map[c.id] = c;

    setCurrency(base);
    setCategoryById(map);
    setRows(await listTransactions(bounds.start, bounds.end));
  }, [cursor]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const cat = r.categoryId ? categoryById[r.categoryId] : null;
      const catName = cat ? (cat.customName ?? t(cat.nameKey ?? '')) : '';
      return (
        (r.merchant ?? '').toLowerCase().includes(q) ||
        (r.note ?? '').toLowerCase().includes(q) ||
        catName.toLowerCase().includes(q)
      );
    });
  }, [rows, query, categoryById]);

  const sections = useMemo(() => {
    const byDay = new Map<number, Transaction[]>();
    for (const tx of filtered) {
      const day = startOfDay(tx.occurredAt);
      const list = byDay.get(day);
      if (list) list.push(tx);
      else byDay.set(day, [tx]);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([day, data]) => ({ day, data }));
  }, [filtered]);

  const total = useMemo(() => sumMinor(filtered.map((r) => r.baseAmountMinor)), [filtered]);

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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.monthRow}>
          <Text
            style={[styles.navArrow, { color: theme.accent }]}
            onPress={() => setCursor(addMonths(cursor, -1))}
          >
            ‹
          </Text>
          <Text style={[styles.title, { color: theme.text }]}>{monthLabel}</Text>
          <Text
            style={[styles.navArrow, { color: atCurrentMonth ? theme.border : theme.accent }]}
            onPress={() => !atCurrentMonth && setCursor(addMonths(cursor, 1))}
          >
            ›
          </Text>
        </View>

        <Text style={[styles.total, { color: theme.textDim }]}>
          {t('history.total')} {formatMinor(Math.abs(total), currency, { compact: true })}
        </Text>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('history.search')}
          placeholderTextColor={theme.textDim}
          style={[
            styles.search,
            { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface },
          ]}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<EmptyState text={t('history.empty')} />}
        renderSectionHeader={({ section }) => {
          const key = relativeDayKey(section.day);
          return (
            <Text style={[styles.day, { color: theme.textDim }]}>
              {key ? t(key) : formatDate(section.day, 'long')}
            </Text>
          );
        }}
        renderItem={({ item, index, section }) => {
          const cat = item.categoryId ? categoryById[item.categoryId] : null;
          const catName = cat ? (cat.customName ?? t(cat.nameKey ?? '')) : null;
          return (
            <View style={[styles.rowWrap, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <ListRow
                icon={cat?.icon ?? '•'}
                title={item.merchant || catName || t('add.expense')}
                subtitle={item.note ?? (item.merchant ? catName : null)}
                value={formatMinor(item.amountMinor, item.currency, { compact: true, signed: true })}
                valueColor={item.amountMinor >= 0 ? theme.income : theme.text}
                onPress={() => router.push(`/txn/${item.id}`)}
                last={index === section.data.length - 1}
              />
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    gap: space.sm,
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navArrow: { fontSize: 26, paddingHorizontal: space.md },
  title: { fontSize: type.title, fontWeight: '600' },
  total: { fontSize: type.small, textAlign: 'center' },
  search: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: type.small,
  },
  content: { padding: space.lg, paddingTop: space.sm },
  day: {
    fontSize: type.tiny,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  rowWrap: { borderWidth: 1, borderRadius: radius.md, marginBottom: space.sm, overflow: 'hidden' },
});
