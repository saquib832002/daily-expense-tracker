/**
 * Reading text off a photo, on the device.
 *
 * Google's ML Kit, running entirely offline: no upload, no API key, no per-scan
 * cost, and it works on a train with no signal. The picture never leaves the
 * phone — which is the only reason photographing a receipt is an acceptable
 * thing to ask of someone.
 *
 * **Availability is checked against the NATIVE module, not the JS wrapper.**
 * The wrapper always exports a `recognize` function; when the native side is
 * missing it throws only when you call it. Checking the wrapper therefore says
 * "available" on a build that cannot possibly scan, and the user is told their
 * photo was unreadable when the real answer is "you have not rebuilt the app".
 * That mistake cost real debugging time, hence the loud comment.
 */
import { NativeModules } from 'react-native';

export interface OcrResult {
  text: string;
  lines: string[];
}

/** Thrown when the app binary predates the scanner. */
export const OCR_UNAVAILABLE = 'ocrUnavailable';

/** True only when this build actually contains the ML Kit native module. */
export function isOcrAvailable(): boolean {
  return NativeModules.TextRecognition != null;
}

function loadApi(): { recognize: (uri: string, script?: string) => Promise<{ text: string }> } | null {
  if (!isOcrAvailable()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-ml-kit/text-recognition');
    const api = mod?.default ?? mod;
    return typeof api?.recognize === 'function' ? api : null;
  } catch {
    return null;
  }
}

function isLinkingError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /doesn't seem to be linked|native module|NativeModule/i.test(message);
}

/**
 * Read a receipt.
 *
 * Latin first, because even a Hindi shop prints its numbers in Latin digits
 * and Latin is the faster model. If that comes back with almost nothing, the
 * receipt is probably Devanagari, so try again — one wasted pass on a rare
 * receipt beats never reading it at all.
 */
export async function readImage(uri: string): Promise<OcrResult> {
  const api = loadApi();
  if (!api) throw new Error(OCR_UNAVAILABLE);

  let text = '';
  try {
    const latin = await api.recognize(uri, 'Latin');
    text = latin?.text ?? '';
  } catch (e) {
    if (isLinkingError(e)) throw new Error(OCR_UNAVAILABLE);
    throw e;
  }

  if (text.replace(/\s/g, '').length < 20) {
    try {
      const deva = await api.recognize(uri, 'Devanagari');
      if ((deva?.text ?? '').length > text.length) text = deva.text;
    } catch {
      // Devanagari model missing or failed — keep whatever Latin found.
    }
  }

  return {
    text,
    lines: text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  };
}
