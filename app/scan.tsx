import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  addTransaction,
  getBaseCurrency,
  listAccounts,
  listCategories,
  suggestForDraft,
} from '@/db/queries';
import type { Account, Category } from '@/db/schema';
import { relativeDayKey } from '@/domain/dates';
import { formatMinor, minorToDecimalString, parseAmountToMinor } from '@/domain/money';
import { parseReceiptFromLines, type ReceiptGuess } from '@/domain/receipt';
import { formatDate, prefersDayFirst, t } from '@/i18n';
import { OCR_UNAVAILABLE, isOcrAvailable, readImage } from '@/services/ocr';
import {
  deleteReceipt,
  pickReceipt,
  receiptUri,
  saveReceipt,
  type PickedImage,
} from '@/services/receipts';
import { radius, space, type, useTheme } from '@/theme';
import { Button, Card, Chip, Field, Screen, SectionLabel, Sheet } from '@/ui';
import { DatePickerSheet } from '@/ui/DatePickerSheet';

type Stage = 'choose' | 'working' | 'confirm';

/**
 * Scan a bill.
 *
 * The photo is read on the device and the result is put in front of you to
 * confirm — never written straight to the ledger. That is the app's oldest
 * rule and it matters most here: OCR is a guess, and an app that quietly
 * records guesses is an app whose numbers you stop believing.
 *
 * Everything the scan found is shown as an ordinary editable field with a note
 * saying where it came from, so correcting it is the same gesture as typing it.
 */
