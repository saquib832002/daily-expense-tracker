import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';

import {
  getTransaction,
  listAccounts,
  listCategories,
  softDeleteTransaction,
  updateTransaction,
} from '@/db/queries';
import type { Account, Category, Transaction } from '@/db/schema';
import { relativeDayKey } from '@/domain/dates';
import { formatMinor, minorToDecimalString, parseAmountToMinor } from '@/domain/money';
import { formatDate, t } from '@/i18n';
import { deleteReceipt, pickReceipt, receiptUri, saveReceipt } from '@/services/receipts';
import { space, type, useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Field, Screen, SectionLabel, Sheet } from '@/ui';
import { DatePickerSheet } from '@/ui/DatePickerSheet';

/** Edit or delete one transaction. Reached by tapping any row in the app. */
export default function TransactionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [tx, setTx] = useState<Transaction | null>(null);
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [sheet, setSheet] = useState<'none' | 'category' | 'account' | 'date'>('none');

  // Editable copies.
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>('');
  const [occurredAt, setOccurredAt] = useState(Date.now());
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [busyReceipt, setBusyReceipt] = useState(false);

  useEffect(() => {
    (async () => {
      if (!id) return;
      const row = await getTransaction(id);
      if (!row) return;
      setTx(row);
      setAmount(minorToDecimalString(Math.abs(row.amountMinor), row.currency));
      setMerchant(row.merchant ?? '');
      setNote(row.note ?? '');
      setCategoryId(row.categoryId);
      setAccountId(row.accountId);
      setOccurredAt(row.occurredAt);
      setReceiptPath(row.receiptPath);

      setAccountList(await listAccounts(true));
      setCategoryList(await listCategories(row.kind === 'income' ? 'income' : 'expense'));
    })();
  }, [id]);

  const save = useCallback(async () => {
    if (!tx) return;
    const account = accountList.find((a) => a.id === accountId);
    const currency = account?.currency ?? tx.currency;
    const minor = parseAmountToMinor(amount, currency);
    if (minor == null || minor <= 0) return;

    await updateTransaction(tx.id, {
      amountMinor: minor,
      accountId,
      categoryId,
      merchant,
      note,
      occurredAt,
      currency,
      receiptPath,
    });
    router.back();
  }, [tx, accountList, accountId, amount, categoryId, merchant, note, occurredAt, receiptPath, router]);

  /**
   * Attach a photo, or swap the one that is there.
   * The old file is deleted only after the new one is safely written, so a
   * failure halfway through loses nothing.
   */
  const attach = useCallback(
    async (source: 'camera' | 'library') => {
      setBusyReceipt(true);
      try {
        const picked = await pickReceipt(source);
        if (!picked) return;
        const name = await saveReceipt(picked);
        const previous = receiptPath;
        setReceiptPath(name);
        if (tx) await updateTransaction(tx.id, { receiptPath: name });
        if (previous) await deleteReceipt(previous);
      } catch (e) {
        const code = e instanceof Error ? e.message : '';
        const key =
          code === 'permissionDenied'
            ? 'scan.noPermission'
            : code === 'nativeMissing'
              ? 'scan.needsRebuild'
              : 'scan.saveFailed';
        Alert.alert(t('txn.receipt'), t(key));
      } finally {
        setBusyReceipt(false);
      }
    },
    [tx, receiptPath],
  );

  const detach = useCallback(() => {
    if (!receiptPath || !tx) return;
    Alert.alert(t('txn.removeReceiptTitle'), t('txn.removeReceiptBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const name = receiptPath;
          setReceiptPath(null);
          await updateTransaction(tx.id, { receiptPath: null });
          await deleteReceipt(name);
        },
      },
    ]);
  }, [tx, receiptPath]);

  const remove = useCallback(() => {
    if (!tx) return;
    Alert.alert(t('txn.deleteTitle'), t('txn.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await softDeleteTransaction(tx.id);
          router.back();
        },
      },
    ]);
  }, [tx, router]);

  if (!tx) {
    return (
      <Screen title={t('txn.title')} back>
        <EmptyState text={t('common.loading')} />
      </Screen>
    );
  }

  const category = categoryList.find((c) => c.id === categoryId) ?? null;
  const account = accountList.find((a) => a.id === accountId) ?? null;
  const dateKey = relativeDayKey(occurredAt);

  return (
    <Screen title={t('txn.title')} back>
      <Card>
        <Text
          style={[
            styles.amount,
            { color: tx.kind === 'income' ? theme.income : theme.text },
          ]}
        >
          {formatMinor(tx.amountMinor, tx.currency, { signed: true })}
        </Text>
        <Text style={[styles.meta, { color: theme.textDim }]}>
          {t(tx.kind === 'income' ? 'add.income' : 'add.expense')}
          {tx.source !== 'manual' ? ` · ${tx.source}` : ''}
        </Text>
      </Card>

      <Card>
        <Field
          label={t('add.amount')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
        />
        <Field
          label={t('add.merchant')}
          value={merchant}
          onChangeText={setMerchant}
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
      </Card>

      <Card>
        <SectionLabel>{t('txn.receipt')}</SectionLabel>
        {receiptPath ? (
          <>
            <Image
              source={{ uri: receiptUri(receiptPath) }}
              style={[
                styles.receipt,
                { borderColor: theme.border, backgroundColor: theme.surfaceAlt },
              ]}
              resizeMode="contain"
            />
            <Button
              label={t('txn.replaceReceipt')}
              variant="secondary"
              disabled={busyReceipt}
              onPress={() => attach('camera')}
            />
            <Button label={t('txn.removeReceipt')} variant="secondary" onPress={detach} />
          </>
        ) : (
          <>
            <Text style={[styles.meta, { color: theme.textDim }]}>{t('txn.noReceipt')}</Text>
            <Button
              label={t('scan.takePhoto')}
              variant="secondary"
              disabled={busyReceipt}
              onPress={() => attach('camera')}
            />
            <Button
              label={t('scan.fromGallery')}
              variant="secondary"
              disabled={busyReceipt}
              onPress={() => attach('library')}
            />
          </>
        )}
      </Card>

      <View style={styles.pickers}>
        <SectionLabel>{t('add.category')}</SectionLabel>
        <Chip
          label={
            category ? `${category.icon ?? ''} ${category.customName ?? t(category.nameKey ?? '')}`.trim() : t('add.chooseCategory')
          }
          active={!!category}
          onPress={() => setSheet('category')}
        />

        <SectionLabel>{t('more.accounts')}</SectionLabel>
        <Chip
          label={account ? `${account.icon ?? ''} ${account.name}`.trim() : '—'}
          active
          onPress={() => setSheet('account')}
        />

        <SectionLabel>{t('add.when')}</SectionLabel>
        <Chip
          label={dateKey ? t(dateKey) : formatDate(occurredAt, 'long')}
          active
          onPress={() => setSheet('date')}
        />
      </View>

      <View style={styles.actions}>
        <Button label={t('common.done')} onPress={save} />
        <Button label={t('common.delete')} variant="danger" onPress={remove} />
      </View>

      <Sheet visible={sheet === 'category'} title={t('add.chooseCategory')} onClose={() => setSheet('none')}>
        {categoryList.map((c) => (
          <Chip
            key={c.id}
            label={`${c.icon ?? ''} ${c.customName ?? t(c.nameKey ?? '')}`.trim()}
            active={c.id === categoryId}
            onPress={() => {
              setCategoryId(c.id);
              setSheet('none');
            }}
          />
        ))}
      </Sheet>

      <Sheet visible={sheet === 'account'} title={t('more.accounts')} onClose={() => setSheet('none')}>
        {accountList.map((a) => (
          <Chip
            key={a.id}
            label={`${a.icon ?? ''} ${a.name} · ${a.currency}`.trim()}
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
        title={t('add.when')}
        onClose={() => setSheet('none')}
        onSelect={setOccurredAt}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  meta: { fontSize: type.small },
  pickers: { gap: space.sm },
  receipt: { width: '100%', height: 220, borderWidth: 1, borderRadius: 10 },
  actions: { gap: space.sm },
});
