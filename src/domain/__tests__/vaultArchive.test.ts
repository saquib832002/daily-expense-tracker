/**
 * The encrypted backup, end to end, against a real ZIP.
 *
 * The unit tests in `vault.test.ts` prove the cipher round-trips a string.
 * They would all still pass if the *archive* path were broken — if the bytes
 * were mangled on the way in, or if the "is this file encrypted?" check on the
 * restore side never fired. That check is the dangerous one: get it wrong in
 * the false direction and a perfectly good encrypted backup is fed to JSZip as
 * a ZIP and reported to the user as corrupt.
 *
 * So this builds an actual archive — JSON plus a binary receipt — seals it,
 * writes it out the way the file layer does, reads it back the way the restore
 * path does, and checks the data survives. It lives under `domain/` only
 * because that is where the test runner looks; what it covers is the seam in
 * `db/backupZip.ts`.
 */
import { describe, expect, it } from '@jest/globals';
import JSZip from 'jszip';

import { DEFAULT_ITERATIONS, deriveKey, fromBase64, looksEncrypted, open, seal, toBase64 } from '../vault';

const SALT = Uint8Array.from({ length: 16 }, (_, i) => (i * 11) & 255);
const KEY = deriveKey('a passphrase with several words', SALT, DEFAULT_ITERATIONS);
const nonce = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 13 + 5) & 255);

/** Stand-in for a real backup: the ledger, plus one binary receipt. */
async function buildArchive(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'backup.json',
    JSON.stringify({
      transactions: Array.from({ length: 200 }, (_, i) => ({
        id: `tx${i}`,
        amountMinor: -((i * 137) % 90000),
        merchant: `दुकान ${i}`,
      })),
    }),
  );
  // Bytes that are not valid UTF-8, which is the whole point: a receipt photo
  // will not survive being treated as text anywhere along this path.
  zip.file('receipts/a.jpg', Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255));
  return (await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  })) as Uint8Array;
}

/** What `FileSystem.readAsStringAsync(uri, { encoding: Base64 })` returns. */
function asFileBase64(text: string): string {
  return toBase64(new TextEncoder().encode(text));
}

describe('encrypted archive round trip', () => {
  it('survives seal, write, read and unseal with the data intact', async () => {
    const archive = await buildArchive();
    const container = seal(archive, KEY, SALT, DEFAULT_ITERATIONS, nonce);

    // The file layer writes the container as UTF-8 and reads it back as base64.
    const opened = open(new TextDecoder().decode(fromBase64(asFileBase64(container))),
      'a passphrase with several words');

    const zip = await JSZip.loadAsync(opened);
    const json = JSON.parse(await zip.file('backup.json')!.async('string'));
    expect(json.transactions).toHaveLength(200);
    expect(json.transactions[199].merchant).toBe('दुकान 199');

    const receipt = await zip.file('receipts/a.jpg')!.async('uint8array');
    expect(receipt).toHaveLength(5000);
    expect(receipt[4999]).toBe((4999 * 7) & 255);
  });

  it('detects an encrypted archive from the first 64 base64 characters', async () => {
    // This is exactly the cheap check the restore path does before deciding
    // whether to decrypt or to hand the bytes straight to JSZip.
    const container = seal(await buildArchive(), KEY, SALT, DEFAULT_ITERATIONS, nonce);
    const fileBase64 = asFileBase64(container);
    const prefix = new TextDecoder().decode(fromBase64(fileBase64.slice(0, 64)));
    expect(looksEncrypted(prefix)).toBe(true);
  });

  it('does not mistake a plain ZIP for an encrypted one', async () => {
    // The false positive that would break every existing unencrypted backup.
    const plain = toBase64(await buildArchive());
    const prefix = new TextDecoder().decode(fromBase64(plain.slice(0, 64)));
    expect(looksEncrypted(prefix)).toBe(false);
  });

  it('leaves no readable merchant name anywhere in the sealed file', async () => {
    const container = seal(await buildArchive(), KEY, SALT, DEFAULT_ITERATIONS, nonce);
    expect(container).not.toContain('दुकान');
    expect(container).not.toContain('backup.json');
    // Only the header and the magic are readable, and neither says anything
    // about the contents.
    expect(container.split('\n')[0]).toBe('EXPENSETRACKER-ENCRYPTED-1');
  });

  it('refuses the wrong passphrase on a real archive', async () => {
    const container = seal(await buildArchive(), KEY, SALT, DEFAULT_ITERATIONS, nonce);
    expect(() => open(container, 'a passphrase with several word')).toThrow();
  });
});
