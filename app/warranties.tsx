/**
 * Warranties — everything you own that someone else is still liable for.
 *
 * The design question here is not "how do I store a date". It is *why do
 * warranties get lost*, and the answer is always the same: the paperwork goes
 * in a drawer, the drawer gets tidied, and by the time the television dies
 * nobody can prove when it was bought. So this screen is built around the three
 * things that actually rescue a claim:
 *
 *   1. **The dates, sorted by urgency.** Expiring soon is a section of its own,
 *      at the top, in amber, with a countdown. Everything else is a countdown
 *      too. An alphabetical list of possessions would be useless.
 *   2. **Photos of the proof.** The receipt, the warranty card, the serial
 *      plate on the back. They live in the same device-only folder as bill
 *      photos — never uploaded anywhere, and excluded from cloud backup.
 *   3. **The serial number, searchable.** Because the realistic moment of use
 *      is standing at a service counter being asked for it.
 *
 * Two things this deliberately does not do. It does not require the purchase to
 * exist as an expense — most people's first ten entries here are for things
 * they bought before they installed this app, and a feature that demands a
 * matching transaction would never be used. And it does not delete expired
 * warranties: an expired warranty is still the record of what you paid and when,
 * which is exactly what you need when arguing that a two-year-old fridge should
 * not have died.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  createWarranty,
  deleteWarranty,
  getBaseCurrency,
  listWarranties,
  updateWarranty,
  warrantyPhotos,
} from '@/db/queries';
import type { Warranty } from '@/db/schema';
import { formatMinor, minorToDecimalString, parseAmountToMinor } from '@/domain/money';
import {
  MONTH_PRESETS,
  coverUsed,
  daysLeft,
  expiryOf,
  groupByStatus,
  matches,
  statusOf,
  type WarrantyStatus,
} from '@/domain/warranty';
import { formatDate, t } from '@/i18n';
import { pickReceipt, receiptUri, saveReceipt } from '@/services/receipts';
import { radius, space, type, useTheme } from '@/theme';
import { Button, Chip, EmptyState, Field, Screen, SectionLabel, Sheet } from '@/ui';
import { DatePickerSheet } from '@/ui/DatePickerSheet';

export default function WarrantiesScreen() {
  const theme = useTheme();

  const [list, setList] = useState<Warranty[]>([]);
  const [currency, setCurrency] = useState('INR');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Warranty | 'new' | null>(null);
  const [dateSheet, setDateSheet] = useState(false);

  // Form state. Flat rather than an object because every field is edited
  // independently and a partial object would need a reducer to stay honest.
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [retailer, setRetailer] = useState('');
  const [serial, setSerial] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [purchasedOn, setPurchasedOn] = useState(() => Date.now());
  const [months, setMonths] = useState(12);
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setList(await listWarranties());
    setCurrency(await getBaseCurrency());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const now = Date.now();
  const groups = useMemo(
    () => groupByStatus(list.filter((w) => matches(w, query)), now),
    // `now` deliberately left out: re-grouping on every tick would re-sort the
    // list under the user's finger for no visible gain. A screen that has been
    // open across midnight is refreshed by the focus effect anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, query],
  );

  const openNew = useCallback(() => {
    setProductName('');
    setBrand('');
    setRetailer('');
    setSerial('');
    setPrice('');
    setNotes('');
    setPurchasedOn(Date.now());
    setMonths(12);
    setPhotos([]);
    setEditing('new');
  }, []);

  const openEdit = useCallback((w: Warranty) => {
    setProductName(w.productName);
    setBrand(w.brand ?? '');
    setRetailer(w.retailer ?? '');
    setSerial(w.serial ?? '');
    setPrice(w.priceMinor != null ? minorToDecimalString(w.priceMinor, w.currency ?? 'INR') : '');
    setNotes(w.notes ?? '');
    setPurchasedOn(w.purchasedOn);
    setMonths(w.months);
    setPhotos(warrantyPhotos(w));
    setEditing(w);
  }, []);

  const addPhoto = useCallback(async (source: 'camera' | 'library') => {
    try {
      const picked = await pickReceipt(source);
      if (!picked) return;
      const name = await saveReceipt(picked);
      setPhotos((prev) => [...prev, name]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      Alert.alert(
        t('warranty.photoFailed'),
        message === 'permissionDenied'
          ? t('warranty.photoPermission')
          : message === 'nativeMissing'
            ? t('warranty.photoRebuild')
            : message,
      );
    }
  }, []);

  const save = useCallback(async () => {
    const name = productName.trim();
    if (!name) return;

    setBusy(true);
    try {
      const priceMinor = price.trim() ? parseAmountToMinor(price, currency) : null;
      const input = {
        productName: name,
        brand,
        retailer,
        serial,
        purchasedOn,
        months,
        // Stored rather than computed at read time, so the list query and the
        // reminder scheduler both sort on a real column.
        expiresOn: expiryOf(purchasedOn, months),
        priceMinor,
        currency: priceMinor != null ? currency : null,
        photos,
        notes,
      };

      if (editing === 'new' || editing === null) await createWarranty(input);
      else await updateWarranty(editing.id, input);

      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }, [productName, brand, retailer, serial, price, purchasedOn, months, photos, notes, currency, editing, load]);

  const remove = useCallback(
    (w: Warranty) => {
      Alert.alert(t('warranty.deleteTitle'), t('warranty.deleteBody', { name: w.productName }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteWarranty(w.id);
              setEditing(null);
              await load();
            })();
          },
        },
      ]);
    },
    [load],
  );

  const nothingYet = list.length === 0;

  return (
    <Screen title={t('warranty.title')}>
      {nothingYet ? (
        <>
          <EmptyState text={t('warranty.empty')} />
          <Text style={[styles.hint, { color: theme.textDim }]}>{t('warranty.emptyHint')}</Text>
        </>
      ) : (
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder={t('warranty.search')}
          autoCorrect={false}
        />
      )}

      <Group
        label={t('warranty.expiringSoon')}
        items={groups.soon}
        currency={currency}
        now={now}
        onPick={openEdit}
      />
      <Group
        label={t('warranty.inCover')}
        items={groups.active}
        currency={currency}
        now={now}
        onPick={openEdit}
      />
      <Group
        label={t('warranty.expired')}
        items={groups.expired}
        currency={currency}
        now={now}
        onPick={openEdit}
      />

      {!nothingYet && groups.soon.length + groups.active.length + groups.expired.length === 0 ? (
        <EmptyState text={t('warranty.noMatch', { query: query.trim() })} />
      ) : null}

      <Button label={t('warranty.add')} onPress={openNew} />

      {/* ------------------------------------------------------------ form */}
      <Sheet
        visible={editing !== null}
        title={editing === 'new' ? t('warranty.addTitle') : t('warranty.editTitle')}
        onClose={() => setEditing(null)}
      >
        <Field
          label={t('warranty.product')}
          value={productName}
          onChangeText={setProductName}
          placeholder={t('warranty.productPlaceholder')}
        />
        <Field label={t('warranty.brand')} value={brand} onChangeText={setBrand} />
        <Field label={t('warranty.retailer')} value={retailer} onChangeText={setRetailer} />
        <Field
          label={t('warranty.serial')}
          value={serial}
          onChangeText={setSerial}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <SectionLabel>{t('warranty.purchased')}</SectionLabel>
        <Pressable
          onPress={() => setDateSheet(true)}
          style={[styles.picker, { borderColor: theme.borderStrong, backgroundColor: theme.surfaceAlt }]}
        >
          <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '600' }}>
            {formatDate(purchasedOn, 'long')}
          </Text>
          <Text style={{ color: theme.textDim, fontSize: type.body }}>▾</Text>
        </Pressable>

        <SectionLabel>{t('warranty.length')}</SectionLabel>
        <View style={styles.chips}>
          {MONTH_PRESETS.map((m) => (
            <Chip
              key={m}
              label={t(m % 12 === 0 ? 'warranty.years' : 'warranty.months', {
                n: m % 12 === 0 ? m / 12 : m,
              })}
              active={months === m}
              onPress={() => setMonths(m)}
            />
          ))}
        </View>
        {/* The computed answer, shown while they choose rather than after they
            save. "24 months" means nothing; "until 11 September 2028" is the
            thing they are actually trying to record. */}
        <Text style={[styles.expiry, { color: theme.accent }]}>
          {t('warranty.until', { date: formatDate(expiryOf(purchasedOn, months), 'long') })}
        </Text>

        <Field
          label={t('warranty.price')}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder={t('warranty.pricePlaceholder')}
        />
        <Field label={t('warranty.notes')} value={notes} onChangeText={setNotes} multiline />

        {/* ----------------------------------------------------- photos */}
        <SectionLabel>{t('warranty.photos')}</SectionLabel>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('warranty.photosHint')}</Text>
        {photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
            {photos.map((name) => (
              <Pressable
                key={name}
                onLongPress={() => setPhotos((prev) => prev.filter((p) => p !== name))}
                style={[styles.photoWrap, { borderColor: theme.border }]}
              >
                <Image source={{ uri: receiptUri(name) }} style={styles.photo} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.chips}>
          <Chip label={t('warranty.photoCamera')} onPress={() => void addPhoto('camera')} />
          <Chip label={t('warranty.photoLibrary')} onPress={() => void addPhoto('library')} />
        </View>
        {photos.length > 0 ? (
          <Text style={[styles.hint, { color: theme.textDim }]}>{t('warranty.photoRemove')}</Text>
        ) : null}

        <Button
          label={t('common.save')}
          onPress={() => void save()}
          disabled={busy || !productName.trim()}
        />
        {editing !== 'new' && editing !== null ? (
          <Button label={t('common.delete')} variant="danger" onPress={() => remove(editing)} />
        ) : null}
      </Sheet>

      <DatePickerSheet
        visible={dateSheet}
        value={purchasedOn}
        title={t('warranty.purchased')}
        onClose={() => setDateSheet(false)}
        onSelect={setPurchasedOn}
      />
    </Screen>
  );
}

/* --------------------------------------------------------------- one group */

function Group({
  label,
  items,
  currency,
  now,
  onPick,
}: {
  label: string;
  items: Warranty[];
  currency: string;
  now: number;
  onPick: (w: Warranty) => void;
}) {
  if (items.length === 0) return null;

  return (
    <View style={styles.group}>
      <SectionLabel>{`${label} · ${items.length}`}</SectionLabel>
      {items.map((w) => (
        <Row key={w.id} item={w} currency={currency} now={now} onPress={() => onPick(w)} />
      ))}
    </View>
  );
}

function Row({
  item,
  currency,
  now,
  onPress,
}: {
  item: Warranty;
  currency: string;
  now: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const status: WarrantyStatus = statusOf(item.expiresOn, now);
  const left = daysLeft(item.expiresOn, now);

  const tint =
    status === 'expired' ? theme.textDim : status === 'soon' ? theme.warn : theme.income;

  // The countdown is the headline, not the date: "12 days left" needs no
  // arithmetic from the reader, and the date is right underneath for the
  // person who wants to check it.
  const headline =
    status === 'expired'
      ? t('warranty.expiredAgo', { days: Math.abs(left) })
      : left === 0
        ? t('warranty.lastDay')
        : t('warranty.daysLeft', { days: left });

  const sub = [item.brand, item.retailer].filter(Boolean).join(' · ');
  const used = coverUsed(item.purchasedOn, item.expiresOn, now);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.surfaceAlt : theme.surface,
          borderColor: status === 'soon' ? theme.warn : theme.border,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardText}>
          <Text style={[styles.product, { color: theme.text }]} numberOfLines={1}>
            {item.productName}
          </Text>
          {sub ? (
            <Text style={[styles.hint, { color: theme.textDim }]} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
        <View style={styles.cardRight}>
          <Text style={[styles.left, { color: tint }]}>{headline}</Text>
          <Text style={[styles.date, { color: theme.textDim }]}>
            {formatDate(item.expiresOn, 'long')}
          </Text>
        </View>
      </View>

      {/* How much of the cover has been used. A number is precise; a bar is
          understood without reading. */}
      <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
        <View style={[styles.fill, { backgroundColor: tint, width: `${Math.round(used * 100)}%` }]} />
      </View>

      {item.priceMinor != null ? (
        <Text style={[styles.hint, { color: theme.textDim }]}>
          {formatMinor(item.priceMinor, item.currency ?? currency, { compact: true })}
          {' · '}
          {t('warranty.boughtOn', { date: formatDate(item.purchasedOn, 'long') })}
        </Text>
      ) : (
        <Text style={[styles.hint, { color: theme.textDim }]}>
          {t('warranty.boughtOn', { date: formatDate(item.purchasedOn, 'long') })}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  cardText: { flex: 1, gap: 2 },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  product: { fontSize: type.body, fontWeight: '700' },
  left: { fontSize: type.small, fontWeight: '700' },
  date: { fontSize: type.tiny },
  hint: { fontSize: type.small, lineHeight: 19 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: 48,
  },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  expiry: { fontSize: type.small, fontWeight: '700' },
  photoRow: { gap: space.sm, paddingVertical: space.xs },
  photoWrap: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  photo: { width: 84, height: 84 },
});
