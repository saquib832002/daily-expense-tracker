/**
 * Pick a currency from every currency there is.
 *
 * A dropdown, in the sense the phrase means on a phone: a closed field showing
 * the current answer, which opens a full list you can search. There is no
 * platform `<select>` in React Native, and the one library that provides a
 * native wheel would be another native module to build for a control used on
 * one screen — so this is a Modal and a FlatList, and it has the advantage of
 * looking the same on every device.
 *
 * Two things the flat alphabetical list would get wrong, so it is not flat:
 *
 *   - The answer is almost always one of about a dozen currencies, and making
 *     someone scroll past AFN and ALL to reach INR is a poor way to treat a
 *     near-certainty. Familiar ones are grouped at the top.
 *   - The list is long enough that scrolling is not a serious way to find
 *     anything. The search box is focused the moment it opens and matches the
 *     code and the name, so "rup", "INR" and "Indian" all land on the rupee.
 *
 * `FlatList` rather than the shared `Sheet`'s ScrollView on purpose: a ScrollView
 * mounts all hundred and eighty rows at once, and the drop in frame rate is
 * visible on the cheap phones this app is meant to run well on.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { currencyName, isoSymbol } from '@/domain/currencies';
import { t } from '@/i18n';
import { allCurrencyCodes } from '@/services/region';
import { radius, space, type, useTheme } from '@/theme';

/**
 * Offered at the top before anyone types. Not a ranking of importance — a
 * guess at this app's first users, with the device's own currency inserted
 * ahead of all of them.
 */
const COMMON = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'PKR', 'BDT', 'SGD', 'AUD', 'CAD'];

/** A row in the list: either a heading or a currency. */
type Row = { kind: 'header'; title: string } | { kind: 'code'; code: string };

export function CurrencySelect({
  value,
  onChange,
  /** Put these at the top of the unsearched list, ahead of the common ones. */
  prefer = [],
  label,
}: {
  value: string;
  onChange: (code: string) => void;
  prefer?: string[];
  label?: string;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Joined, because `prefer` is written inline at the call site and a fresh
  // array every render would rebuild two hundred rows every render with it.
  const preferKey = prefer.join(',');

  const allCodes = useMemo(() => allCurrencyCodes(), []);

  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toUpperCase();

    if (q) {
      const hits = allCodes.filter(
        (c) => c.includes(q) || currencyName(c).toUpperCase().includes(q),
      );
      return hits.map((code) => ({ kind: 'code', code }) as const);
    }

    const top = [...new Set([...prefer, value, ...COMMON])].filter((c) => c && c.length === 3);
    const rest = allCodes.filter((c) => !top.includes(c));
    return [
      { kind: 'header', title: t('currency.common') },
      ...top.map((code) => ({ kind: 'code', code }) as const),
      { kind: 'header', title: t('currency.all') },
      ...rest.map((code) => ({ kind: 'code', code }) as const),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, allCodes, preferKey, value]);

  const choose = useCallback(
    (code: string) => {
      onChange(code);
      setOpen(false);
      setSearch('');
    },
    [onChange],
  );

  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<Row>) => {
      if (item.kind === 'header') {
        return (
          <Text style={[styles.groupLabel, { color: theme.textDim, backgroundColor: theme.bg }]}>
            {item.title}
          </Text>
        );
      }

      const selected = item.code === value;
      // On a build whose ICU has no currency display names, `currencyName`
      // answers with the code itself. Printing it twice under itself looks
      // like a rendering fault; one line is simply a picker without names.
      const name = currencyName(item.code);
      return (
        <Pressable
          onPress={() => choose(item.code)}
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: theme.border,
              backgroundColor: pressed || selected ? theme.accentSoft : 'transparent',
            },
          ]}
        >
          <Text style={[styles.rowSymbol, { color: theme.text }]} numberOfLines={1}>
            {isoSymbol(item.code)}
          </Text>
          <View style={styles.rowText}>
            <Text style={[styles.rowCode, { color: selected ? theme.accent : theme.text }]}>
              {item.code}
            </Text>
            {name !== item.code ? (
              <Text style={[styles.rowName, { color: theme.textDim }]} numberOfLines={1}>
                {name}
              </Text>
            ) : null}
          </View>
          {/* A tick rather than a radio: the list is closed the moment you
              choose, so this is a record of what was chosen last time, not a
              control waiting to be confirmed. */}
          {selected ? <Text style={{ color: theme.accent, fontSize: type.body }}>✓</Text> : null}
        </Pressable>
      );
    },
    [choose, theme, value],
  );

  return (
    <View style={{ gap: space.xs }}>
      {label ? <Text style={[styles.label, { color: theme.textDim }]}>{label}</Text> : null}

      {/* The closed field. Looks like a select, and says what it will do. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('currency.title')}: ${value} ${currencyName(value)}`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: theme.borderStrong,
            backgroundColor: pressed ? theme.accentSoft : theme.surfaceAlt,
          },
        ]}
      >
        <Text style={[styles.fieldSymbol, { color: theme.text }]}>{isoSymbol(value)}</Text>
        <Text style={[styles.fieldText, { color: theme.text }]} numberOfLines={1}>
          {currencyName(value) === value ? value : `${value} · ${currencyName(value)}`}
        </Text>
        <Text style={[styles.caret, { color: theme.textDim }]}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        // Full screen rather than a half-height sheet: with a keyboard open,
        // a sheet leaves room for about three results.
        presentationStyle="fullScreen"
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
          <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{t('currency.title')}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <Text style={{ color: theme.accent, fontSize: type.body }}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={t('currency.search')}
              placeholderTextColor={theme.textDim}
              autoCorrect={false}
              autoFocus
              style={[
                styles.search,
                { color: theme.text, borderColor: theme.borderStrong, backgroundColor: theme.surface },
              ]}
            />
          </View>

          <FlatList
            data={rows}
            keyExtractor={(item, i) => (item.kind === 'header' ? `h${i}` : item.code)}
            renderItem={renderRow}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: theme.textDim }]}>
                {t('currency.noMatch', { query: search.trim() })}
              </Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: type.tiny, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    // Comfortably over the 44pt minimum touch target at every font scale.
    paddingVertical: space.md,
    minHeight: 48,
  },
  fieldSymbol: { fontSize: type.body, fontWeight: '700', minWidth: 24 },
  fieldText: { flex: 1, fontSize: type.body, fontWeight: '600' },
  caret: { fontSize: type.body },

  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: type.title, fontWeight: '600' },
  searchWrap: { padding: space.lg, paddingBottom: space.md },
  search: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: type.body,
    minHeight: 48,
  },
  groupLabel: {
    fontSize: type.tiny,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  // Wide enough for the three-letter 'symbols' ICU returns when a currency
  // has none of its own (ALL, CHF), so the codes below stay in one column.
  rowSymbol: { fontSize: type.body, fontWeight: '700', width: 44 },
  rowText: { flex: 1 },
  rowCode: { fontSize: type.body, fontWeight: '600' },
  rowName: { fontSize: type.small },
  empty: { padding: space.lg, fontSize: type.small, textAlign: 'center' },
});