export default function ScanScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [stage, setStage] = useState<Stage>('choose');
  const [receiptName, setReceiptName] = useState<string | null>(null);
  const [guess, setGuess] = useState<ReceiptGuess | null>(null);
  const [ocrProblem, setOcrProblem] = useState<'none' | 'unreadable' | 'notBuilt'>('none');
  /** The raw failure, shown small. One screenshot then explains everything. */
  const [ocrDetail, setOcrDetail] = useState<string | null>(null);
  const [showRead, setShowRead] = useState(false);

  const [currency, setCurrency] = useState('INR');
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [categoryList, setCategoryList] = useState<Category[]>([]);

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => Date.now());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  /**
   * Where the pre-selected category came from, in the user's words. Null when
   * nothing was pre-selected, so the screen stays quiet rather than explaining
   * an absence.
   */
  const [categoryWhy, setCategoryWhy] = useState<string | null>(null);
  /** Has a person touched the category? Decides whether the app learns from it. */
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'account' | 'date'>('none');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setCurrency(await getBaseCurrency());
      const accounts = await listAccounts();
      setAccountList(accounts);
      setAccountId((prev) => prev ?? accounts[0]?.id ?? null);
      setCategoryList(await listCategories('expense'));
    })();
  }, []);

  const account = accountList.find((a) => a.id === accountId) ?? accountList[0] ?? null;
  const entryCurrency = account?.currency ?? currency;

  /* ------------------------------------------------------------- capture */

  const start = useCallback(
    async (source: 'camera' | 'library') => {
      let picked: PickedImage | null = null;
      try {
        picked = await pickReceipt(source);
      } catch (e) {
        const code = e instanceof Error ? e.message : '';
        const key =
          code === 'permissionDenied'
            ? 'scan.noPermission'
            : code === 'nativeMissing'
              ? 'scan.needsRebuild'
              : 'scan.pickFailed';
        Alert.alert(t('scan.title'), t(key));
        return;
      }
      if (!picked) return; // backed out, which is not a failure

      setStage('working');
      setOcrProblem('none');
      setOcrDetail(null);

      // Read the photo at FULL resolution, before it is shrunk for storage.
      // Small print is exactly what OCR struggles with, and the stored copy is
      // deliberately compressed — reading that instead throws away accuracy we
      // already have in hand.
      let lines: Awaited<ReturnType<typeof readImage>>['lines'] = [];
      let ocrFailed: string | null = null;
      try {
        lines = (await readImage(picked.uri)).lines;
      } catch (e) {
        ocrFailed = e instanceof Error ? e.message : String(e);
      }

      // The photo is kept whatever happens next: a bill you photographed is
      // worth keeping even if nothing could be read off it.
      let name: string | null = null;
      try {
        name = await saveReceipt(picked);
        setReceiptName(name);
      } catch {
        Alert.alert(t('scan.title'), t('scan.saveFailed'));
        setStage('choose');
        return;
      }

      if (ocrFailed !== null) {
        setOcrProblem(ocrFailed === OCR_UNAVAILABLE ? 'notBuilt' : 'unreadable');
        if (ocrFailed !== OCR_UNAVAILABLE) setOcrDetail(ocrFailed);
        setStage('confirm');
        return;
      }

      try {
        // OCR can succeed and find nothing. Silence here leaves the user
        // staring at an empty form with no idea whether it even tried.
        if (lines.length === 0) {
          setOcrProblem('unreadable');
          setOcrDetail(t('scan.readNothing'));
          setStage('confirm');
          return;
        }

        const found = parseReceiptFromLines(lines, {
          currency: entryCurrency,
          dayFirst: prefersDayFirst(),
        });
        setGuess(found);
        if (found.amountMinor != null) {
          setAmount(minorToDecimalString(found.amountMinor, entryCurrency));
        }
        if (found.merchant) setMerchant(found.merchant);
        if (found.occurredAt != null) setOccurredAt(found.occurredAt);

        // Category, best evidence first: a rule you wrote, then what the app
        // learned when you last corrected this shop, and only then the words
        // on the bill. The weakest source must never overwrite a stronger one.
        let chosen: string | null = null;
        let why: string | null = null;
        if (found.merchant) {
          const suggestion = await suggestForDraft({ merchant: found.merchant, note: '' });
          if (suggestion.categoryId) {
            chosen = suggestion.categoryId;
            why = t('scan.whyRemembered', { merchant: found.merchant });
          }
          if (suggestion.accountId) setAccountId(suggestion.accountId);
        }
        if (!chosen && found.categoryKey) {
          chosen = categoryList.find((c) => c.nameKey === found.categoryKey)?.id ?? null;
          if (chosen) {
            // Say which words did it. A category that appears out of nowhere is
            // one people stop trusting the first time it is wrong; one that
            // shows its working can be corrected with confidence instead.
            why =
              found.categoryFrom === 'shop'
                ? t('scan.whyShop', { words: found.categoryEvidence.join(', ') })
                : t('scan.whyItems', { words: found.categoryEvidence.join(', ') });
          }
        }
        setCategoryId(chosen);
        setCategoryWhy(chosen ? why : null);
        setCategoryTouched(false);
      } catch (e) {
        setOcrProblem('unreadable');
        setOcrDetail(e instanceof Error ? e.message : String(e));
      }

      setStage('confirm');
    },
    [entryCurrency, categoryList],
  );

  /* ---------------------------------------------------------------- save */

  const minor = parseAmountToMinor(amount || '0', entryCurrency) ?? 0;
  const canSave = minor > 0 && account !== null && !saving;

  const save = useCallback(async () => {
    if (!account || minor <= 0) return;
    setSaving(true);
    try {
      await addTransaction({
        amountMinor: minor,
        accountId: account.id,
        categoryId,
        currency: account.currency,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
        occurredAt,
        kind: 'expense',
        fxRate: 1,
        source: 'ocr',
        // 'user' only when a person actually tapped it — see the note on
        // learning in addTransaction. Passing 'user' for the scanner's own
        // guess is what would make a mistake permanent.
        categorySource: categoryTouched ? 'user' : categoryId ? 'ocr' : undefined,
        receiptPath: receiptName,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }, [account, minor, categoryId, categoryTouched, merchant, note, occurredAt, receiptName, router]);

  /** Backing out must not leave an orphan photo in the folder. */
  const discard = useCallback(() => {
    Alert.alert(t('scan.discardTitle'), t('scan.discardBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('scan.discard'),
        style: 'destructive',
        onPress: async () => {
          if (receiptName) await deleteReceipt(receiptName);
          router.back();
        },
      },
    ]);
  }, [receiptName, router]);

  /* --------------------------------------------------------------- views */

  if (stage === 'choose') {
    return (
      <Screen title={t('scan.title')} back>
        <Card>
          <Text style={[styles.lead, { color: theme.text }]}>{t('scan.lead')}</Text>
          <Text style={[styles.body, { color: theme.textDim }]}>{t('scan.privacy')}</Text>
          <Button label={t('scan.takePhoto')} onPress={() => start('camera')} />
          <Button
            label={t('scan.fromGallery')}
            variant="secondary"
            onPress={() => start('library')}
          />
        </Card>

        {!isOcrAvailable() ? (
          <Card>
            <Text style={[styles.body, { color: theme.warn }]}>{t('scan.needsRebuild')}</Text>
          </Card>
        ) : null}
      </Screen>
    );
  }

  if (stage === 'working') {
    return (
      <Screen title={t('scan.title')} back>
        <View style={styles.working}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.body, { color: theme.textDim }]}>{t('scan.reading')}</Text>
        </View>
      </Screen>
    );
  }

  // A labelled TOTAL is worth trusting; anything else deserves a second
  // opinion. Either way the amount field itself is always editable.
  const alternatives = (guess?.amountFrom === 'total' ? [] : (guess?.candidates ?? []))
    .filter((c) => c.minor !== minor)
    .slice(0, 3);

  const dateKey = relativeDayKey(occurredAt);
  const foundNote =
    guess?.amountFrom === 'total'
      ? t('scan.foundTotal')
      : guess?.amountFrom === 'largest'
        ? t('scan.foundGuess')
        : null;

  return (
    <Screen title={t('scan.confirmTitle')} back>
      {receiptName ? (
        <Image
          source={{ uri: receiptUri(receiptName) }}
          style={[styles.preview, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
          resizeMode="contain"
        />
      ) : null}

      {ocrProblem !== 'none' ? (
        <Card>
          <Text style={[styles.body, { color: theme.warn }]}>
            {t(ocrProblem === 'notBuilt' ? 'scan.needsRebuild' : 'scan.couldNotRead')}
          </Text>
          {ocrDetail ? (
            <Text style={[styles.hint, { color: theme.textDim }]} selectable>
              {ocrDetail}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Field
          label={t('add.amount')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        {foundNote ? (
          <Text style={[styles.hint, { color: guess?.amountFrom === 'total' ? theme.textDim : theme.warn }]}>
            {foundNote}
          </Text>
        ) : null}

        {/* Alternatives, but only when we are actually unsure.
            A row that said TOTAL is trustworthy, and offering four other
            numbers beside a figure we are confident in reads as doubt rather
            than helpfulness. When nothing announced itself, up to three. */}
        {alternatives.length > 0 ? (
          <>
            <Text style={[styles.hint, { color: theme.textDim }]}>{t('scan.otherAmounts')}</Text>
            <View style={styles.candidates}>
              {alternatives.map((c) => (
                <Chip
                  key={c.minor}
                  label={formatMinor(c.minor, entryCurrency, { compact: true })}
                  onPress={() => setAmount(minorToDecimalString(c.minor, entryCurrency))}
                />
              ))}
            </View>
          </>
        ) : null}

        <Field
          label={t('add.merchant')}
          value={merchant}
          onChangeText={setMerchant}
          placeholder={t('add.merchant')}
        />
        <Field
          label={t('add.note')}
          value={note}
          onChangeText={setNote}
          placeholder={t('add.note')}
        />

        <View style={styles.row}>
          <Pressable
            style={[styles.pickRow, { borderColor: theme.border }]}
            onPress={() => setSheet('date')}
          >
            <Text style={[styles.pickLabel, { color: theme.textDim }]}>{t('scan.dateLabel')}</Text>
            <Text style={[styles.pickValue, { color: theme.text }]}>
              {dateKey ? t(dateKey) : formatDate(occurredAt)}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.pickRow, { borderColor: theme.border }]}
            onPress={() => setSheet('account')}
          >
            <Text style={[styles.pickLabel, { color: theme.textDim }]}>{t('scan.accountLabel')}</Text>
            <Text style={[styles.pickValue, { color: theme.text }]} numberOfLines={1}>
              {account ? `${account.icon ?? ''} ${account.name}`.trim() : '—'}
            </Text>
          </Pressable>
        </View>

        {/* `09/04` is 4 September in Mumbai and 9 April in Boston. When the
            bill itself gives no clue which, say so and make the other reading
            one tap rather than silently picking. */}
        {guess?.dateAlternative != null && guess.dateAlternative !== occurredAt ? (
          <>
            <Text style={[styles.hint, { color: theme.warn }]}>{t('scan.dateAmbiguous')}</Text>
            <View style={styles.candidates}>
              <Chip
                label={t('scan.dateOr', { date: formatDate(guess.dateAlternative, 'long') })}
                onPress={() => setOccurredAt(guess.dateAlternative!)}
              />
            </View>
          </>
        ) : null}
      </Card>

      <SectionLabel>{t('add.chooseCategory')}</SectionLabel>
      {categoryWhy ? (
        <Text style={[styles.why, { color: theme.accent }]}>{categoryWhy}</Text>
      ) : null}
      <View style={styles.categories}>
        {categoryList.map((c) => (
          <Chip
            key={c.id}
            label={`${c.icon ?? ''} ${c.customName ?? t(c.nameKey ?? '')}`.trim()}
            active={categoryId === c.id}
            onPress={() => {
              // A tap is a person taking responsibility for the answer: the
              // explanation goes away, and this is now something worth learning.
              setCategoryTouched(true);
              setCategoryWhy(null);
              setCategoryId((prev) => (prev === c.id ? null : c.id));
            }}
          />
        ))}
      </View>

      {/* Showing the reading builds trust in a way no accuracy claim can:
          when it gets something wrong you can see exactly why. */}
      {guess && guess.rows.length > 0 ? (
        <Card>
          <Pressable onPress={() => setShowRead((v) => !v)} hitSlop={6}>
            <Text style={[styles.disclosure, { color: theme.accent }]}>
              {showRead ? t('scan.hideRead') : t('scan.showRead', { rows: guess.rows.length })}
            </Text>
          </Pressable>
          {showRead ? (
            <Text style={[styles.readout, { color: theme.textDim }]} selectable>
              {guess.rows.join('\n')}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Button label={t('scan.save')} onPress={save} disabled={!canSave} />
      <Button label={t('scan.discard')} variant="secondary" onPress={discard} />

      <Sheet visible={sheet === 'account'} title={t('scan.accountLabel')} onClose={() => setSheet('none')}>
        {accountList.map((a) => (
          <Chip
            key={a.id}
            label={`${a.icon ?? ''} ${a.name}`.trim()}
            active={a.id === accountId}
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
        title={t('scan.dateLabel')}
        onClose={() => setSheet('none')}
        onSelect={(next) => {
          setOccurredAt(next);
          setSheet('none');
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: type.body, fontWeight: '600' },
  body: { fontSize: type.small, lineHeight: 19 },
  hint: { fontSize: type.tiny, lineHeight: 15 },
  working: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xxl },
  preview: {
    width: '100%',
    height: 220,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  row: { flexDirection: 'row', gap: space.sm },
  pickRow: { flex: 1, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 2 },
  pickLabel: { fontSize: type.tiny, textTransform: 'uppercase', letterSpacing: 0.6 },
  pickValue: { fontSize: type.small, fontWeight: '600' },
  why: { fontSize: type.small, fontWeight: '600', lineHeight: 18 },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  candidates: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  disclosure: { fontSize: type.small, fontWeight: '600' },
  readout: { fontSize: type.tiny, lineHeight: 16, fontFamily: 'monospace' },
});
