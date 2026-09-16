/**
 * The passphrase, and where the key lives.
 *
 * `domain/vault` knows how to encrypt. This knows *when*, and holds the one
 * piece of state that makes the feature usable rather than a nuisance.
 *
 * ## The problem this solves
 *
 * Automatic backup runs unattended — on app open, in the background, while the
 * user is doing something else. If encryption required typing a passphrase,
 * automatic backup would stop being automatic, and a backup people have to
 * remember to run is a backup that does not happen.
 *
 * So the derived key is stored in Android's keystore through
 * `expo-secure-store`: hardware-backed where the device supports it, app-
 * private, and — importantly — excluded from Android Auto Backup, so the key
 * is never uploaded to the same Google account as the file it opens.
 *
 * The passphrase itself is stored nowhere at all. Only the 32-byte key derived
 * from it, and a small verifier used to check a typed passphrase without
 * having anything to compare it against.
 *
 * ## What this protects, and what it does not
 *
 * **Protects:** the archive in Google Drive. Someone who gets into the user's
 * Google account — a reused password, a stolen session, a court order served
 * on Google — finds a file they cannot read.
 *
 * **Does not protect:** an unlocked phone. Anyone holding it has the app's
 * database directly and does not need the backup at all. Claiming otherwise
 * would be the kind of security theatre that makes people careless.
 *
 * That distinction is stated on the screen, not just here.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { getSetting, setSetting } from '@/db/queries';
import {
  DEFAULT_ITERATIONS,
  SALT_BYTES,
  VaultError,
  deriveKey,
  fromBase64,
  looksEncrypted,
  open,
  openWithKey,
  readHeader,
  seal,
  toBase64,
} from '@/domain/vault';

/** Where the derived key lives. Not the passphrase — the key. */
const KEY_SLOT = 'backup_key_v1';

/** Settings rows. None of these is a secret; all of them are needed to decrypt. */
const SALT_KEY = 'backup_salt';
const ITERATIONS_KEY = 'backup_iterations';
/** A sealed known string, so a typed passphrase can be checked. */
const VERIFIER_KEY = 'backup_verifier';
const ENABLED_KEY = 'backup_encrypted';

/** The plaintext inside the verifier. Its contents are not secret. */
const VERIFIER_PLAINTEXT = 'expense-tracker-verifier-v1';

/**
 * Cached for the life of the process.
 *
 * `SecureStore` is an async round-trip to the keystore, and the automatic
 * backup path is already doing enough work; reading it once per launch is
 * plenty. Cleared by `disable` and by `setPassphrase`.
 */
let cachedKey: Uint8Array | null = null;

function randomBytes(n: number): Uint8Array {
  return Crypto.getRandomBytes(n);
}

/* ----------------------------------------------------------------- reading */

export async function isEncryptionOn(): Promise<boolean> {
  return (await getSetting(ENABLED_KEY)) === '1';
}

/**
 * The key, or null when encryption is off — or when it is on but the key has
 * gone.
 *
 * The second case is real and has to be handled rather than thrown: restoring
 * the app's database onto a new phone brings the *settings* back, including
 * "encryption is on", while the keystore entry stays behind on the old device.
 * The app must notice that and ask for the passphrase again instead of
 * writing backups it cannot read or crashing on open.
 */
export async function backupKey(): Promise<Uint8Array | null> {
  if (!(await isEncryptionOn())) return null;
  if (cachedKey) return cachedKey;
  try {
    const stored = await SecureStore.getItemAsync(KEY_SLOT);
    if (!stored) return null;
    const key = fromBase64(stored);
    if (key.length !== 32) return null;
    cachedKey = key;
    return key;
  } catch {
    // A keystore that refuses to answer — a locked device, a corrupted entry —
    // must not take the app down with it.
    return null;
  }
}

/** True when encryption is on but this device cannot produce the key. */
export async function needsPassphrase(): Promise<boolean> {
  return (await isEncryptionOn()) && (await backupKey()) === null;
}

/* ----------------------------------------------------------------- writing */

export interface VaultSetupResult {
  ok: boolean;
  /** Stable code for the UI. */
  error?: 'tooShort' | 'keystore' | 'unknown';
}

/**
 * Turn encryption on, or change the passphrase.
 *
 * Changing it re-derives the key and rewrites the verifier. It deliberately
 * does NOT re-encrypt the archives already in Drive: those were sealed with
 * the old key and still open with the old passphrase. Silently orphaning them
 * would be worse, so the screen says so and offers to run a fresh backup.
 */
