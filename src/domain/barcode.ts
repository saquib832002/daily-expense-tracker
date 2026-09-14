/**
 * Barcodes, as numbers rather than pictures.
 *
 * A loyalty card is only useful in the app if the shop's scanner can read it
 * off the screen, which means the app has to *draw* the barcode, not just store
 * the digits. That needs an encoder, and an encoder is exactly the kind of
 * thing that is either right or silently, expensively wrong: a barcode with one
 * bad module still looks like a barcode, and you find out at the till.
 *
 * So the encoding lives here as pure functions over strings, with the check
 * digits and the known-good examples pinned in tests, and the screen does
 * nothing but paint the widths it is handed.
 *
 * No library. `jsbarcode` and friends draw into a canvas or a DOM, neither of
 * which exists here, and the two symbologies that matter for loyalty cards are
 * a hundred lines between them.
 *
 * **Output shape.** Every encoder returns a list of bar widths in modules,
 * starting with a black bar and alternating — `[2,1,1,3,…]` means two modules
 * black, one white, one black, three white. That is the smallest thing a
 * renderer can consume, and it makes the tests readable.
 */

export type Symbology = 'code128' | 'ean13' | 'qr' | 'unknown';

/** What the camera hands back, mapped to what this module can draw. */
export function symbologyFor(raw: string | undefined): Symbology {
  switch ((raw ?? '').toLowerCase()) {
    case 'code128':
    case 'code-128':
      return 'code128';
    case 'ean13':
    case 'ean-13':
    case 'ean_13':
      return 'ean13';
    case 'qr':
    case 'qrcode':
    case 'qr-code':
      return 'qr';
    default:
      return 'unknown';
  }
}

/* ------------------------------------------------------------------ EAN-13 */

/** Which digits are encoded with the odd/even L/G pattern, by first digit. */
const EAN_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/** 7-module patterns, as bit strings. Right-hand side is the L set inverted. */
const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

/**
 * The thirteenth digit of an EAN-13, computed from the first twelve.
 *
 * Alternating weights of 1 and 3 from the left, then the difference to the next
 * multiple of ten. Worth having on its own because it is also how you check a
 * number somebody typed in by hand.
 */
export function ean13CheckDigit(twelve: string): number {
  const digits = twelve.slice(0, 12).split('').map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value) === Number(value[12]);
}

/**
 * Encode a 12- or 13-digit number as EAN-13 bar widths.
 * A 12-digit input gets its check digit added; a 13-digit one must already be
 * correct, because silently "fixing" a card number would produce a barcode that
 * scans as a different card.
 */
export function encodeEan13(value: string): number[] {
  const digits = value.replace(/\D/g, '');
  const full =
    digits.length === 12 ? digits + String(ean13CheckDigit(digits)) : digits;

  if (!isValidEan13(full)) throw new Error('badEan13');

  const parity = EAN_PARITY[Number(full[0])]!;
  let bits = '101'; // start guard

  for (let i = 1; i <= 6; i += 1) {
    const set = parity[i - 1] === 'L' ? EAN_L : EAN_G;
    bits += set[Number(full[i])]!;
  }
  bits += '01010'; // centre guard

  for (let i = 7; i <= 12; i += 1) {
    // Right-hand digits are the L pattern inverted, which is what makes the
    // symbol readable upside down.
    bits += invert(EAN_L[Number(full[i])]!);
  }
  bits += '101'; // end guard

  return bitsToWidths(bits);
}

function invert(bits: string): string {
  return bits.replace(/[01]/g, (b) => (b === '0' ? '1' : '0'));
}

/* ---------------------------------------------------------------- Code 128 */

/**
 * Code 128 set B, which covers every printable ASCII character — the right
 * choice for loyalty numbers that mix letters and digits. Set C would pack
 * digit pairs more tightly, and is not worth the extra failure mode here.
 *
 * Each entry is the six-element width pattern for one symbol, in modules.
 */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '233111',
];

const CODE128_START_B = 104;
const CODE128_STOP = 106;

/** Can every character be drawn? Set B covers ASCII 32–126. */
export function canEncodeCode128(value: string): boolean {
  return value.length > 0 && [...value].every((c) => {
    const code = c.charCodeAt(0);
    return code >= 32 && code <= 126;
  });
}

/**
 * Encode a string as Code 128 set B bar widths.
 *
 * The checksum is the weighted sum of the symbol values — start code, then each
 * character multiplied by its position — modulo 103. Get it wrong and most
 * scanners simply refuse to beep, which is at least a loud failure.
 */
export function encodeCode128(value: string): number[] {
  if (!canEncodeCode128(value)) throw new Error('badCode128');

  const symbols: number[] = [CODE128_START_B];
  for (const char of value) symbols.push(char.charCodeAt(0) - 32);

  let checksum = CODE128_START_B;
  for (let i = 1; i < symbols.length; i += 1) checksum += symbols[i]! * i;
  symbols.push(checksum % 103);
  symbols.push(CODE128_STOP);

  const widths: number[] = [];
  for (const symbol of symbols) {
    const pattern = CODE128_PATTERNS[symbol];
    if (!pattern) throw new Error('badCode128');
    for (const width of pattern) widths.push(Number(width));
  }

  // The stop pattern carries a seventh bar. Without it the symbol is truncated
  // and nothing reads it.
  widths.push(2);
  return widths;
}

/* ------------------------------------------------------------------ shared */

/** `"1011001"` → `[1, 1, 2, 2, 1]`, starting black. */
function bitsToWidths(bits: string): number[] {
  const widths: number[] = [];
  let current = '1';
  let run = 0;

  for (const bit of bits) {
    if (bit === current) {
      run += 1;
    } else {
      widths.push(run);
      current = bit;
      run = 1;
    }
  }
  widths.push(run);
  return widths;
}

/**
 * Widths for whatever this value is, or null when it cannot be drawn.
 *
 * Null is a real answer, not a failure: a QR payload or a membership number
 * with no scannable form still belongs in the app as text somebody can read out
 * at the counter.
 */
export function encode(value: string, symbology: Symbology): number[] | null {
  try {
    if (symbology === 'ean13') return encodeEan13(value);
    if (symbology === 'code128') return encodeCode128(value);
    return null;
  } catch {
    return null;
  }
}

/**
 * Best guess at how to draw a number nobody told us the symbology of — a card
 * typed in by hand rather than scanned.
 */
export function guessSymbology(value: string): Symbology {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 13 && isValidEan13(digits)) return 'ean13';
  if (digits.length === 12 && digits === value) return 'ean13';
  return canEncodeCode128(value) ? 'code128' : 'unknown';
}
