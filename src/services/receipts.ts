/**
 * Receipt images: taking them, shrinking them, keeping them.
 *
 * The photos live in the app's own private folder and are never uploaded
 * anywhere — no server exists to upload them to, and that is a decision, not
 * an accident. The database stores only the file NAME, so moving the app's
 * folder (a restore, a new Android version) does not break every image.
 *
 * Every photo is resized before it is kept. A modern phone camera produces a
 * 4 MB, 12-megapixel image; a receipt needs about 1600px on its long edge to
 * stay readable. That is a twentyfold saving, and it is the difference between
 * a backup you can share over WhatsApp and one you cannot.
 */
import { randomUUID } from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export const RECEIPT_DIR = `${FileSystem.documentDirectory}receipts/`;

/** Long edge, in pixels. Enough for OCR and for reading it back later. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.7;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(RECEIPT_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(RECEIPT_DIR, { intermediates: true });
}

/** Full file:// URI for a stored receipt name. */
export function receiptUri(name: string): string {
  return `${RECEIPT_DIR}${name}`;
}

export type PickSource = 'camera' | 'library';

export interface PickedImage {
  uri: string;
  /** Pixels, when the picker reported it. Used to avoid upscaling a small photo. */
  width: number | null;
}

/**
 * Take or choose a photo. Null means the user backed out, which is not an
 * error and must never be reported as one.
 */
export async function pickReceipt(source: PickSource): Promise<PickedImage | null> {
  let permission: ImagePicker.PermissionResponse;
  try {
    permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
  } catch (e) {
    // "Cannot find native module" means the JS is newer than the installed
    // build. Saying "could not open the camera" here sends people hunting
    // through Android permission settings for a problem that is a rebuild.
    if (/native module/i.test(e instanceof Error ? e.message : String(e))) {
      throw new Error('nativeMissing');
    }
    throw e;
  }

  if (!permission.granted) throw new Error('permissionDenied');

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // Deliberately off: Android's built-in crop tool locks to a square on a
    // number of devices, and a square crop of a receipt loses the total.
    allowsEditing: false,
    quality: 1,
    exif: false,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) return null;
  return { uri: asset.uri, width: asset.width ?? null };
}

/**
 * Shrink to something worth keeping, and put it in the receipts folder.
 * Returns the file name to store on the transaction.
 */
export async function saveReceipt(picked: PickedImage): Promise<string> {
  await ensureDir();

  // Only ever shrink. Upscaling a small photo to 1600px makes the file bigger
  // and the text no more readable.
  const actions =
    picked.width != null && picked.width <= MAX_EDGE ? [] : [{ resize: { width: MAX_EDGE } }];

  const processed = await ImageManipulator.manipulateAsync(picked.uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const name = `${randomUUID()}.jpg`;
  await FileSystem.moveAsync({ from: processed.uri, to: receiptUri(name) });
  return name;
}

export async function deleteReceipt(name: string): Promise<void> {
  await FileSystem.deleteAsync(receiptUri(name), { idempotent: true }).catch(() => {});
}

export async function receiptExists(name: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(receiptUri(name));
  return info.exists;
}

/** Every stored receipt file name. Used by the backup. */
export async function listReceiptFiles(): Promise<string[]> {
  await ensureDir();
  return (await FileSystem.readDirectoryAsync(RECEIPT_DIR)).filter((n) => !n.startsWith('.'));
}

/** Total bytes on disk, for the "what is this costing me" line in settings. */
export async function receiptsSize(): Promise<number> {
  let total = 0;
  for (const name of await listReceiptFiles()) {
    const info = await FileSystem.getInfoAsync(receiptUri(name));
    if (info.exists) total += info.size ?? 0;
  }
  return total;
}

/**
 * Write an image that came out of a backup.
 * Existing files are left alone: a restore should never overwrite a photo that
 * is already on the phone with an older copy of itself.
 */
export async function writeReceiptFromBase64(name: string, base64: string): Promise<void> {
  await ensureDir();
  if (await receiptExists(name)) return;
  await FileSystem.writeAsStringAsync(receiptUri(name), base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export async function readReceiptAsBase64(name: string): Promise<string> {
  return FileSystem.readAsStringAsync(receiptUri(name), {
    encoding: FileSystem.EncodingType.Base64,
  });
}
