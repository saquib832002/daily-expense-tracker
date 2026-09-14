/**
 * Loyalty cards — the plastic nobody carries.
 *
 * Eight cards in a drawer at home is eight lots of points never collected. The
 * fix is not storage, it is *the four seconds at the till*: the cashier asks,
 * you open the app, the card is already the first one in the list because it is
 * the one you always use, and the barcode fills the screen.
 *
 * So the design follows the moment rather than the data:
 *
 *   - **Most-used first**, not alphabetical. The card you want is nearly always
 *     the one you used last time.
 *   - **One tap to the barcode**, full width, on white, at whatever brightness
 *     the phone happens to be at. No detail page in between.
 *   - **Scan to add.** Typing a sixteen-digit number off a card while somebody
 *     waits behind you is how a feature goes unused.
 *
 * And the honest limitation, stated where the user meets it rather than buried:
 * some tills scan the screen happily, some refuse, and a handful of cards use
 * symbologies this cannot draw. For those, the number is shown large enough to
 * read out, and there is space for a photo of the card itself.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import qrcode from 'qrcode-generator';

import {
  createLoyaltyCard,
  deleteLoyaltyCard,
  listLoyaltyCards,
  loyaltyCardPhotos,
  markCardUsed,
  updateLoyaltyCard,
} from '@/db/queries';
import type { LoyaltyCard } from '@/db/schema';
import { encode, guessSymbology, type Symbology } from '@/domain/barcode';
import { t } from '@/i18n';
import { pickReceipt, receiptUri, saveReceipt } from '@/services/receipts';
import { radius, space, type, useTheme } from '@/theme';
import { Button, EmptyState, Field, Screen, SectionLabel, Sheet } from '@/ui';
import { Barcode, QrCode } from '@/ui/Barcode';
import { ScanCode } from '@/ui/ScanCode';

/** Card colours, chosen to stay legible with white text in both themes. */
const COLOURS = ['#0E7C5A', '#B4801F', '#C0392B', '#4A82E8', '#8E5AD6', '#0D9488', '#6B7079'];

