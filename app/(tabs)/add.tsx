import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, I18nManager, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  addTransaction,
  getBaseCurrency,
  getSetting,
  setSetting,
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
import { ensurePermission, permissionState, rescheduleAll } from '@/services/notifications';
import { radius, space, type, useTheme } from '@/theme';
import { Chip, Field, Sheet } from '@/ui';
import { DatePickerSheet } from '@/ui/DatePickerSheet';
import { Toast } from '@/ui/Toast';

/** Remembers that the reminder offer has been made, so it is made only once. */
const ASKED_KEY = 'notify_asked';

/** What the confirmation says. Captured at save time, before the screen resets. */
interface SavedEntry {
  id: string;
  /** Already formatted in the account's currency. */
  amount: string;
  category: string | null;
  merchant: string;
}

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

/**
 * Explicit rows, not a wrapping list.
 *
 * This used to be one flat array in a `flexWrap` container, with each key held
 * open by `minHeight: 52`. That combination is a trap: the container is
 * `flex: 1`, so when the screen runs short it shrinks — but the keys inside it
 * do not, because React Native defaults `flexShrink` to 0. The content stayed
 * 232pt tall inside a box that had become 150, and the bottom two rows spilled
 * out underneath the recent-merchant strip. On a 640pt-tall phone the keypad
 * stopped at 6.
 *
 * Rows that flex vertically cannot do that. Whatever height the keypad is
 * given, four rows divide it and all twelve keys are on screen — the keys get
 * shorter on a small phone rather than disappearing off the bottom of it.
 */
const KEY_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '⌫'],
];

/**
 * Below this much usable height, the full-size layout does not fit and
 * something has to give. Measured rather than guessed at from the window size,
 * because the window includes the status bar and the tab bar and those vary.
 */
