/**
 * Encrypting the backup.
 *
 * The privacy claim this app makes is strong everywhere except one place: the
 * archive it writes to Google Drive. Everything else genuinely never leaves
 * the phone — but the backup does, and anyone who gets into the Google account
 * gets a readable copy of every expense, every merchant, and every receipt
 * photo. This closes that.
 *
 * ## The container
 *
 * Three lines of text, not a binary blob:
 *
 *     EXPENSETRACKER-ENCRYPTED-1
 *     {"kdf":"pbkdf2-sha256","iterations":210000,"salt":"…","nonce":"…","cipher":"xchacha20-poly1305"}
 *     <base64 ciphertext>
 *
 * That header is the whole point. A backup is a promise to a version of the
 * user who has lost their phone, possibly years from now, possibly with this
 * app long gone from the Play Store. A format that says out loud how it was
 * encrypted is one a competent person can open with any library; an opaque
 * blob is one that dies with the app. The header costs two hundred bytes.
 *
 * ## The choices, and why
 *
 * **XChaCha20-Poly1305**, not AES-GCM. It is authenticated, so a corrupted or
 * tampered archive fails loudly instead of decrypting into garbage that then
 * gets restored over real data. And its 24-byte nonce is large enough to
 * generate at random every time without ever worrying about a repeat — AES-GCM
 * with a 12-byte nonce needs a counter, and a counter needs state, and state
 * in a backup path is how nonces get reused.
 *
 * **PBKDF2-SHA256 at 210,000 iterations**, not scrypt or Argon2. Those are
 * better functions, and both are far too slow in JavaScript on a mid-range
 * Android phone — slow enough that people turn the feature off. 210,000 is the
 * OWASP figure for PBKDF2-SHA256 and costs about a second here.
 *
 * **Pure JavaScript** (`@noble/*`), not a native module. It means this ships
 * as an ordinary update rather than a rebuild, and it means the encryption
 * works identically on every device instead of depending on what a
 * manufacturer's crypto provider happens to support.
 *
 * ## What it cannot do
 *
 * There is no recovery. No reset link, no security question, no copy of the
 * key anywhere. That is what makes it worth having, and it is the one thing
 * the user must be told plainly before they switch it on — which is why
 * `services/vault` refuses to enable it without an explicit confirmation.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** First line of the file. Also how `looksEncrypted` recognises one. */
export const VAULT_MAGIC = 'EXPENSETRACKER-ENCRYPTED-1';

export const KDF = 'pbkdf2-sha256';
export const CIPHER = 'xchacha20-poly1305';

/** OWASP's figure for PBKDF2-SHA256. Recorded in the header, so it can rise. */
export const DEFAULT_ITERATIONS = 210_000;

/** Floor on what we will accept when *reading*, so a forged header cannot
 *  weaken the derivation to the point of being brute-forceable. */
const MIN_ITERATIONS = 50_000;
/** Ceiling, so a corrupt or malicious header cannot freeze the app for an hour. */
const MAX_ITERATIONS = 2_000_000;

const SALT_BYTES = 16;
const NONCE_BYTES = 24;
const KEY_BYTES = 32;

export interface VaultHeader {
  kdf: string;
  iterations: number;
  salt: string;
  nonce: string;
  cipher: string;
}

export class VaultError extends Error {
  constructor(
    /** Stable code the UI can switch on without matching English text. */
    readonly code:
      | 'notEncrypted'
      | 'badHeader'
      | 'unsupported'
      | 'wrongPassphrase'
      | 'corrupt',
    message: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

/* ------------------------------------------------------------------ base64 */

/**
 * Base64 without Node's Buffer or the browser's atob.
 *
 * React Native has `global.btoa` only sometimes, and Hermes has no Buffer at
 * all. Two dozen lines is cheaper than a polyfill package, and this runs on
 * whole-archive-sized inputs where a wrong answer would be silent.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const length = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(length);
  let position = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      (B64.indexOf(clean[i + 2] ?? 'A') << 6) |
      B64.indexOf(clean[i + 3] ?? 'A');
    if (position < length) out[position++] = (n >> 16) & 255;
    if (position < length) out[position++] = (n >> 8) & 255;
    if (position < length) out[position++] = n & 255;
  }
  return out;
}

/* --------------------------------------------------------------------- key */

/**
 * Stretch a passphrase into a key.
 *
 * Exposed separately from `encrypt`/`decrypt` so a caller can derive once and
 * reuse: this is the expensive step by design, and running it on every
 * automatic backup would put a second of CPU in the way of opening the app.
 */
export function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_ITERATIONS,
): Uint8Array {
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new VaultError('unsupported', `Refusing ${iterations} PBKDF2 iterations.`);
  }
  return pbkdf2(sha256, passphrase.normalize('NFKC'), salt, { c: iterations, dkLen: KEY_BYTES });
}

/**
 * Passphrases are typed on a phone keyboard, and the same passphrase can
 * arrive as different bytes depending on how the keyboard composes accents.
 * NFKC above is what stops "café" failing to open "café".
 */

/* ---------------------------------------------------------------- envelope */

export interface Sealed {
  header: VaultHeader;
  text: string;
}

