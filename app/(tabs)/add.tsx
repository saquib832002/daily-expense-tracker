import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  addTransaction,
  getBaseCurrency,
  listAccounts,
  listCategories,
  suggestForDraft,
  recentMerchants,
  softDeleteTransaction,
  type RecentMerchant,
} from '@/db/queries';
import type { Account, Category } from '@/db/schema';
import { quickDates, relativeDayKey, startOfDay } from '@/domain/dates';
import { formatMinor, parseAmountToMinor } from '@/domain/money';
import { formatDate, t } from '@/i18n';
import { radius, space, type, useTheme } from '@/theme';
import { Chip, Field, Sheet } from '@/ui';
import { DatePickerSheet } from '@/ui/DatePickerSheet';

/**
 * The most important screen in the app.
 *
 * The keypad is the first and largest thing on it. The last thing you tap is
 * what commits — a category, or a recent-merchant chip. Everything else
 * (where, when, which account, a note) is optional and set beforehand, behind
 * a single row that never gets in the way.
 *
 * Target: under five seconds and three taps for a typical cash spend. Measure
 * it on a real device; if it creeps past that, cut something.
 */

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

export default function AddScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [raw, setRaw] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [recents, setRecents] = useState<RecentMerchant[]>([]);
  const [currency, setCurrency] = useState('INR');

  // Optional detail, set before committing.
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => Date.now());
  const [accountId, setAccountId] = useState<string | null>(null);

  const [sheet, setSheet] = useState<'none' | 'detail' | 'account' | 'date'>('none');
  const [savedId, setSavedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCurrency(await getBaseCurrency());
    const list = await listAccounts();
    setAccountList(list);
    setAccountId((prev) => prev ?? list[0]?.id ?? null);
    setRecents(await recentMerchants(6));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    listCategories(kind).then(setCategoryList);
  }, [kind]);

  const account = useMemo(
    () => accountList.find((a) => a.id === accountId) ?? accountList[0] ?? null,
    [accountList, accountId],
  );
  const entryCurrency = account?.currency ?? currency;
  const minor = useMemo(
    () => parseAmountToMinor(raw || '0', entryCurrency) ?? 0,
    [raw, entryCurrency],
  );
  const canSave = minor > 0 && account !== null;

  const reset = useCallback(() => {
    setRaw('');
    setMerchant('');
    setNote('');
    setOccurredAt(Date.now());
  }, []);

  const press = useCallback(
    (key: string) => {
      setSavedId(null);
      setRaw((prev) => {
        if (key === '⌫') return prev.slice(0, -1);
        if (key === '.' && prev.includes('.')) return prev;
        if (key === '.' && prev === '') return '0.';
        const [, frac] = prev.split('.');
        // Don't let someone type more decimals than the currency has.
        if (frac !== undefined && frac.length >= 2) return prev;
        if (prev === '0' && key !== '.') return key;
        if (prev.replace(/\D/g, '').length >= 12) return prev; // sanity ceiling
        return prev + key;
      });
    },
    [],
  );

  const commit = useCallback(
    async (categoryId: string | null, overrides?: Partial<{ merchant: string; amountMinor: number }>) => {
      const acc = account;
      const amount = overrides?.amountMinor ?? minor;
      if (!acc || amount <= 0) return;

      const id = await addTransaction({
        amountMinor: amount,
        accountId: acc.id,
        categoryId,
        currency: acc.currency,
        merchant: overrides?.merchant ?? merchant,
        note,
        occurredAt,
        kind,
        fxRate: 1,
      });

      setSavedId(id);
      reset();
      setRecents(await recentMerchants(6));
    },
    [account, minor, merchant, note, occurredAt, kind, reset],
  );

  /** One tap repeats a purchase you make often, amount and all. */
  const repeat = useCallback(
    async (r: RecentMerchant) => {
      await commit(r.categoryId, {
        merchant: r.merchant,
        amountMinor: minor > 0 ? minor : r.amountMinor,
      });
    },
    [commit, minor],
  );

  const undo = useCallback(async () => {
    if (!savedId) return;
    await softDeleteTransaction(savedId);
    setSavedId(null);
    setRecents(await recentMerchants(6));
  }, [savedId]);

  const [suggestedCategoryId, setSuggestedCategoryId] = useState<string | null>(null);

  /**
   * When a merchant is typed, offer the category it belongs to — from a rule
   * you wrote if there is one, otherwise from what the app learned when you
   * last corrected it.
   */
  const onMerchantBlur = useCallback(async () => {
    if (!merchant.trim()) return;
    const suggestion = await suggestForDraft({ merchant, note });
    if (suggestion.categoryId) setSuggestedCategoryId(suggestion.categoryId);
    if (suggestion.accountId) setAccountId(suggestion.accountId);
  }, [merchant, note]);

  const orderedCategories = useMemo(() => {
    if (!suggestedCategoryId) return categoryList;
    const hit = categoryList.find((c) => c.id === suggestedCategoryId);
    if (!hit) return categoryList;
    return [hit, ...categoryList.filter((c) => c.id !== hit.id)];
  }, [categoryList, suggestedCategoryId]);

  const dateKey = relativeDayKey(occurredAt);
  const dateLabel = dateKey ? t(dateKey) : formatDate(occurredAt);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {/* Amount ------------------------------------------------------------ */}
      <View style={styles.amountArea}>
        <View style={styles.kindRow}>
          {(['expense', 'income'] as const).map((k) => (
            <Chip
              key={k}
              label={t(k === 'expense' ? 'add.expense' : 'add.income')}
              active={kind === k}
              onPress={() => {
                setKind(k);
                setSavedId(null);
              }}
            />
          ))}

          {/* The keypad is still the fast path. Scanning is for the times you
              have a paper bill in your hand and would rather not read it. */}
          <Pressable
            onPress={() => router.push('/scan')}
            hitSlop={8}
            style={({ pressed }) => [
              styles.scanButton,
              {
                borderColor: theme.border,
                backgroundColor: pressed ? theme.accentSoft : theme.surface,
              },
            ]}
          >
            <Text style={styles.scanIcon}>📷</Text>
            <Text style={[styles.scanLabel, { color: theme.accent }]}>{t('add.scan')}</Text>
          </Pressable>
        </View>

        <Text
          style={[
            styles.amount,
            { color: raw ? (kind === 'income' ? theme.income : theme.text) : theme.textDim },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatMinor(minor, entryCurrency, { compact: true })}
        </Text>

        {savedId ? (
          <Pressable onPress={undo} hitSlop={8} style={styles.undoRow}>
            <Text style={{ color: theme.accent, fontSize: type.small, fontWeight: '600' }}>
              {t('add.saved')}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: type.small }}>·</Text>
            <Text style={{ color: theme.danger, fontSize: type.small, fontWeight: '600' }}>
              {t('add.undo')}
            </Text>
          </Pressable>
        ) : (
          <Text style={[styles.hint, { color: theme.textDim }]}>
            {canSave ? t('add.chooseCategory') : t('add.amount')}
          </Text>
        )}
      </View>

      {/* Detail bar — where, when, which account --------------------------- */}
      <View style={[styles.detailBar, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <Pressable style={styles.detailItem} onPress={() => setSheet('detail')}>
          <Text style={[styles.detailValue, { color: merchant ? theme.text : theme.textDim }]} numberOfLines={1}>
            {merchant || t('add.merchant')}
          </Text>
        </Pressable>
        <View style={[styles.detailDivider, { backgroundColor: theme.border }]} />
        <Pressable style={styles.detailItem} onPress={() => setSheet('date')}>
          <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={1}>
            {dateLabel}
          </Text>
        </Pressable>
        <View style={[styles.detailDivider, { backgroundColor: theme.border }]} />
        <Pressable style={styles.detailItem} onPress={() => setSheet('account')}>
          <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={1}>
            {account ? `${account.icon ?? ''} ${account.name}`.trim() : '—'}
          </Text>
        </Pressable>
      </View>

      {/* Keypad ------------------------------------------------------------ */}
      <View style={styles.keypad}>
        {KEYS.map((k) => (
          <Pressable
            key={k}
            onPress={() => press(k)}
            style={({ pressed }) => [
              styles.key,
              { backgroundColor: pressed ? theme.surfaceAlt : theme.surface, borderColor: theme.border },
            ]}
          >
            <Text style={[styles.keyLabel, { color: theme.text }]}>{k}</Text>
          </Pressable>
        ))}
      </View>

      {/* Recent merchants — one tap repeats a usual purchase ---------------- */}
      {kind === 'expense' && recents.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recentRow}
        >
          {recents.map((r) => (
            <Pressable
              key={r.merchantKey}
              disabled={!account}
              onPress={() => repeat(r)}
              style={({ pressed }) => [
                styles.recent,
                {
                  backgroundColor: pressed ? theme.accentSoft : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={[styles.recentName, { color: theme.text }]} numberOfLines={1}>
                {r.merchant}
              </Text>
              <Text style={[styles.recentAmount, { color: theme.textDim }]}>
                {formatMinor(minor > 0 ? minor : r.amountMinor, entryCurrency, { compact: true })}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Categories — tapping one saves and clears -------------------------- */}
      <View style={[styles.categoryBar, { borderTopColor: theme.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {orderedCategories.map((c) => (
            <Pressable
              key={c.id}
              disabled={!canSave}
              onPress={() => commit(c.id)}
              style={({ pressed }) => [
                styles.category,
                {
                  backgroundColor: pressed ? theme.accentSoft : theme.surface,
                  borderColor: c.id === suggestedCategoryId ? theme.accent : theme.border,
                  opacity: canSave ? 1 : 0.4,
                },
              ]}
            >
              <Text style={styles.categoryIcon}>{c.icon ?? '•'}</Text>
              <Text style={[styles.categoryLabel, { color: theme.textDim }]} numberOfLines={1}>
                {c.customName ?? t(c.nameKey ?? '')}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Sheets ------------------------------------------------------------ */}
      <Sheet visible={sheet === 'detail'} title={t('add.details')} onClose={() => setSheet('none')}>
        <Field
          label={t('add.merchant')}
          value={merchant}
          onChangeText={setMerchant}
          onBlur={onMerchantBlur}
          placeholder={t('add.merchantHint')}
          autoCapitalize="words"
        />
        <Field
          label={t('add.note')}
          value={note}
          onChangeText={setNote}
          placeholder={t('add.noteHint')}
          multiline
        />
        <View style={styles.quickDates}>
          {quickDates().map((q) => (
            <Chip
              key={q.ms}
              label={q.key ? t(q.key) : formatDate(q.ms)}
              active={startOfDay(occurredAt) === q.ms}
              onPress={() => setOccurredAt(q.ms)}
            />
          ))}
        </View>
      </Sheet>

      <Sheet visible={sheet === 'account'} title={t('more.accounts')} onClose={() => setSheet('none')}>
        {accountList.map((a) => (
          <Chip
            key={a.id}
            label={`${a.icon ?? ''} ${a.name} · ${a.currency}`.trim()}
            active={a.id === account?.id}
            onPress={() => {
              setAccountId(a.id);
              setSheet('none');
            }}
          />
        ))}
      </Sheet>

      <DatePickerSheet
        visible={sheet === 'date'}
        value={occurredAt}
        title={t('add.when')}
        onClose={() => setSheet('none')}
        onSelect={setOccurredAt}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  amountArea: { alignItems: 'center', paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
  kindRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  scanButton: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  scanIcon: { fontSize: 14 },
  scanLabel: { fontSize: type.small, fontWeight: '600' },
  amount: { fontSize: type.display, fontWeight: '600', letterSpacing: -1 },
  hint: { fontSize: type.small },
  undoRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  detailBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space.md,
    marginBottom: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  detailItem: { flex: 1, paddingVertical: space.md, paddingHorizontal: space.sm, alignItems: 'center' },
  detailDivider: { width: 1, alignSelf: 'stretch' },
  detailValue: { fontSize: type.small },
  keypad: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  key: {
    flexGrow: 1,
    flexBasis: '31%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
  },
  keyLabel: { fontSize: 24, fontWeight: '500' },
  recentRow: { paddingHorizontal: space.md, gap: space.sm, paddingVertical: space.md },
  recent: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    maxWidth: 150,
    gap: 2,
  },
  recentName: { fontSize: type.small, fontWeight: '600' },
  recentAmount: { fontSize: type.tiny, fontVariant: ['tabular-nums'] },
  categoryBar: { borderTopWidth: 1, paddingVertical: space.md },
  categoryRow: { paddingHorizontal: space.md, gap: space.sm },
  category: {
    width: 74,
    paddingVertical: space.md,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 4,
  },
  categoryIcon: { fontSize: 22 },
  categoryLabel: { fontSize: type.tiny, textAlign: 'center' },
  quickDates: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.sm },
});