const COMPACT_BELOW = 600;

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
  /**
   * The last thing saved, or null. Richer than the id it used to be, because
   * the confirmation quotes the amount and the category back at the user — the
   * point of a receipt is the detail on it.
   */
  const [saved, setSaved] = useState<SavedEntry | null>(null);

  /**
   * Height this screen actually got, once. Setting it from onLayout is safe
   * against loops here because `compact` only changes the heights of children —
   * the root stays whatever the tab navigator handed it.
   */
  const [availableHeight, setAvailableHeight] = useState(0);
  const compact = availableHeight > 0 && availableHeight < COMPACT_BELOW;

  /** Set when a category is tapped before an amount has been entered. */
  const [needsAmount, setNeedsAmount] = useState(false);

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
      setSaved(null);
      setNeedsAmount(false);
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

  /**
   * The one moment worth spending the notification prompt on.
   *
   * Android gives an app a single permission dialog, and a refusal is close to
   * permanent — so it is asked here, just after somebody has recorded their
   * first expense, rather than on first launch where they would have no idea
   * what they were agreeing to. The app explains the offer in its own words
   * first; the system dialog only appears if they say yes to that.
   */
  const offerReminderOnce = useCallback(async () => {
    try {
      if ((await getSetting(ASKED_KEY)) === '1') return;
      if ((await permissionState()) !== 'undetermined') return;
      // Only from the second entry onwards: the very first save is the moment
      // they are proudest of the app, but they have not yet formed the habit
      // this reminder protects.
      await setSetting(ASKED_KEY, '1');

      Alert.alert(t('notify.offerTitle'), t('notify.offerBody'), [
        { text: t('notify.offerNo'), style: 'cancel' },
        {
          text: t('notify.offerYes'),
          onPress: () => {
            void (async () => {
              await ensurePermission();
              await rescheduleAll();
            })();
          },
        },
      ]);
    } catch {
      // A prompt that fails to appear is not worth breaking a save over.
    }
  }, []);

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

      // Captured BEFORE `reset()` wipes the screen. The confirmation has to
      // say what it saved — "Saved" on its own does not tell anyone whether it
      // saved the thing they meant — and a moment from now none of this is on
      // screen to read back.
      const category = categoryList.find((c) => c.id === categoryId);
      setSaved({
        id,
        amount: formatMinor(amount, acc.currency, { compact: true }),
        category: category ? (category.customName ?? t(category.nameKey ?? '')) : null,
        merchant: overrides?.merchant ?? merchant,
      });

      reset();
      setRecents(await recentMerchants(6));
      void offerReminderOnce();
    },
    [account, minor, merchant, note, occurredAt, kind, reset, categoryList, offerReminderOnce],
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
    if (!saved) return;
    await softDeleteTransaction(saved.id);
    setSaved(null);
    setRecents(await recentMerchants(6));
  }, [saved]);

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

  /**
   * The second line of the confirmation: category, then merchant if there is
   * one. Built here rather than in the toast so the toast stays a dumb
   * component, and so an entry with neither simply has no second line instead
   * of a stray separator.
   */
  const savedDetail = useMemo(() => {
    if (!saved) return undefined;
    const parts = [saved.category, saved.merchant.trim() || null].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : t('add.savedNoCategory');
  }, [saved]);

  const dateKey = relativeDayKey(occurredAt);
  const dateLabel = dateKey ? t(dateKey) : formatDate(occurredAt);

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.bg }]}
      edges={['top']}
      onLayout={(e) => setAvailableHeight(e.nativeEvent.layout.height)}
    >
      {/* The receipt.
          Absolutely positioned rather than pushed into the layout, because a
          confirmation that reflows the screen would move the keypad under
          someone's thumb mid-tap.

          Sitting just low enough to cover the amount rather than the
          expense/income chips, and that placement is the point: the big number
          resetting to zero is the exact thing that reads as "nothing
          happened", so the confirmation lands on top of it. */}
      <Toast
        top={compact ? 44 : 56}
        visible={saved !== null}
        title={t('add.savedAmount', { amount: saved?.amount ?? '' })}
        detail={savedDetail}
        actionLabel={t('add.undo')}
        onAction={() => void undo()}
        onHide={() => setSaved(null)}
      />

      {/* Amount ------------------------------------------------------------ */}
      <View style={[styles.amountArea, compact && styles.amountAreaCompact]}>
        <View style={styles.kindRow}>
          {(['expense', 'income'] as const).map((k) => (
            <Chip
              key={k}
              label={t(k === 'expense' ? 'add.expense' : 'add.income')}
              active={kind === k}
              onPress={() => {
                setKind(k);
                setSaved(null);
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
            compact && styles.amountCompact,
            { color: raw ? (kind === 'income' ? theme.income : theme.text) : theme.textDim },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatMinor(minor, entryCurrency, { compact: true })}
        </Text>

        {/* The signpost to the category strip. It changes colour rather than
            just wording: dim while there is nothing to do, accent once an
            amount is waiting to be filed, warn if someone reached for a
            category too early.

            It no longer doubles as the save confirmation. It used to, and that
            was the bug: a line of small text quietly swapping from "Choose a
            category" to "Saved", in the middle of a screen that had just reset
            itself to zero, is indistinguishable from nothing having happened.
            The confirmation is the toast at the top of the screen now. */}
        <Text
          style={[
            styles.hint,
            { color: needsAmount ? theme.warn : canSave ? theme.accent : theme.textDim },
            (needsAmount || canSave) && styles.hintStrong,
          ]}
        >
          {needsAmount
            ? t('add.needAmount')
            : canSave
              ? t('add.chooseCategory')
              : t('add.amount')}
        </Text>
      </View>

      {/* Detail bar — where, when, which account --------------------------- */}
      <View
        style={[
          styles.detailBar,
          compact && styles.detailBarCompact,
          { borderColor: theme.border, backgroundColor: theme.surface },
        ]}
      >
        <Pressable
          style={[styles.detailItem, compact && styles.detailItemCompact]}
          onPress={() => setSheet('detail')}
        >
          <Text style={[styles.detailValue, { color: merchant ? theme.text : theme.textDim }]} numberOfLines={1}>
            {merchant || t('add.merchant')}
          </Text>
        </Pressable>
        <View style={[styles.detailDivider, { backgroundColor: theme.border }]} />
        <Pressable
          style={[styles.detailItem, compact && styles.detailItemCompact]}
          onPress={() => setSheet('date')}
        >
          <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={1}>
            {dateLabel}
          </Text>
        </Pressable>
        <View style={[styles.detailDivider, { backgroundColor: theme.border }]} />
        <Pressable
          style={[styles.detailItem, compact && styles.detailItemCompact]}
          onPress={() => setSheet('account')}
        >
          <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={1}>
            {account ? `${account.icon ?? ''} ${account.name}`.trim() : '—'}
          </Text>
        </Pressable>
      </View>

      {/* Keypad ------------------------------------------------------------ */}
      <View style={styles.keypad}>
        {KEY_ROWS.map((row) => (
          <View key={row.join('')} style={styles.keyRow}>
            {row.map((k) => (
              <Pressable
                key={k}
                onPress={() => press(k)}
                // A short key is still a big target: the row is the full width
                // divided by three, so even at the 44pt floor every key clears
                // the minimum touch size in both directions.
                style={({ pressed }) => [
                  styles.key,
                  {
                    backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text
                  style={[styles.keyLabel, compact && styles.keyLabelCompact, { color: theme.text }]}
                >
                  {k}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      {/* Recent merchants — one tap repeats a usual purchase ---------------- */}
      {kind === 'expense' && recents.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.recentRow, compact && styles.recentRowCompact]}
        >
          {recents.map((r) => (
            <Pressable
              key={r.merchantKey}
              disabled={!account}
              onPress={() => repeat(r)}
              style={({ pressed }) => [
                styles.recent,
                compact && styles.recentCompact,
                {
                  backgroundColor: pressed ? theme.accentSoft : theme.surface,
                  borderColor: theme.border,
                },
              ]}
            >
              {/* On a short screen this becomes one line instead of two. That
                  buys back about 30pt for the keypad while keeping the feature,
                  which is better than hiding the strip: repeating a usual
                  purchase is the fastest path this screen has. */}
              <Text style={[styles.recentName, { color: theme.text }]} numberOfLines={1}>
                {r.merchant}
              </Text>
              <Text style={[styles.recentAmount, { color: theme.textDim }]}>
                {compact ? '· ' : ''}
                {formatMinor(minor > 0 ? minor : r.amountMinor, entryCurrency, { compact: true })}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Categories — tapping one saves and clears -------------------------- */}
      <View
        style={[
          styles.categoryBar,
          compact && styles.categoryBarCompact,
          // Its own surface, so the commit strip reads as a footer rather than
          // more page. The tiles' 3:1 edge does the real work of being findable;
          // this just stops the row dissolving into the background.
          { borderTopColor: theme.borderStrong, backgroundColor: theme.surface },
        ]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {orderedCategories.map((c) => (
            <Pressable
              key={c.id}
              // Deliberately NOT disabled when there is no amount yet.
              //
              // It used to be, and the tile was drawn at 40% opacity to say so
              // — which dropped the label to 1.9:1 against its own background
              // and the border to 1.1:1 against the page. WCAG asks 4.5:1 for
              // text and 3:1 for a control edge. In other words the categories
              // were not dim, they were invisible, and that is the first thing
              // anyone sees on opening the screen. A tap now answers with the
              // reason instead of nothing happening.
              onPress={() => (canSave ? commit(c.id) : setNeedsAmount(true))}
              style={({ pressed }) => [
                styles.category,
                compact && styles.categoryCompact,
                {
                  backgroundColor: pressed
                    ? theme.accentSoft
                    : c.id === suggestedCategoryId
                      ? theme.accentSoft
                      : theme.surfaceAlt,
                  borderColor:
                    c.id === suggestedCategoryId ? theme.accent : theme.borderStrong,
                },
              ]}
            >
              <Text style={styles.categoryIcon}>{c.icon ?? '•'}</Text>
              <Text style={[styles.categoryLabel, { color: theme.text }]} numberOfLines={1}>
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
  amountAreaCompact: { paddingTop: space.sm, paddingBottom: space.xs, gap: space.xs },
  kindRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  scanButton: {
    // marginStart, not marginLeft: this pushes the button to the far edge of
    // the row, and in Arabic or Urdu the far edge is the left one.
    marginStart: 'auto',
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
  // adjustsFontSizeToFit shrinks the glyphs but not the box, so the box has to
  // be told separately that this is a small screen.
  amountCompact: { fontSize: type.title + 6 },
  hint: { fontSize: type.small },
  hintStrong: { fontWeight: '600' },
  undoRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  detailBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space.md,
    marginBottom: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  detailBarCompact: { marginBottom: space.sm },
  detailItem: { flex: 1, paddingVertical: space.md, paddingHorizontal: space.sm, alignItems: 'center' },
  detailItemCompact: { paddingVertical: space.sm + 2 },
  detailDivider: { width: 1, alignSelf: 'stretch' },
  detailValue: { fontSize: type.small },
  keypad: {
    flex: 1,
    // Four rows of 44 plus the gaps between them. The floor exists so the
    // keypad claims a fair share on a cramped screen rather than being squeezed
    // to nothing by the fixed-height strips below it; the rows inside divide
    // whatever it ends up with, so it can never overflow again.
    minHeight: 4 * 44 + 3 * space.sm,
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  /**
   * A number pad does not mirror.
   *
   * React Native turns `row` into right-to-left automatically when the
   * interface is Arabic or Urdu, which is right for a row of words and wrong
   * for this: it would lay the keys out 3-2-1 / 6-5-4. Digits are read
   * left-to-right in every script on earth, and every phone dialler and
   * calculator in the Arab world keeps 1-2-3 in that order. Asking for
   * `row-reverse` under RTL cancels the automatic flip and leaves the keypad
   * exactly where a hand expects it.
   */
  keyRow: {
    flex: 1,
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    gap: space.sm,
  },
  key: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
  },
  keyLabel: { fontSize: 24, fontWeight: '500' },
  keyLabelCompact: { fontSize: 20 },
  recentRow: { paddingHorizontal: space.md, gap: space.sm, paddingVertical: space.md },
  recentRowCompact: { paddingVertical: space.sm },
  recent: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    maxWidth: 150,
    gap: 2,
  },
  recentCompact: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  recentName: { fontSize: type.small, fontWeight: '600' },
  recentAmount: { fontSize: type.tiny, fontVariant: ['tabular-nums'] },
  categoryBar: { borderTopWidth: 1, paddingVertical: space.md },
  // The commit strip gets its own surface so it reads as a distinct footer
  // rather than more page, and the tiles inside it carry a 3:1 edge.
  categoryBarCompact: { paddingVertical: space.sm },
  categoryRow: { paddingHorizontal: space.md, gap: space.sm },
  category: {
    width: 74,
    paddingVertical: space.md,
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 4,
  },
  categoryCompact: { paddingVertical: space.sm },
  categoryIcon: { fontSize: 22 },
  categoryLabel: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  quickDates: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.sm },
});