/**
 * Encrypt `plaintext` and return the whole container as text.
 *
 * `randomBytes` is injected so tests can be deterministic; production passes
 * `expo-crypto`'s CSPRNG. It is never defaulted to `Math.random` — a default
 * that silently produces a weak nonce is worse than a missing argument.
 */
export function seal(
  plaintext: Uint8Array,
  key: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  randomBytes: (n: number) => Uint8Array,
): string {
  const nonce = randomBytes(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) {
    throw new VaultError('corrupt', `Nonce must be ${NONCE_BYTES} bytes.`);
  }
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  const header: VaultHeader = {
    kdf: KDF,
    iterations,
    salt: toBase64(salt),
    nonce: toBase64(nonce),
    cipher: CIPHER,
  };
  return `${VAULT_MAGIC}\n${JSON.stringify(header)}\n${toBase64(ciphertext)}`;
}

/** Cheap check before doing anything expensive: is this one of ours? */
export function looksEncrypted(text: string): boolean {
  return text.startsWith(VAULT_MAGIC);
}

/**
 * Read the header without decrypting.
 *
 * Needed on its own because the salt and iteration count live in the file, and
 * deriving the key requires them before there is any way to know whether the
 * passphrase is right.
 */
export function readHeader(text: string): VaultHeader {
  if (!looksEncrypted(text)) {
    throw new VaultError('notEncrypted', 'Not an encrypted backup.');
  }
  const lines = text.split('\n');
  if (lines.length < 3) throw new VaultError('badHeader', 'Truncated container.');

  let header: unknown;
  try {
    header = JSON.parse(lines[1]!);
  } catch {
    throw new VaultError('badHeader', 'Header is not valid JSON.');
  }
  if (typeof header !== 'object' || header === null) {
    throw new VaultError('badHeader', 'Header is not an object.');
  }

  const h = header as Record<string, unknown>;
  if (h.kdf !== KDF || h.cipher !== CIPHER) {
    // A newer version of the app may add algorithms. An older one meeting a
    // newer file should say so rather than guess.
    throw new VaultError(
      'unsupported',
      `This backup uses ${String(h.cipher)} / ${String(h.kdf)}, which this version cannot read.`,
    );
  }
  const iterations = Number(h.iterations);
  if (
    !Number.isFinite(iterations) ||
    iterations < MIN_ITERATIONS ||
    iterations > MAX_ITERATIONS
  ) {
    throw new VaultError('unsupported', `Header asks for ${String(h.iterations)} iterations.`);
  }
  if (typeof h.salt !== 'string' || typeof h.nonce !== 'string') {
    throw new VaultError('badHeader', 'Salt or nonce missing.');
  }

  return { kdf: KDF, cipher: CIPHER, iterations, salt: h.salt, nonce: h.nonce };
}

/**
 * Decrypt a container with an already-derived key.
 *
 * A failure here is almost always a wrong passphrase, and it is reported as
 * such — but it can also be a truncated upload or a flipped bit, and the two
 * are indistinguishable from the outside because Poly1305 only ever says
 * "this does not authenticate". Saying "wrong passphrase, or the file is
 * damaged" is the honest version, and it is what stops someone concluding they
 * have forgotten a passphrase they remember perfectly well.
 */
export function openWithKey(text: string, key: Uint8Array): Uint8Array {
  const header = readHeader(text);
  const body = text.split('\n').slice(2).join('');
  const nonce = fromBase64(header.nonce);
  if (nonce.length !== NONCE_BYTES) throw new VaultError('badHeader', 'Nonce is the wrong size.');

  try {
    return xchacha20poly1305(key, nonce).decrypt(fromBase64(body));
  } catch {
    throw new VaultError('wrongPassphrase', 'Wrong passphrase, or the backup is damaged.');
  }
}

/** Derive and decrypt in one go, for a one-off restore. */
export function open(text: string, passphrase: string): Uint8Array {
  const header = readHeader(text);
  const key = deriveKey(passphrase, fromBase64(header.salt), header.iterations);
  return openWithKey(text, key);
}

/* ---------------------------------------------------------------- strength */

export type PassphraseVerdict = 'tooShort' | 'weak' | 'fair' | 'strong';

/**
 * A rough verdict on a passphrase, for the UI.
 *
 * Deliberately not a percentage bar. This encrypts something with no recovery
 * path, so the only useful messages are "too short to accept" and "this could
 * be better" — a green bar at 80% implies a precision nobody has.
 *
 * Twelve characters is the floor. Below that, PBKDF2 at any iteration count is
 * not enough against someone with the file and a GPU.
 */
export function judgePassphrase(value: string): PassphraseVerdict {
  const text = value.normalize('NFKC');
  if (text.length < 12) return 'tooShort';

  const classes =
    Number(/[a-z]/.test(text)) +
    Number(/[A-Z]/.test(text)) +
    Number(/[0-9]/.test(text)) +
    Number(/[^A-Za-z0-9]/.test(text));
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  // A four-word phrase is genuinely strong and easy to remember, and it would
  // score badly on a naive character-class check — so words count too.
  if (words >= 4 || text.length >= 20) return 'strong';
  if (classes >= 3 || text.length >= 16) return 'fair';
  return 'weak';
}

export { SALT_BYTES, NONCE_BYTES, KEY_BYTES, MIN_ITERATIONS, MAX_ITERATIONS };
