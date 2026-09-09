/**
 * Writing files out and reading them back in.
 *
 * Everything goes through the system share sheet rather than writing to a
 * fixed folder, so the user decides where their data lands — Drive, WhatsApp
 * to themselves, a cable to a PC. The app never needs storage permissions and
 * never touches anything it did not create.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}`;
}

export function suggestedName(prefix: string, extension: string): string {
  return `${prefix}-${stamp()}.${extension}`;
}

/**
 * Write text to the app's cache and hand it to the share sheet.
 * Cache, not documents: once shared it is the user's copy that matters, and
 * cache gets cleaned up by the OS rather than accumulating forever.
 */
export async function shareText(
  filename: string,
  contents: string,
  mimeType: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const uri = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, contents, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: 'sharingUnavailable' };
    }

    await Sharing.shareAsync(uri, { mimeType, UTI: mimeType });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Hand a file that already exists on disk to the share sheet.
 *
 * Used for the SQLite copy, which is bytes rather than text and is far too big
 * to be worth reading into memory just to write it out again.
 */
export async function shareExistingFile(
  uri: string,
  mimeType: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: 'sharingUnavailable' };
    }
    await Sharing.shareAsync(uri, { mimeType, UTI: mimeType });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Let the user pick a file and return where it landed. Null means cancelled. */
export async function pickFile(
  types: string[] = ['*/*'],
): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: types,
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) return null;
  return { uri: asset.uri, name: asset.name ?? 'backup' };
}

/** Let the user pick a file and return its text. Null means they cancelled. */
export async function pickTextFile(
  types: string[] = ['application/json', 'text/csv', 'text/comma-separated-values', 'text/plain', '*/*'],
): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: types,
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) return null;

  return FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}
