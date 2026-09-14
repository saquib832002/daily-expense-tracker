/**
 * The claim being tested: this app now handles every currency in the world
 * without anyone maintaining a list of them. If that is true, currencies
 * nobody wrote down must come out with the right precision and the right
 * symbol — because precision is what a stored integer MEANS.
 */
import { describe, expect, it } from '@jest/globals';

import { currencyName, infoFor, isoDecimals, isoSymbol } from '../currencies';
import { formatMinor, parseAmountToMinor } from '../money';

describe('isoDecimals', () => {
  it('knows the two-decimal majority', () => {
    for (const code of ['INR', 'USD', 'EUR', 'GBP', 'BRL', 'ZAR', 'THB', 'MXN']) {
      expect(isoDecimals(code)).toBe(2);
    }
  });

  it('knows the whole-unit currencies', () => {
    // Get this wrong and ¥1,000 is stored and shown as ¥10.
    expect(isoDecimals('JPY')).toBe(0);
    expect(isoDecimals('KRW')).toBe(0);
    expect(isoDecimals('VND')).toBe(0);
  });

  it('knows the three-decimal currencies', () => {
    // The Gulf dinars divide into 1000. Two decimals would lose money on
    // every single entry.
    expect(isoDecimals('KWD')).toBe(3);
    expect(isoDecimals('BHD')).toBe(3);
    expect(isoDecimals('OMR')).toBe(3);
    expect(isoDecimals('TND')).toBe(3);
    expect(isoDecimals('JOD')).toBe(3);
  });

  it('falls back to two decimals for something that is not a currency', () => {
    expect(isoDecimals('ZZZ')).toBe(2);
    expect(isoDecimals('')).toBe(2);
  });

  it('is case-insensitive, because codes arrive from everywhere', () => {
    expect(isoDecimals('kwd')).toBe(3);
    expect(isoDecimals('jpy')).toBe(0);
  });
});

describe('isoSymbol', () => {
  it('finds symbols for currencies nobody listed', () => {
    expect(isoSymbol('BRL', 'en-US')).toBe('R$');
    expect(isoSymbol('KRW', 'en-US')).toBe('₩');
    expect(isoSymbol('ILS', 'en-US')).toBe('₪');
  });

  it('returns the code itself rather than nothing when there is no symbol', () => {
    expect(isoSymbol('ZZZ', 'en-US')).toBe('ZZZ');
  });
});

describe('infoFor', () => {
  it('keeps the hand-picked grouping locale for listed currencies', () => {
    // Indian users read ₹1,23,456. That is a decision, not a lookup, so it
    // stays written down.
    expect(infoFor('INR').locale).toContain('en-IN');
    expect(infoFor('JPY').decimals).toBe(0);
  });

  it('answers for unlisted currencies instead of refusing', () => {
    const brl = infoFor('BRL');
    expect(brl.decimals).toBe(2);
    expect(brl.symbol).toBe('R$');

    const jod = infoFor('JOD');
    expect(jod.decimals).toBe(3);
  });
});

describe('money maths on currencies nobody listed', () => {
  it('parses and stores a three-decimal dinar at full precision', () => {
    // 12.345 JOD is 12345 fils. At two decimals this would silently become
    // 12.35 and the difference would never show up anywhere.
    expect(parseAmountToMinor('12.345', 'JOD')).toBe(12345);
    expect(parseAmountToMinor('12.3456', 'JOD')).toBe(12346);
  });

  it('parses a whole-unit currency without inventing subunits', () => {
    expect(parseAmountToMinor('1000', 'KRW')).toBe(1000);
    expect(parseAmountToMinor('1000.4', 'KRW')).toBe(1000);
    expect(parseAmountToMinor('1000.5', 'KRW')).toBe(1001);
  });

  it('formats an unlisted currency with its own symbol and precision', () => {
    expect(formatMinor(123456, 'BRL', { locale: 'pt-BR' })).toContain('1.234,56');
    expect(formatMinor(1000, 'KRW', { locale: 'en-US' })).toContain('1,000');
    expect(formatMinor(12345, 'JOD', { locale: 'en-US' })).toContain('12.345');
  });
});

describe('currencyName', () => {
  it('gives a readable name, or the code if the runtime cannot', () => {
    // Intl.DisplayNames is the one part of Intl some Hermes builds omit, so
    // this only has to be non-empty and never throw.
    const name = currencyName('BRL', 'en-US');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });
});