export async function setPassphrase(passphrase: string): Promise<VaultSetupResult> {
  if (passphrase.normalize('NFKC').length < 12) return { ok: false, error: 'tooShort' };

  try {
    const salt = randomBytes(SALT_BYTES);
    const key = deriveKey(passphrase, salt, DEFAULT_ITERATIONS);
    const verifier = seal(
      new TextEncoder().encode(VERIFIER_PLAINTEXT),
      key,
      salt,
      DEFAULT_ITERATIONS,
      randomBytes,
    );

    // Keystore first. If it fails there is nothing to unwind, whereas the
    // reverse order could leave the settings claiming encryption is on with no
    // key behind it — and every future backup would then be refused.
    await SecureStore.setItemAsync(KEY_SLOT, toBase64(key));

    await setSetting(SALT_KEY, toBase64(salt));
    await setSetting(ITERATIONS_KEY, String(DEFAULT_ITERATIONS));
    await setSetting(VERIFIER_KEY, verifier);
    await setSetting(ENABLED_KEY, '1');

    cachedKey = key;
    return { ok: true };
  } catch (e) {
    if (e instanceof VaultError) return { ok: false, error: 'unknown' };
    return { ok: false, error: 'keystore' };
  }
}

/**
 * Check a passphrase against the stored verifier and put the key back.
 *
 * Used after restoring onto a new phone, where the settings say encryption is
 * on and the keystore is empty.
 */
export async function unlockWithPassphrase(passphrase: string): Promise<boolean> {
  const verifier = await getSetting(VERIFIER_KEY);
  if (!verifier) return false;
  try {
    const decoded = new TextDecoder().decode(open(verifier, passphrase));
    if (decoded !== VERIFIER_PLAINTEXT) return false;

    const header = readHeader(verifier);
    const key = deriveKey(passphrase, fromBase64(header.salt), header.iterations);
    await SecureStore.setItemAsync(KEY_SLOT, toBase64(key));
    cachedKey = key;
    return true;
  } catch {
    return false;
  }
}

/**
 * Turn encryption off.
 *
 * Future backups are written in the clear. Archives already in Drive stay
 * encrypted and still need the passphrase — which is why the key is left in
 * the keystore rather than deleted. Deleting it would make every existing
 * backup unopenable the instant somebody flipped a switch off, and no amount
 * of confirmation dialog makes that a reasonable thing to do.
 */
export async function disableEncryption(): Promise<void> {
  await setSetting(ENABLED_KEY, '0');
}

/**
 * Forget the key entirely.
 *
 * Separate from `disableEncryption`, and behind a much louder confirmation,
 * because this is the irreversible one: after it, every encrypted archive in
 * Drive can only be opened by typing the passphrase again.
 */
export async function forgetKey(): Promise<void> {
  cachedKey = null;
  try {
    await SecureStore.deleteItemAsync(KEY_SLOT);
  } catch {
    // Nothing useful to do; the setting below is what the app reads.
  }
  await setSetting(ENABLED_KEY, '0');
}

/* -------------------------------------------------------------- the seams */

/**
 * Encrypt an archive if encryption is on; otherwise hand it back untouched.
 *
 * Returns the bytes to write and whether they ended up encrypted, so the
 * caller can choose the right file encoding without asking again.
 */
export async function maybeSeal(
  archive: Uint8Array,
): Promise<{ encrypted: false; bytes: Uint8Array } | { encrypted: true; text: string }> {
  const key = await backupKey();
  if (!key) return { encrypted: false, bytes: archive };

  const salt = fromBase64((await getSetting(SALT_KEY)) ?? '');
  const iterations = Number((await getSetting(ITERATIONS_KEY)) ?? DEFAULT_ITERATIONS);
  if (salt.length !== SALT_BYTES) {
    // Enabled without a salt should be impossible. Writing an unencrypted
    // backup is the safe failure — losing the backup is not.
    return { encrypted: false, bytes: archive };
  }
  return { encrypted: true, text: seal(archive, key, salt, iterations, randomBytes) };
}

export type UnsealFailure = 'needsPassphrase' | 'wrongPassphrase' | 'unsupported';

/**
 * Open an archive that may or may not be encrypted.
 *
 * `passphrase` is optional: the stored key is tried first, so restoring on the
 * same phone asks for nothing. It is only needed on a device that has never
 * held the key.
 */
export async function unseal(
  text: string,
  passphrase?: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: UnsealFailure }> {
  if (!looksEncrypted(text)) {
    throw new Error('unseal called on something that is not an encrypted container');
  }

  if (passphrase) {
    try {
      return { ok: true, bytes: open(text, passphrase) };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof VaultError && e.code === 'unsupported' ? 'unsupported' : 'wrongPassphrase',
      };
    }
  }

  const key = await backupKey();
  if (!key) return { ok: false, error: 'needsPassphrase' };
  try {
    return { ok: true, bytes: openWithKey(text, key) };
  } catch {
    // The key we hold is not the one this file was sealed with — an archive
    // from before a passphrase change. Asking is the only way forward.
    return { ok: false, error: 'needsPassphrase' };
  }
}

/** Exposed for the screen, so it can say what will happen before it happens. */
export { looksEncrypted };
