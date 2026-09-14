/**
 * Currency converter.
 *
 * The screen is four things: an amount, two currencies, the answer, and — the
 * part most converters leave out — **how old the number is**. A rate shown to
 * four decimal places reads as a live market quote whether or not it is one,
 * and the free rates this app can get are published once a day. Saying so is
 * the difference between a useful tool and a confident lie.
 *
 * It opens instantly from the cache and refreshes behind that, so the common
 * case — somebody standing in a shop abroad — never waits on a spinner, and
 * the uncommon case, a plane with no signal, still shows yesterday's rate with
 * a label rather than an error.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { getBaseCurrency } from '@/db/queries';
import { currencyName, isoSymbol } from '@/domain/currencies';
import {
  convert,
  formatRate,
  freshnessOf,
  parseAmount,
  rateFor,
  type Freshness,
  type RateTable,
} from '@/domain/fx';
import { formatDate, t } from '@/i18n';
import { getRates } from '@/services/rates';
import { deviceCurrency } from '@/services/region';
import { radius, space, type, useTheme } from '@/theme';
import { Button, Card, Field, Screen, SectionLabel } from '@/ui';
import { CurrencySelect } from '@/ui/CurrencySelect';

/** Offered as one tap under the result. Travel pairs, not a ranking. */
const QUICK = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'SGD'];

export default function ConvertScreen() {
  const theme = useTheme();

  const [amount, setAmount] = useState('100');
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState(() => deviceCurrency());
  const [table, setTable] = useState<RateTable | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force: boolean) => {
    setBusy(true);
    try {
      const result = await getRates(force);
      setTable(result.table);
      setError(result.error);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // Their own currency is the one they are converting *into* nine times out
      // of ten — "what is this in real money" — so it starts on the right.
      setTo(await getBaseCurrency());
      await refresh(false);
    })();
  }, [refresh]);

  const value = parseAmount(amount);
  const rate = table ? rateFor(from, to, table) : null;
  const result = table && value !== null ? convert(value, from, to, table) : null;

  const freshness: Freshness | null = table ? freshnessOf(table.at) : null;
  const freshColour =
    freshness === 'old' ? theme.warn : freshness === 'stale' ? theme.textDim : theme.income;

  const swap = useCallback(() => {
    setFrom(to);
    setTo(from);
  }, [from, to]);

  const formatted = useMemo(() => {
    if (result === null) return '—';
    try {
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(result);
    } catch {
      return result.toFixed(2);
    }
  }, [result]);

  return (
    <Screen title={t('convert.title')}>
      <Card gap={space.md}>
        <Field
          label={t('convert.amount')}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="100"
        />

        <SectionLabel>{t('convert.from')}</SectionLabel>
        <CurrencySelect value={from} onChange={setFrom} prefer={QUICK} />

        {/* Between the two pickers, where it is obvious what it swaps. */}
        <Pressable
          onPress={swap}
          style={({ pressed }) => [
            styles.swap,
            {
              borderColor: theme.borderStrong,
              backgroundColor: pressed ? theme.accentSoft : theme.surfaceAlt,
            },
          ]}
        >
          <Text style={{ color: theme.accent, fontSize: type.body, fontWeight: '700' }}>
            ⇅ {t('convert.swap')}
          </Text>
        </Pressable>

        <SectionLabel>{t('convert.to')}</SectionLabel>
        <CurrencySelect value={to} onChange={setTo} prefer={QUICK} />
      </Card>

      {/* ------------------------------------------------------------ answer */}
      <Card gap={space.sm}>
        <Text style={[styles.resultLabel, { color: theme.textDim }]}>
          {t('convert.result', { amount: amount || '0', from })}
        </Text>
        <Text style={[styles.result, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>
          {isoSymbol(to)} {formatted}
        </Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>{currencyName(to)}</Text>

        {rate !== null ? (
          <Text style={[styles.rate, { color: theme.text }]}>
            1 {from} = {formatRate(rate)} {to}
          </Text>
        ) : table ? (
          <Text style={[styles.hint, { color: theme.warn }]}>{t('convert.noPair')}</Text>
        ) : null}
      </Card>

      {/* ------------------------------------------------------- provenance */}
      <Card gap={space.xs}>
        <SectionLabel>{t('convert.rates')}</SectionLabel>

        {busy && !table ? (
          <ActivityIndicator color={theme.accent} />
        ) : table ? (
          <>
            <Text style={[styles.hint, { color: freshColour }]}>
              {t(`convert.fresh.${freshness}`, { date: formatDate(table.at, 'long') })}
            </Text>
            <Text style={[styles.hint, { color: theme.textDim }]}>{t('convert.daily')}</Text>
          </>
        ) : (
          <Text style={[styles.hint, { color: theme.warn }]}>{t('convert.noRates')}</Text>
        )}

        {error ? (
          <Text style={[styles.hint, { color: theme.textDim }]}>
            {t('convert.offline')}
          </Text>
        ) : null}

        <Button
          label={busy ? t('convert.updating') : t('convert.update')}
          variant="secondary"
          onPress={() => void refresh(true)}
          disabled={busy}
        />
        <Text style={[styles.caveat, { color: theme.textDim }]}>{t('convert.privacy')}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  swap: {
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  resultLabel: { fontSize: type.small },
  result: { fontSize: type.display - 4, fontWeight: '700' },
  rate: { fontSize: type.body, fontWeight: '600' },
  hint: { fontSize: type.small, lineHeight: 19 },
  caveat: { fontSize: type.tiny, lineHeight: 16 },
});
