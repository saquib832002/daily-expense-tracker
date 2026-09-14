/**
 * Reading text off a photo, on the device.
 *
 * Google's ML Kit, running entirely offline: no upload, no API key, no per-scan
 * cost, and it works on a train with no signal. The picture never leaves the
 * phone — which is the only reason photographing a receipt is an acceptable
 * thing to ask of someone.
 *
 * **This returns positions, not just text, and that is the whole point.**
 * `visionText.getText()` concatenates blocks in reading order, and on a till
 * receipt the labels and the amounts are usually separate blocks — so the plain
 * text comes back as "TOTAL / SUB TOTAL / CASH" followed later by
 * "405.46 / 349.00 / 500.00", with every number divorced from its label. Any
 * parser working on that string is guessing. With each line's bounding box we
 * can rebuild the rows the way they are printed on the paper.
 *
 * **Availability is checked against the NATIVE module, not the JS wrapper.**
 * The wrapper always exports a `recognize` function; when the native side is
 * missing it throws only when you call it. Checking the wrapper therefore says
 * "available" on a build that cannot possibly scan.
 */
import { NativeModules } from 'react-native';

/** One line of recognised text, with where it sits on the image. */
export interface OcrLine {
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface OcrResult {
  /** ML Kit's own concatenation. Kept for display and for a last-ditch parse. */
  text: string;
  lines: OcrLine[];
}

/** Thrown when the app binary predates the scanner. */
export const OCR_UNAVAILABLE = 'ocrUnavailable';

/** True only when this build actually contains the ML Kit native module. */
export function isOcrAvailable(): boolean {
  return NativeModules.TextRecognition != null;
}

interface RawFrame {
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}
interface RawLine {
  text?: string;
  frame?: RawFrame;
}
interface RawBlock {
  lines?: RawLine[];
}
interface RawResult {
  text?: string;
  blocks?: RawBlock[];
}

function loadApi(): { recognize: (uri: string, script?: string) => Promise<RawResult> } | null {
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
 * Flatten blocks into lines, keeping each line's box.
 *
 * A line with no frame still comes through — some devices omit it — with a
 * synthetic position that preserves reading order, so the row rebuilder
 * degrades to "one line per row" rather than losing the text entirely.
 */
function toLines(result: RawResult): OcrLine[] {
  const out: OcrLine[] = [];
  let fallbackTop = 0;

  for (const block of result.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const text = (line.text ?? '').trim();
      if (!text) continue;

      const f = line.frame;
      if (f && typeof f.top === 'number' && typeof f.height === 'number') {
        out.push({
          text,
          top: f.top,
          left: f.left ?? 0,
          width: f.width ?? 0,
          height: f.height,
        });
      } else {
        fallbackTop += 100;
        out.push({ text, top: fallbackTop, left: 0, width: 0, height: 20 });
      }
    }
  }
  return out;
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

  let result: RawResult;
  try {
    result = await api.recognize(uri, 'Latin');
  } catch (e) {
    if (isLinkingError(e)) throw new Error(OCR_UNAVAILABLE);
    throw e;
  }

  if ((result?.text ?? '').replace(/\s/g, '').length < 20) {
    try {
      const deva = await api.recognize(uri, 'Devanagari');
      if ((deva?.text ?? '').length > (result?.text ?? '').length) result = deva;
    } catch {
      // Devanagari model missing or failed — keep whatever Latin found.
    }
  }

  return { text: result?.text ?? '', lines: toLines(result ?? {}) };
}
