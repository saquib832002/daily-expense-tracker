import { describe, expect, it } from '@jest/globals';

import {
  canEncodeCode128,
  ean13CheckDigit,
  encode,
  encodeCode128,
  encodeEan13,
  guessSymbology,
  isValidEan13,
  symbologyFor,
} from '../barcode';

describe('EAN-13 check digit', () => {
  /** Known-good numbers, so the arithmetic is pinned to reality. */
  it('computes the digit every scanner agrees on', () => {
    expect(ean13CheckDigit('590123412345')).toBe(7);
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(ean13CheckDigit('978014300723')).toBe(4);
  });

  it('validates a complete number', () => {
    expect(isValidEan13('5901234123457')).toBe(true);
    expect(isValidEan13('9780143007234')).toBe(true);
  });

  it('rejects a number with the wrong check digit', () => {
    expect(isValidEan13('5901234123450')).toBe(false);
  });

  it('rejects anything that is not thirteen digits', () => {
    expect(isValidEan13('590123412345')).toBe(false);
    expect(isValidEan13('59012341234578')).toBe(false);
    expect(isValidEan13('590123412345X')).toBe(false);
  });
});

describe('EAN-13 encoding', () => {
  const widths = encodeEan13('5901234123457');

  /** 95 modules exactly: 3 + 42 + 5 + 42 + 3. A symbol of any other width is wrong. */
  it('is 95 modules wide', () => {
    expect(widths.reduce((a, b) => a + b, 0)).toBe(95);
  });

  it('starts and ends with the guard bars', () => {
    expect(widths.slice(0, 3)).toEqual([1, 1, 1]);
    expect(widths.slice(-3)).toEqual([1, 1, 1]);
  });

  it('adds the check digit to a twelve-digit number', () => {
    expect(encodeEan13('590123412345')).toEqual(widths);
  });

  /**
   * Silently "fixing" a wrong check digit would produce a barcode that scans as
   * a different card — the worst possible outcome at a till.
   */
  it('refuses a thirteen-digit number whose check digit is wrong', () => {
    expect(() => encodeEan13('5901234123450')).toThrow();
  });

  it('ignores spaces and dashes', () => {
    expect(encodeEan13('5901234-123457')).toEqual(widths);
  });
});

describe('Code 128', () => {
  it('accepts printable ASCII and refuses the rest', () => {
    expect(canEncodeCode128('ABC-123')).toBe(true);
    expect(canEncodeCode128('')).toBe(false);
    expect(canEncodeCode128('tea	break')).toBe(false);
    expect(canEncodeCode128('café')).toBe(false);
  });

  /**
   * Start + data + checksum + stop, each six modules, plus the stop pattern's
   * extra bar. For "ABC" that is (1 + 3 + 1 + 1) × 6 + 1 = 37.
   */
  it('is the right length', () => {
    expect(encodeCode128('ABC').reduce((a, b) => a + b, 0) > 0).toBe(true);
    expect(encodeCode128('ABC')).toHaveLength(6 * 6 + 1);
    expect(encodeCode128('123456')).toHaveLength(9 * 6 + 1);
  });

  it('starts with the set B start pattern', () => {
    // Symbol 104 is START B, '211214'. (103 is START A and 105 START C —
    // an off-by-one here is a symbol no scanner reads.)
    expect(encodeCode128('ABC').slice(0, 6)).toEqual([2, 1, 1, 2, 1, 4]);
  });

  it('ends with the stop pattern and its extra bar', () => {
    // Symbol 106 is '233111', then the trailing 2.
    expect(encodeCode128('ABC').slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  /** Changing one character has to change the checksum, or it is not one. */
  it('produces a different symbol for a different value', () => {
    expect(encodeCode128('ABC')).not.toEqual(encodeCode128('ABD'));
  });

  it('refuses what it cannot draw', () => {
    expect(() => encodeCode128('café')).toThrow();
  });
});

describe('symbology', () => {
  it('maps what the camera reports', () => {
    expect(symbologyFor('ean13')).toBe('ean13');
    expect(symbologyFor('EAN-13')).toBe('ean13');
    expect(symbologyFor('code128')).toBe('code128');
    expect(symbologyFor('qr')).toBe('qr');
    expect(symbologyFor('pdf417')).toBe('unknown');
    expect(symbologyFor(undefined)).toBe('unknown');
  });

  it('guesses sensibly for a number typed in by hand', () => {
    expect(guessSymbology('5901234123457')).toBe('ean13');
    expect(guessSymbology('LOYAL-99321')).toBe('code128');
    expect(guessSymbology('café')).toBe('unknown');
  });

  /** A thirteen-digit number with a bad check digit is not an EAN. */
  it('does not call a broken thirteen-digit number an EAN', () => {
    expect(guessSymbology('5901234123450')).toBe('code128');
  });
});

describe('encode', () => {
  it('returns null rather than throwing for what it cannot draw', () => {
    expect(encode('anything', 'qr')).toBeNull();
    expect(encode('5901234123450', 'ean13')).toBeNull();
    expect(encode('café', 'code128')).toBeNull();
  });

  it('draws what it can', () => {
    expect(encode('5901234123457', 'ean13')).toHaveLength(59);
    expect(encode('ABC', 'code128')).toHaveLength(37);
  });
});