export default function CardsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const [list, setList] = useState<LoyaltyCard[]>([]);
  const [showing, setShowing] = useState<LoyaltyCard | null>(null);
  const [editing, setEditing] = useState<LoyaltyCard | 'new' | null>(null);
  const [scanning, setScanning] = useState(false);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [symbology, setSymbology] = useState<Symbology>('unknown');
  const [notes, setNotes] = useState('');
  const [colour, setColour] = useState(COLOURS[0]!);
  const [photos, setPhotos] = useState<string[]>([]);

  const load = useCallback(async () => {
    setList(await listLoyaltyCards());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openNew = useCallback(() => {
    setName('');
    setCode('');
    setSymbology('unknown');
    setNotes('');
    setColour(COLOURS[list.length % COLOURS.length]!);
    setPhotos([]);
    setEditing('new');
  }, [list.length]);

  const openEdit = useCallback((card: LoyaltyCard) => {
    setName(card.name);
    setCode(card.code);
    setSymbology(card.symbology as Symbology);
    setNotes(card.notes ?? '');
    setColour(card.colour ?? COLOURS[0]!);
    setPhotos(loyaltyCardPhotos(card));
    setEditing(card);
  }, []);

  /** Straight from the camera into the form, with the symbology it was read as. */
  const onScanned = useCallback((value: string, kind: Symbology) => {
    setScanning(false);
    setCode(value);
    setSymbology(kind);
    setEditing((prev) => prev ?? 'new');
  }, []);

  const addPhoto = useCallback(async (source: 'camera' | 'library') => {
    try {
      const picked = await pickReceipt(source);
      if (!picked) return;
      const file = await saveReceipt(picked);
      setPhotos((prev) => [...prev, file]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      Alert.alert(
        t('cards.photoFailed'),
        message === 'permissionDenied' ? t('cards.photoPermission') : message,
      );
    }
  }, []);

  const save = useCallback(async () => {
    if (!name.trim() || !code.trim()) return;

    const input = {
      name,
      code,
      // A number typed in by hand arrives with no symbology; guessing is better
      // than storing "unknown" and refusing to draw anything.
      symbology: symbology === 'unknown' ? guessSymbology(code.trim()) : symbology,
      notes,
      colour,
      photos,
    };

    if (editing === 'new' || editing === null) await createLoyaltyCard(input);
    else await updateLoyaltyCard(editing.id, input);

    setEditing(null);
    await load();
  }, [name, code, symbology, notes, colour, photos, editing, load]);

  const remove = useCallback(
    (card: LoyaltyCard) => {
      Alert.alert(t('cards.deleteTitle'), t('cards.deleteBody', { name: card.name }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteLoyaltyCard(card.id);
              setEditing(null);
              await load();
            })();
          },
        },
      ]);
    },
    [load],
  );

  const show = useCallback((card: LoyaltyCard) => {
    setShowing(card);
    // Not awaited: the barcode should be on screen before this finishes, and
    // a failed counter update is not worth delaying a person at a till.
    void markCardUsed(card.id);
  }, []);

  return (
    <Screen title={t('cards.title')}>
      {list.length === 0 ? (
        <>
          <EmptyState text={t('cards.empty')} />
          <Text style={[styles.hint, { color: theme.textDim }]}>{t('cards.emptyHint')}</Text>
        </>
      ) : (
        <View style={styles.grid}>
          {list.map((card) => (
            <Pressable
              key={card.id}
              onPress={() => show(card)}
              onLongPress={() => openEdit(card)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: card.colour ?? COLOURS[0], opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.cardName} numberOfLines={2}>
                {card.name}
              </Text>
              <Text style={styles.cardCode} numberOfLines={1}>
                {card.code}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {list.length > 0 ? (
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('cards.listHint')}</Text>
      ) : null}

      <Button label={t('cards.scanAdd')} onPress={() => setScanning(true)} />
      <Button label={t('cards.manualAdd')} variant="secondary" onPress={openNew} />

      {/* ------------------------------------------------- the barcode itself */}
      <Modal
        visible={showing !== null}
        animationType="fade"
        onRequestClose={() => setShowing(null)}
        presentationStyle="fullScreen"
      >
        {/* Deliberately white, whatever the theme. A dark-mode barcode is a
            barcode that does not scan. */}
        <SafeAreaView style={styles.showWrap} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.showBody}>
            <Text style={styles.showName}>{showing?.name}</Text>
            {showing ? <CardArt card={showing} width={width - space.xl * 2} /> : null}
            <Text style={styles.showCode} selectable>
              {showing?.code}
            </Text>
            {showing?.notes ? <Text style={styles.showNotes}>{showing.notes}</Text> : null}

            {showing && loyaltyCardPhotos(showing).length > 0 ? (
              <ScrollView horizontal contentContainerStyle={styles.photoRow}>
                {loyaltyCardPhotos(showing).map((file) => (
                  <Image key={file} source={{ uri: receiptUri(file) }} style={styles.photo} />
                ))}
              </ScrollView>
            ) : null}

            <Text style={styles.showHint}>{t('cards.showHint')}</Text>
            <Pressable onPress={() => setShowing(null)} style={styles.closeButton}>
              <Text style={styles.closeText}>{t('common.done')}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ---------------------------------------------------------- scanning */}
      <ScanCode
        visible={scanning}
        onCancel={() => setScanning(false)}
        onScanned={onScanned}
      />

      {/* -------------------------------------------------------------- form */}
      <Sheet
        visible={editing !== null}
        title={editing === 'new' ? t('cards.addTitle') : t('cards.editTitle')}
        onClose={() => setEditing(null)}
      >
        <Field
          label={t('cards.name')}
          value={name}
          onChangeText={setName}
          placeholder={t('cards.namePlaceholder')}
        />
        <Field
          label={t('cards.code')}
          value={code}
          onChangeText={(v) => {
            setCode(v);
            setSymbology('unknown');
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={t('cards.codePlaceholder')}
        />
        <Button label={t('cards.scanInstead')} variant="secondary" onPress={() => setScanning(true)} />
        <Field label={t('cards.notes')} value={notes} onChangeText={setNotes} />

        <SectionLabel>{t('cards.colour')}</SectionLabel>
        <View style={styles.colours}>
          {COLOURS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColour(c)}
              style={[
                styles.swatch,
                { backgroundColor: c, borderColor: c === colour ? theme.text : 'transparent' },
              ]}
            />
          ))}
        </View>

        <SectionLabel>{t('cards.photos')}</SectionLabel>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('cards.photosHint')}</Text>
        {photos.length > 0 ? (
          <ScrollView horizontal contentContainerStyle={styles.photoRow}>
            {photos.map((file) => (
              <Pressable
                key={file}
                onLongPress={() => setPhotos((prev) => prev.filter((p) => p !== file))}
              >
                <Image source={{ uri: receiptUri(file) }} style={styles.photoSmall} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.chips}>
          <Button label={t('cards.photoCamera')} variant="secondary" onPress={() => void addPhoto('camera')} />
          <Button label={t('cards.photoLibrary')} variant="secondary" onPress={() => void addPhoto('library')} />
        </View>

        <Button
          label={t('common.save')}
          onPress={() => void save()}
          disabled={!name.trim() || !code.trim()}
        />
        {editing !== 'new' && editing !== null ? (
          <Button label={t('common.delete')} variant="danger" onPress={() => remove(editing)} />
        ) : null}
      </Sheet>
    </Screen>
  );
}

/* ------------------------------------------------------------- the drawing */

function CardArt({ card, width }: { card: LoyaltyCard; width: number }) {
  const art = useMemo(() => {
    const kind = card.symbology as Symbology;

    if (kind === 'qr') {
      try {
        // Type 0 = smallest version that fits; M correction is the usual
        // trade-off between size and how much smudging it survives.
        const q = qrcode(0, 'M');
        q.addData(card.code);
        q.make();
        return { kind: 'qr' as const, matrix: { count: q.getModuleCount(), isDark: q.isDark } };
      } catch {
        return null;
      }
    }

    const widths = encode(card.code, kind);
    return widths ? { kind: '1d' as const, widths } : null;
  }, [card.code, card.symbology]);

  if (!art) {
    // Nothing drawable — a QR payload too long, or a symbology this cannot
    // encode. The number itself is still the useful thing.
    return <Text style={styles.showFallback}>{t('cards.cannotDraw')}</Text>;
  }

  if (art.kind === 'qr') {
    return <QrCode matrix={art.matrix} size={Math.min(width, 320)} />;
  }
  return <Barcode widths={art.widths} width={width} height={110} />;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  card: {
    width: '47%',
    minHeight: 96,
    borderRadius: radius.lg,
    padding: space.md,
    justifyContent: 'space-between',
  },
  cardName: { color: '#FFFFFF', fontSize: type.body, fontWeight: '700' },
  cardCode: { color: '#FFFFFFCC', fontSize: type.tiny, fontVariant: ['tabular-nums'] },
  hint: { fontSize: type.small, lineHeight: 19 },
  chips: { flexDirection: 'row', gap: space.sm },
  colours: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
  photoRow: { gap: space.sm, paddingVertical: space.xs },
  photo: { width: 140, height: 92, borderRadius: radius.md },
  photoSmall: { width: 84, height: 84, borderRadius: radius.md },

  showWrap: { flex: 1, backgroundColor: '#FFFFFF' },
  showBody: { padding: space.xl, alignItems: 'center', gap: space.lg },
  showName: { color: '#000000', fontSize: type.title, fontWeight: '700', textAlign: 'center' },
  showCode: {
    color: '#000000',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
  },
  showNotes: { color: '#444444', fontSize: type.small, textAlign: 'center' },
  showHint: { color: '#666666', fontSize: type.small, textAlign: 'center', lineHeight: 19 },
  showFallback: { color: '#000000', fontSize: type.body, textAlign: 'center' },
  closeButton: {
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  closeText: { color: '#000000', fontSize: type.body, fontWeight: '700' },
});
