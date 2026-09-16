import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_ITERATIONS,
  VAULT_MAGIC,
  VaultError,
  deriveKey,
  fromBase64,
  judgePassphrase,
  looksEncrypted,
  open,
  openWithKey,
  readHeader,
  seal,
  toBase64,
} from '../vault';

/** Deterministic "randomness", so a ciphertext is reproducible in a test. */
const fakeRandom = (seed: number) => (n: number) =>
  Uint8Array.from({ length: n }, (_, i) => (seed + i * 7) & 255);

const SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
const TEXT = new TextEncoder().encode('{"transactions":[{"amountMinor":-45000}]}');

/** 210,000 PBKDF2 rounds per call is slow; derive once and share. */
const KEY = deriveKey('correct horse battery staple', SALT, DEFAULT_ITERATIONS);

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 255, 1000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 31) & 255);
      expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('pads the way everyone else does', () => {
    // Checked against the canonical RFC 4648 vectors, because a base64 that is
    // subtly its own dialect produces a backup only this app can read.
    expect(toBase64(new TextEncoder().encode('f'))).toBe('Zg==');
    expect(toBase64(new TextEncoder().encode('fo'))).toBe('Zm8=');
    expect(toBase64(new TextEncoder().encode('foo'))).toBe('Zm9v');
    expect(toBase64(new TextEncoder().encode('foobar'))).toBe('Zm9vYmFy');
  });

  it('decodes what other encoders produce', () => {
    expect(new TextDecoder().decode(fromBase64('Zm9vYmFy'))).toBe('foobar');
    expect(new TextDecoder().decode(fromBase64('Zg=='))).toBe('f');
  });

  it('ignores newlines a mail client might have inserted', () => {
    expect(new TextDecoder().decode(fromBase64('Zm9v\nYmFy'))).toBe('foobar');
  });
});

describe('seal and open', () => {
  const sealed = seal(TEXT, KEY, SALT, DEFAULT_ITERATIONS, fakeRandom(9));

  it('produces a container that announces itself', () => {
    expect(sealed.startsWith(VAULT_MAGIC)).toBe(true);
    expect(looksEncrypted(sealed)).toBe(true);
    expect(sealed.split('\n')).toHaveLength(3);
  });

  it('does not leave the plaintext anywhere in the file', () => {
    expect(sealed).not.toContain('transactions');
    expect(sealed).not.toContain('45000');
  });

  it('round-trips with the same key', () => {
    expect(new TextDecoder().decode(openWithKey(sealed, KEY))).toBe(
      new TextDecoder().decode(TEXT),
    );
  });

  it('round-trips from the passphrase alone, reading the header for salt', () => {
    expect(new TextDecoder().decode(open(sealed, 'correct horse battery staple'))).toBe(
      new TextDecoder().decode(TEXT),
    );
  });

  it('refuses the wrong passphrase rather than returning rubbish', () => {
    expect(() => open(sealed, 'nearly the right one')).toThrow(VaultError);
    try {
      open(sealed, 'nearly the right one');
    } catch (e) {
      expect((e as VaultError).code).toBe('wrongPassphrase');
    }
  });

  it('writes a different ciphertext each time, because the nonce changes', () => {
    const again = seal(TEXT, KEY, SALT, DEFAULT_ITERATIONS, fakeRandom(200));
    expect(again).not.toBe(sealed);
    // Both still open. Different bytes, same contents.
    expect(new TextDecoder().decode(openWithKey(again, KEY))).toBe(
      new TextDecoder().decode(TEXT),
    );
  });

  it('refuses a random source that returns the wrong number of bytes', () => {
    expect(() => seal(TEXT, KEY, SALT, DEFAULT_ITERATIONS, () => new Uint8Array(8))).toThrow(
      VaultError,
    );
  });

  it('handles an empty payload', () => {
    const empty = seal(new Uint8Array(0), KEY, SALT, DEFAULT_ITERATIONS, fakeRandom(1));
    expect(openWithKey(empty, KEY)).toHaveLength(0);
  });

  it('survives non-Latin content, which is most of this app', () => {
    const payload = new TextEncoder().encode('{"note":"किराया · الإيجار · ₹"}');
    const box = seal(payload, KEY, SALT, DEFAULT_ITERATIONS, fakeRandom(3));
    expect(new TextDecoder().decode(openWithKey(box, KEY))).toBe(
      '{"note":"किराया · الإيجار · ₹"}',
    );
  });
});

describe('tamper detection', () => {
  const sealed = seal(TEXT, KEY, SALT, DEFAULT_ITERATIONS, fakeRandom(42));

  it('rejects a single flipped character in the ciphertext', () => {
    const lines = sealed.split('\n');
    const body = lines[2]!;
    const flipped = (body[10] === 'A' ? 'B' : 'A') + body.slice(1);
    const tampered = [lines[0], lines[1], body.slice(0, 10) + flipped.slice(0, 1) + body.slice(11)].join('\n');
    expect(() => openWithKey(tampered, KEY)).toThrow(VaultError);
  });

  it('rejects a truncated file', () => {
    const lines = sealed.split('\n');
    const cut = [lines[0], lines[1], lines[2]!.slice(0, lines[2]!.length - 20)].join('\n');
    expect(() => openWithKey(cut, KEY)).toThrow(VaultError);
  });

  it('rejects a swapped nonce', () => {
    const other = seal(TEXT, KEY, SALT, DEFAULT_ITERATIONS, fakeRandom(77));
    const mine = sealed.split('\n');
    const theirs = other.split('\n');
    expect(() => openWithKey([mine[0], theirs[1], mine[2]].join('\n'), KEY)).toThrow(VaultError);
  });
});

