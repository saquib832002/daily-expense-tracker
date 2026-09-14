/**
 * The camera, pointed at a barcode.
 *
 * Wrapped rather than used inline for two reasons.
 *
 * **Debounce.** `onBarcodeScanned` fires on every frame that contains a
 * readable symbol — thirty times a second — so without a latch one card
 * produces twenty-nine extra callbacks while the modal is still closing.
 *
 * **Permission at the right moment.** The camera prompt is asked for when the
 * scanner opens, with the reason already on screen, rather than up front on a
 * maybe. A refusal is reported as a sentence with a way out, because
 * `expo-camera` is a native module and the other reason this screen can fail —
 * a JS bundle newer than the installed APK — looks identical to the user and
 * has a completely different fix.
 */
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { symbologyFor, type Symbology } from '@/domain/barcode';
import { t } from '@/i18n';
import { radius, space, type, useTheme } from '@/theme';

/**
 * The symbologies worth watching for. Restricting the list makes the scanner
 * faster and stops it reading the QR code on the packaging next to the card.
 */
const TYPES: BarcodeType[] = [
  'qr', 'ean13', 'ean8', 'code128', 'code39', 'code93', 'upc_a', 'upc_e', 'itf14',
];

export function ScanCode({
  visible,
  onScanned,
  onCancel,
}: {
  visible: boolean;
  onScanned: (value: string, symbology: Symbology) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [failed, setFailed] = useState(false);
  /** Latches on the first read, so one card does not fire thirty times. */
  const handled = useRef(false);

  useEffect(() => {
    if (!visible) {
      handled.current = false;
      return;
    }
    // Asked when the scanner opens rather than up front: the reason is on
    // screen, and Android's one prompt is not spent on a maybe.
    void requestPermission().catch(() => setFailed(true));
  }, [visible, requestPermission]);

  const handle = useCallback(
    (result: { data: string; type?: string }) => {
      if (handled.current) return;
      handled.current = true;
      onScanned(result.data, symbologyFor(result.type));
    },
    [onScanned],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={[styles.wrap, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>{t('cards.scanTitle')}</Text>
          <Pressable onPress={onCancel} hitSlop={12}>
            <Text style={{ color: theme.accent, fontSize: type.body }}>✕</Text>
          </Pressable>
        </View>

        {failed ? (
          <Message text={t('cards.scanRebuild')} />
        ) : permission && !permission.granted && !permission.canAskAgain ? (
          <Message text={t('cards.scanPermission')} />
        ) : permission?.granted ? (
          <View style={styles.viewport}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: TYPES }}
              onBarcodeScanned={handle}
            />
            {/* A frame to aim with. Purely cosmetic — the scanner reads the
                whole frame — but people line the card up with it, which is
                what makes the read fast. */}
            <View pointerEvents="none" style={styles.reticle} />
          </View>
        ) : (
          <Message text={t('cards.scanOpening')} />
        )}

        <Text style={[styles.hint, { color: theme.textDim }]}>{t('cards.scanHint')}</Text>
      </SafeAreaView>
    </Modal>
  );
}

function Message({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.message}>
      <Text style={[styles.messageText, { color: theme.textDim }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  title: { fontSize: type.title, fontWeight: '600' },
  viewport: { flex: 1, margin: space.lg, borderRadius: radius.lg, overflow: 'hidden' },
  reticle: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    top: '30%',
    bottom: '30%',
    borderWidth: 2,
    borderColor: '#FFFFFFAA',
    borderRadius: radius.md,
  },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  messageText: { fontSize: type.body, textAlign: 'center', lineHeight: 22 },
  hint: { fontSize: type.small, textAlign: 'center', padding: space.lg, lineHeight: 19 },
});
