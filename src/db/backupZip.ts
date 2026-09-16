/**
 * The backup that carries the pictures too.
 *
 * A plain JSON backup stores `receiptPath` — a file name — and nothing else.
 * Restore that on a new phone and every transaction points at an image that
 * is not there. So the moment receipts exist, the backup has to be a container
 * rather than a document: a ZIP holding `backup.json` and a `receipts/` folder.
 *
 * It is a ZIP rather than anything cleverer for one reason: in ten years, with
 * this app long gone, someone can still double-click it and get their data and
 * their photos out. That is the whole job of a backup format.
 */
import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system';

import { fromBase64, toBase64 as bytesToBase64 } from '@/domain/vault';
import {
  listReceiptFiles,
  readReceiptAsBase64,
  writeReceiptFromBase64,
} from '@/services/receipts';
import { looksEncrypted, maybeSeal, unseal } from '@/services/vault';

import { buildBackup, restoreBackup, type RestoreResult } from './backup';

export const ZIP_JSON = 'backup.json';
export const ZIP_RECEIPTS = 'receipts/';

/**
 * A backup ZIP in the cache, ready for the share sheet.
 *
 * Written to a file rather than returned as a string: a hundred receipts is
 * twenty megabytes, and holding that as a base64 string in JS while also
 * holding the ZIP it came from is how a phone runs out of memory.
 */
export async function buildBackupZip(
  filename: string,
  appVersion?: string,
): Promise<{ uri: string; receipts: number; encrypted: boolean }> {
  const zip = new JSZip();
  zip.file(ZIP_JSON, await buildBackup(appVersion));

  const names = await listReceiptFiles();
  for (const name of names) {
    try {
      zip.file(`${ZIP_RECEIPTS}${name}`, await readReceiptAsBase64(name), { base64: true });
    } catch {
      // One unreadable image must not cost you the whole backup.
    }
  }

  // Bytes rather than base64, because the encryption path needs bytes and
  // asking JSZip for base64 only to decode it again would double the peak
  // memory on exactly the archives that are already the largest.
  const bytes = (await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    // JPEGs are already compressed; level 1 is the honest trade here, spending
    // a second rather than a minute for a percent or two.
    compressionOptions: { level: 1 },
  })) as Uint8Array;

  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});

  // If a passphrase is set, what lands on disk — and therefore in Drive — is
  // the encrypted container, not the ZIP. The file keeps the same name and
  // extension deliberately: it is still the user's backup, and renaming it
  // would only mean the one they find in Drive a year later looks unfamiliar.
  const sealed = await maybeSeal(bytes);
  if (sealed.encrypted) {
    await FileSystem.writeAsStringAsync(uri, sealed.text, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return { uri, receipts: names.length, encrypted: true };
  }

  await FileSystem.writeAsStringAsync(uri, bytesToBase64(sealed.bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return { uri, receipts: names.length, encrypted: false };
}

export interface ZipRestoreResult extends RestoreResult {
  receipts?: number;
}

/**
 * Restore from a ZIP.
 *
 * The data goes in first and the images after, deliberately: if the images
 * fail halfway through you still have your ledger, and a missing photo is a
 * missing photo rather than a missing month.
 */
export async function restoreBackupZip(
  uri: string,
  /** Only needed for an encrypted archive on a phone that lacks the key. */
  passphrase?: string,
): Promise<ZipRestoreResult> {
  let zip: JSZip;
  try {
    // Read as base64 whatever the file turns out to be: an encrypted container
    // is text and a ZIP is not, and reading a ZIP as UTF-8 mangles it. Base64
    // is the one encoding that survives both, and the first few decoded bytes
    // say which one this is.
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const prefix = new TextDecoder().decode(fromBase64(base64.slice(0, 64)));
    if (looksEncrypted(prefix)) {
      const container = new TextDecoder().decode(fromBase64(base64));
      const opened = await unseal(container, passphrase);
      if (!opened.ok) return { ok: false, error: opened.error };
      zip = await JSZip.loadAsync(opened.bytes);
    } else {
      zip = await JSZip.loadAsync(base64, { base64: true });
    }
  } catch {
    return { ok: false, error: 'notZip' };
  }

  const entry = zip.file(ZIP_JSON);
  if (!entry) return { ok: false, error: 'notOurs' };

  const result = await restoreBackup(await entry.async('string'));
  if (!result.ok) return result;

  let receipts = 0;
  const images = zip.file(new RegExp(`^${ZIP_RECEIPTS}`));
  for (const image of images) {
    const name = image.name.slice(ZIP_RECEIPTS.length);
    if (!name || name.includes('/')) continue; // never write outside the folder
    try {
      await writeReceiptFromBase64(name, await image.async('base64'));
      receipts++;
    } catch {
      // Skip the one bad image; the rest of the restore stands.
    }
  }

  return { ...result, receipts };
}