describe('readHeader', () => {
  const sealed = seal(TEXT, KEY, SALT, DEFAULT_ITERATIONS, fakeRandom(5));

  it('reads back what seal wrote', () => {
    const header = readHeader(sealed);
    expect(header.kdf).toBe('pbkdf2-sha256');
    expect(header.cipher).toBe('xchacha20-poly1305');
    expect(header.iterations).toBe(DEFAULT_ITERATIONS);
    expect(Array.from(fromBase64(header.salt))).toEqual(Array.from(SALT));
  });

  it('says plainly when a file is not encrypted at all', () => {
    // The ordinary path: an old plaintext backup being restored after the
    // feature was switched on.
    try {
      readHeader('{"transactions":[]}');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as VaultError).code).toBe('notEncrypted');
    }
  });

  it('rejects a header that is not JSON', () => {
    try {
      readHeader(`${VAULT_MAGIC}\nnot json\nAAAA`);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as VaultError).code).toBe('badHeader');
    }
  });

  it('rejects an algorithm it does not know, rather than guessing', () => {
    const header = JSON.stringify({
      kdf: 'pbkdf2-sha256',
      cipher: 'aes-256-gcm',
      iterations: 210000,
      salt: 'AAAA',
      nonce: 'AAAA',
    });
    try {
      readHeader(`${VAULT_MAGIC}\n${header}\nAAAA`);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as VaultError).code).toBe('unsupported');
    }
  });

  it('refuses an iteration count low enough to be brute-forced', () => {
    // A forged header could otherwise ask for one round and turn the
    // passphrase into a single hash.
    const header = JSON.stringify({
      kdf: 'pbkdf2-sha256',
      cipher: 'xchacha20-poly1305',
      iterations: 1,
      salt: 'AAAA',
      nonce: 'AAAA',
    });
    try {
      readHeader(`${VAULT_MAGIC}\n${header}\nAAAA`);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as VaultError).code).toBe('unsupported');
    }
  });

  it('refuses an absurd iteration count that would freeze the app', () => {
    const header = JSON.stringify({
      kdf: 'pbkdf2-sha256',
      cipher: 'xchacha20-poly1305',
      iterations: 999_000_000,
      salt: 'AAAA',
      nonce: 'AAAA',
    });
    expect(() => readHeader(`${VAULT_MAGIC}\n${header}\nAAAA`)).toThrow(VaultError);
  });

  it('rejects a truncated container', () => {
    expect(() => readHeader(`${VAULT_MAGIC}\n{}`)).toThrow(VaultError);
  });
});

describe('deriveKey', () => {
  it('is deterministic for the same passphrase and salt', () => {
    const a = deriveKey('hunter2hunter2', SALT, 60_000);
    const b = deriveKey('hunter2hunter2', SALT, 60_000);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a).toHaveLength(32);
  });

  it('gives a different key for a different salt', () => {
    const a = deriveKey('hunter2hunter2', SALT, 60_000);
    const b = deriveKey('hunter2hunter2', new Uint8Array(16).fill(9), 60_000);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('treats differently composed but identical text as the same passphrase', () => {
    // "café" typed with a combining accent versus a precomposed é. Without
    // NFKC these are different byte strings and the backup will not open.
    const precomposed = deriveKey('café is my passphrase', SALT, 60_000);
    const combining = deriveKey('café is my passphrase', SALT, 60_000);
    expect(Array.from(precomposed)).toEqual(Array.from(combining));
  });

  it('refuses a weakened iteration count', () => {
    expect(() => deriveKey('x'.repeat(12), SALT, 10)).toThrow(VaultError);
  });
});

describe('judgePassphrase', () => {
  it('rejects anything under twelve characters', () => {
    expect(judgePassphrase('short')).toBe('tooShort');
    expect(judgePassphrase('elevenchars')).toBe('tooShort');
    expect(judgePassphrase('twelvechars!')).not.toBe('tooShort');
  });

  it('rates a four-word phrase strong even though it is all lower case', () => {
    expect(judgePassphrase('correct horse battery staple')).toBe('strong');
  });

  it('rates a long string strong', () => {
    expect(judgePassphrase('aaaaaaaaaaaaaaaaaaaaaa')).toBe('strong');
  });

  it('rates a mixed medium-length string fair', () => {
    expect(judgePassphrase('Passw0rd!xyz')).toBe('fair');
  });

  it('rates twelve plain lower-case letters weak', () => {
    expect(judgePassphrase('abcdefghijkl')).toBe('weak');
  });
});
