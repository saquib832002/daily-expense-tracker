import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  accountBalances,
  accountTransactionCount,
  alignBaseCurrencyToAccounts,
  createAccount,
  getBaseCurrency,
  listAccounts,
  updateAccount,
} from '@/db/queries';
import type { Account } from '@/db/schema';
import { CURRENCIES, formatMinor, minorToDecimalString, parseAmountToMinor } from '@/domain/money';
import { t } from '@/i18n';
import { space, type, useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, Field, ListRow, RowGroup, Screen, SectionLabel, Sheet } from '@/ui';

const TYPES = ['cash', 'bank', 'card', 'upi', 'wallet'] as const;
const TYPE_ICONS: Record<string, string> = {
  cash: '💵',
  bank: '🏦',
  card: '💳',
  upi: '📲',
  wallet: '👛',
};

/**
 * Accounts — where the money actually sits.
 *
 * Each one carries its own currency, which is what makes multi-currency work
 * without a mode switch: a rupee wallet and a dollar card simply coexist, and
 * reports roll everything up into the base currency.
 */
export default function AccountsScreen() {
  const theme = useTheme();
  const [list, setList] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [baseCurrency, setBaseCurrency] = useState('INR');
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  // Draft state for the sheet.
  const [name, setName] = useState('');
  const [accType, setAccType] = useState<string>('cash');
  const [currency, setCurrency] = useState('INR');
  /** Transactions in the account being edited. Zero means currency is unlocked. */
  const [entryCount, setEntryCount] = useState(0);
  const [opening, setOpening] = useState('');

  const load = useCallback(async () => {
    const base = await getBaseCurrency();
    setBaseCurrency(base);
    setList(await listAccounts(true));
    setBalances(await accountBalances());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openNew = useCallback(() => {
    setName('');
    setAccType('cash');
    setCurrency(baseCurrency);
    setOpening('');
    setEntryCount(0);
    setEditing('new');
  }, [baseCurrency]);

  const openEdit = useCallback(async (a: Account) => {
    setName(a.name);
    setAccType(a.type);
    setCurrency(a.currency);
    setOpening(minorToDecimalString(a.openingBalanceMinor, a.currency));
    // An empty account can still change its currency. This is the case that
    // matters: the app guesses your currency from the phone's region on first
    // launch, and if it guessed wrong you want to fix it immediately — before
    // there is any money in the account to reinterpret.
    setEntryCount(await accountTransactionCount(a.id));
    setEditing(a);
  }, []);

  const save = useCallback(async () => {
    if (!name.trim()) return;
    const openingMinor = parseAmountToMinor(opening || '0', currency) ?? 0;

    if (editing === 'new') {
      await createAccount({
        name,
        type: accType,
        currency,
        openingBalanceMinor: openingMinor,
        icon: TYPE_ICONS[accType],
      });
    } else if (editing) {
      // Currency travels with the patch only while the account is empty;
      // updateAccount refuses it otherwise, so this cannot silently reinterpret
      // amounts already recorded.
      await updateAccount(editing.id, {
        name: name.trim(),
        type: accType,
        icon: TYPE_ICONS[accType],
        openingBalanceMinor: openingMinor,
        ...(entryCount === 0 ? { currency } : {}),
      });
    }
    // With the currency picker gone from Settings, this screen is now the only
    // place a currency is chosen — so the reporting currency has to follow it.
    // Only ever while the ledger is empty; see alignBaseCurrencyToAccounts.
    await alignBaseCurrencyToAccounts();
    setEditing(null);
    await load();
  }, [editing, name, accType, currency, opening, entryCount, load]);

  const toggleArchive = useCallback(
    async (a: Account) => {
      await updateAccount(a.id, { isArchived: a.isArchived ? 0 : 1 });
      await load();
    },
    [load],
  );

  const active = list.filter((a) => !a.isArchived);
  const archived = list.filter((a) => a.isArchived);

  return (
    <Screen
      title={t('more.accounts')}
      back
      right={<Chip label={t('accounts.add')} onPress={openNew} active />}
    >
      {active.length === 0 ? (
        <EmptyState text={t('accounts.empty')} />
      ) : (
        <RowGroup>
          {active.map((a, i) => (
            <ListRow
              key={a.id}
              icon={a.icon ?? TYPE_ICONS[a.type]}
              title={a.name}
              subtitle={`${t(`account.${a.type}`)} · ${a.currency}`}
              value={formatMinor(balances[a.id] ?? 0, a.currency, { compact: true })}
              valueColor={(balances[a.id] ?? 0) < 0 ? theme.danger : theme.text}
              onPress={() => openEdit(a)}
              last={i === active.length - 1}
            />
          ))}
        </RowGroup>
      )}

      {archived.length > 0 ? (
        <View style={styles.section}>
          <SectionLabel>{t('accounts.archived')}</SectionLabel>
          <RowGroup>
            {archived.map((a, i) => (
              <ListRow
                key={a.id}
                icon={a.icon ?? TYPE_ICONS[a.type]}
                title={a.name}
                subtitle={`${t(`account.${a.type}`)} · ${a.currency}`}
                onPress={() => toggleArchive(a)}
                value={t('accounts.restore')}
                valueColor={theme.accent}
                last={i === archived.length - 1}
              />
            ))}
          </RowGroup>
        </View>
      ) : null}

      <Sheet
        visible={editing !== null}
        title={editing === 'new' ? t('accounts.add') : t('accounts.edit')}
        onClose={() => setEditing(null)}
      >
        <Field label={t('accounts.name')} value={name} onChangeText={setName} autoCapitalize="words" />

        <SectionLabel>{t('accounts.type')}</SectionLabel>
        <View style={styles.chips}>
          {TYPES.map((ty) => (
            <Chip
              key={ty}
              label={`${TYPE_ICONS[ty]} ${t(`account.${ty}`)}`}
              active={accType === ty}
              onPress={() => setAccType(ty)}
            />
          ))}
        </View>

        <SectionLabel>{t('accounts.currency')}</SectionLabel>
        {editing === 'new' || entryCount === 0 ? (
          <View style={styles.chips}>
            {Object.keys(CURRENCIES).map((code) => (
              <Chip key={code} label={code} active={currency === code} onPress={() => setCurrency(code)} />
            ))}
          </View>
        ) : (
          <Card gap={space.xs}>
            <Text style={{ color: theme.text, fontSize: type.body }}>{currency}</Text>
            <Text style={{ color: theme.textDim, fontSize: type.small }}>
              {t('accounts.currencyLocked')}
            </Text>
          </Card>
        )}

        <Field
          label={t('accounts.opening')}
          value={opening}
          onChangeText={setOpening}
          keyboardType="decimal-pad"
          placeholder="0"
        />

        <View style={styles.actions}>
          <Button label={t('common.done')} onPress={save} disabled={!name.trim()} />
          {editing !== 'new' && editing ? (
            <Button
              label={editing.isArchived ? t('accounts.restore') : t('accounts.archive')}
              variant="secondary"
              onPress={async () => {
                await toggleArchive(editing);
                setEditing(null);
              }}
            />
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  actions: { gap: space.sm, paddingTop: space.md },
});
