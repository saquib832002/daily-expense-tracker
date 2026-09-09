import { describe, expect, it } from '@jest/globals';
import {
  formatMinor,
  minorToDecimalString,
  parseAmountToMinor,
  percentOfMinor,
  splitEvenly,
  sumMinor,
} from '../money';

describe('parseAmountToMinor', () => {
  it('parses whole rupees', () => {
    expect(parseAmountToMinor('120', 'INR')).toBe(12000);
  });

  it('parses paise', () => {
    expect(parseAmountToMinor('12.35', 'INR')).toBe(1235);
    expect(parseAmountToMinor('0.05', 'INR')).toBe(5);
    expect(parseAmountToMinor('.5', 'INR')).toBe(50);
  });

  it('does not lose a paisa to floating point', () => {
    // 12.35 * 100 is 1234.9999999999998 in JavaScript. This must not be 1234.
    expect(parseAmountToMinor('12.35', 'INR')).toBe(1235);
    expect(parseAmountToMinor('1.005', 'INR')).toBe(101); // rounds half-up
    expect(parseAmountToMinor('8.115', 'INR')).toBe(812);
  });

  it('rounds extra decimals half-up', () => {
    expect(parseAmountToMinor('10.994', 'INR')).toBe(1099);
    expect(parseAmountToMinor('10.995', 'INR')).toBe(1100);
    expect(parseAmountToMinor('0.999', 'INR')).toBe(100);
  });

  it('strips grouping separators and spaces', () => {
    expect(parseAmountToMinor('1,23,456.78', 'INR')).toBe(12345678);
    expect(parseAmountToMinor(' 250 ', 'INR')).toBe(25000);
  });

  it('respects per-currency decimals', () => {
    expect(parseAmountToMinor('120', 'JPY')).toBe(120);
    expect(parseAmountToMinor('12.5', 'JPY')).toBe(13);
    expect(parseAmountToMinor('12.4', 'JPY')).toBe(12);
    expect(parseAmountToMinor('1.234', 'KWD')).toBe(1234);
  });

  it('handles negatives', () => {
    expect(parseAmountToMinor('-45.50', 'INR')).toBe(-4550);
  });

  it('rejects junk', () => {
    expect(parseAmountToMinor('', 'INR')).toBeNull();
    expect(parseAmountToMinor('.', 'INR')).toBeNull();
    expect(parseAmountToMinor('-', 'INR')).toBeNull();
    expect(parseAmountToMinor('1.2.3', 'INR')).toBeNull();
    expect(parseAmountToMinor('abc', 'INR')).toBeNull();
  });
});

describe('minorToDecimalString', () => {
  it('round-trips', () => {
    expect(minorToDecimalString(1235, 'INR')).toBe('12.35');
    expect(minorToDecimalString(5, 'INR')).toBe('0.05');
    expect(minorToDecimalString(0, 'INR')).toBe('0.00');
    expect(minorToDecimalString(-4550, 'INR')).toBe('-45.50');
    expect(minorToDecimalString(120, 'JPY')).toBe('120');
  });
});

describe('formatMinor', () => {
  it('uses Indian grouping for rupees', () => {
    // ₹1,23,456.00 — not ₹123,456.00, which reads as broken to Indian users.
    const out = formatMinor(12345600, 'INR');
    expect(out).toContain('1,23,456');
  });

  it('uses western grouping for dollars', () => {
    expect(formatMinor(12345600, 'USD')).toContain('123,456');
  });

  it('drops .00 in compact mode', () => {
    expect(formatMinor(25000, 'INR', { compact: true })).not.toContain('.00');
    expect(formatMinor(25050, 'INR', { compact: true })).toContain('.50');
  });

  it('marks negatives and optional positives', () => {
    expect(formatMinor(-25000, 'INR')).toMatch(/^-/);
    expect(formatMinor(25000, 'INR', { signed: true })).toMatch(/^\+/);
  });
});

describe('sumMinor', () => {
  it('is exact over many rows', () => {
    const rows = Array.from({ length: 1000 }, () => 1); // 1000 x 1 paisa
    expect(sumMinor(rows)).toBe(1000);
  });
});

describe('splitEvenly', () => {
  it('never loses a paisa', () => {
    const parts = splitEvenly(1000, 3); // ₹10 across three people
    expect(parts).toEqual([334, 333, 333]);
    expect(sumMinor(parts)).toBe(1000);
  });

  it('handles exact division', () => {
    expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
  });

  it('handles negatives', () => {
    const parts = splitEvenly(-1000, 3);
    expect(sumMinor(parts)).toBe(-1000);
  });

  it('returns nothing for zero parts', () => {
    expect(splitEvenly(1000, 0)).toEqual([]);
  });
});

describe('percentOfMinor', () => {
  it('rounds half-up', () => {
    expect(percentOfMinor(1000, 60)).toBe(600);
    expect(percentOfMinor(333, 50)).toBe(167);
  });
});
