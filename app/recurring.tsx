import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import {
  createRecurring,
  deleteRecurring,
  listAccounts,
  listCategories,
  listRecurring,
  updateRecurring,
  type RecurringTemplate,
} from '@/db/queries';
import type { Account, Category, Recurring } from '@/db/schema';
import { relativeDayKey } from '@/domain/dates';
import { formatMinor, minorToDecimalString, parseAmountToMinor } from '@/domain/money';
import { PRESETS, describeRecurrence, parseRRule } from '@/domain/recurrence';
import { formatDate, t } from '@/i18n';
import { space, type, useTheme } from '@/theme';
import { Button, Chip, EmptyState, Field, ListRow, RowGroup, Screen, SectionLabel, Sheet } from '@/ui';
import { DatePickerSheet } from '@/ui/DatePickerSheet';

/**
 * Rent, EMI, the phone bill.
 *
 * These happen whether you record them or not, so the app records them for
 * you. Auto-post writes straight to the ledger; leave it off and each one
 * waits in the inbox for a tap, which is the right default for anything whose
 * amount can change.
 */
export default function RecurringScreen() {
  const theme = useTheme();

  const [list, setList] = useState<Recurring[]>([]);
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  const [dateSheet, setDateSheet] = useState(false);

  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [rrule, setRrule] = useState('FREQ=MONTHLY');
  const [nextDueOn, setNextDueOn] = useState(() => Date.now());
  const [autoPost, setAutoPost] = useState(false);

  const load = useCallback(async () => {
    const accounts = await listAccounts();
    setAccountList(accounts);
    setCategoryList(await listCategories('expense'));
    setList(await listRecurring());
    setAccountId((prev) => prev ?? accounts[0]?.id ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openNew = useCallback(() => {
    setAmount('');
    setMerchant('');
    setCategoryId(null);
    setRrule('FREQ=MONTHLY');
    setNextDueOn(Date.now());
    setAutoPost(false);
    setEditing('new');
  }, []);

  const openEdit = useCallback((row: Recurring) => {
    try {
      const tpl = JSON.parse(row.templateJson) as RecurringTemplate;
      setAmount(minorToDecimalString(Math.abs(tpl.amountMinor), tpl.currency));
      setMerchant(tpl.merchant ?? '');
      setAccountId(tpl.accountId);
      setCategoryId(tpl.categoryId);
    } catch {
      setAmount('');
    }
    setRrule(row.rrule);
    setNextDueOn(row.nextDueOn);
    setAutoPost(row.autoPost === 1);
    setEditing(row);
  }, []);

  const save = useCallback(async () => {
    const account = accountList.find((a) => a.id === accountId) ?? accountList[0];
    if (!account) return;
    const minor = parseAmountToMinor(amount, account.currency);
    if (minor == null || minor <= 0) return;

    const template: RecurringTemplate = {
      amountMinor: minor,
      accountId: account.id,
      categoryId,
      merchant: merchant.trim() || null,
      note: null,
      kind: 'expense',
      currency: account.currency,
    };

    if (editing === 'new') {
      await createRecurring({ template, rrule, nextDueOn, autoPost });
    } else if (editing) {
      await updateRecurring(editing.id, {
        templateJson: JSON.stringify(template),
        rrule,
        nextDueOn,
        autoPost: autoPost ? 1 : 0,
      });
    }
    setEditing(null);
    await load();
  }, [accountList, accountId, amount, categoryId, merchant, rrule, nextDueOn, autoPost, editing, load]);

  const remove = useCallback(async () => {
    if (!editing || editing === 'new') return;
    await deleteRecurring(editing.id);
    setEditing(null);
    await load();
  }, [editing, load]);

  const describe = (row: Recurring) => {
    const parsed = parseRRule(row.rrule);
    if (!parsed) return row.rrule;
    const d = describeRecurrence(parsed);
    return t(d.key, d.params);
  };

  const summarise = (row: Recurring) => {
    try {
      const tpl = JSON.parse(row.templateJson) as RecurringTemplate;
      return {
        title: tpl.merchant || describe(row),
        amount: formatMinor(-Math.abs(tpl.amountMinor), tpl.currency, { compact: true }),
      };
    } catch {
      return { title: describe(row), amount: '' };
    }
  };

  const valid = amount.trim() !== '' && accountList.length > 0;

  return (
    <Screen
      title={t('more.recurring')}
      back
      right={<Chip label={t('recurring.add')} onPress={openNew} active />}
    >
      <Text style={[styles.lead, { color: theme.textDim }]}>{t('recurring.lead')}</Text>

      {list.length === 0 ? (
        <EmptyState text={t('recurring.empty')} />
      ) : (
        <RowGroup>
          {list.map((row, i) => {
            const s = summarise(row);
            const dueKey = relativeDayKey(row.nextDueOn);
            return (
              <ListRow
                key={row.id}
                icon={row.isEnabled ? '🔁' : '💤'}
                title={s.title}
                subtitle={`${describe(row)}  ·  ${t('recurring.next')} ${
                  dueKey ? t(dueKey) : formatDate(row.nextDueOn)
                }${row.autoPost ? '' : `  ·  ${t('recurring.toInbox')}`}`}
                value={s.amount}
                onPress={() => openEdit(row)}
                last={i === list.length - 1}
              />
            );
          })}
        </RowGroup>
      )}

      <Sheet
        visible={editing !== null}
        title={editing === 'new' ? t('recurring.add') : t('recurring.edit')}
        onClose={() => setEditing(null)}
      >
        <Field
          label={t('add.amount')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
        />
        <Field
          label={t('add.merchant')}
          value={merchant}
          onChangeText={setMerchant}
          placeholder={t('recurring.merchantHint')}
          autoCapitalize="words"
        />

        <SectionLabel>{t('recurring.howOften')}</SectionLabel>
        <View style={styles.chips}>
          {PRESETS.map((p) => (
            <Chip key={p.rrule} label={t(p.key)} active={rrule === p.rrule} onPress={() => setRrule(p.rrule)} />
          ))}
        </View>

        <SectionLabel>{t('recurring.nextDue')}</SectionLabel>
        <Chip
          label={relativeDayKey(nextDueOn) ? t(relativeDayKey(nextDueOn)!) : formatDate(nextDueOn, 'long')}
          active
          onPress={() => setDateSheet(true)}
        />

        <SectionLabel>{t('add.category')}</SectionLabel>
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

        <SectionLabel>{t('more.accounts')}</SectionLabel>
        <View style={styles.chips}>
          {accountList.map((a) => (
            <Chip
              key={a.id}
              label={`${a.icon ?? ''} ${a.name}`.trim()}
              active={accountId === a.id}
              onPress={() => setAccountId(a.id)}
            />
          ))}
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={{ color: theme.text, fontSize: type.body }}>{t('recurring.autoPost')}</Text>
            <Text style={{ color: theme.textDim, fontSize: type.small }}>
              {t('recurring.autoPostHint')}
            </Text>
          </View>
          <Switch value={autoPost} onValueChange={setAutoPost} />
        </View>

        <View style={styles.actions}>
          <Button label={t('common.done')} onPress={save} disabled={!valid} />
          {editing !== 'new' && editing ? (
            <Button label={t('common.delete')} variant="secondary" onPress={remove} />
          ) : null}
        </View>
      </Sheet>

      <DatePickerSheet
        visible={dateSheet}
        value={nextDueOn}
        title={t('recurring.nextDue')}
        onClose={() => setDateSheet(false)}
        onSelect={setNextDueOn}
        allowFuture
      />
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
    gap: space.md,
    paddingTop: space.sm,
  },
  switchText: { flex: 1, gap: 2 },
  actions: { gap: space.sm, paddingTop: space.md },
});
