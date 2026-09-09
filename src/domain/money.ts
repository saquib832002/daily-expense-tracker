/**
 * Money.
 *
 * Every amount in this app is an INTEGER number of minor units — paise for INR,
 * cents for USD. Never a float. `0.1 + 0.2 !== 0.3` is exactly how expense
 * trackers end up a rupee off, and users notice immediately.
 *
 * Nothing in this file touches React, the database, or the network. That is
 * deliberate: this is the code where bugs actually hurt, so it must be trivial
 * to test.
 */

export type CurrencyCode = string;

interface CurrencyInfo {
  decimals: number;
  symbol: string;
  /** Locale used for grouping. India groups as 1,23,456 — not 123,456. */
  locale: string;
}

/** Currencies we ship with. Anything unlisted falls back to 2 decimals. */
export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  INR: { decimals: 2, symbol: '₹', locale: 'en-IN' },
  USD: { decimals: 2, symbol: '$', locale: 'en-US' },
  EUR: { decimals: 2, symbol: '€', locale: 'de-DE' },
  GBP: { decimals: 2, symbol: '£', locale: 'en-GB' },
  AED: { decimals: 2, symbol: 'د.إ', locale: 'ar-AE' },
  SGD: { decimals: 2, symbol: 'S$', locale: 'en-SG' },
  AUD: { decimals: 2, symbol: 'A$', locale: 'en-AU' },
  CAD: { decimals: 2, symbol: 'C$', locale: 'en-CA' },
  JPY: { decimals: 0, symbol: '¥', locale: 'ja-JP' },
  KWD: { decimals: 3, symbol: 'د.ك', locale: 'ar-KW' },
};

const FALLBACK: CurrencyInfo = { decimals: 2, symbol: '', locale: 'en-US' };

export function currencyInfo(code: CurrencyCode): CurrencyInfo {
  return CURRENCIES[code.toUpperCase()] ?? FALLBACK;
}

export function decimalsFor(code: CurrencyCode): number {
  return currencyInfo(code).decimals;
}

/**
 * Parse what a person typed on the keypad into minor units.
 *
 * Done by string manipulation, never by multiplying a float — `12.35 * 100`
 * is 1234.9999999999998 in JavaScript, which rounds to the wrong paise often
 * enough to matter.
 *
 * Returns null when the input isn't a usable number.
 */
export function parseAmountToMinor(input: string, currency: CurrencyCode): number | null {
  if (input == null) return null;

  // Keep digits, one decimal separator, and a leading minus.
  const cleaned = input
    .trim()
    .replace(/[\s,  ]/g, '') // spaces and thousands separators
    .replace(/[^\d.\-]/g, '');

  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;

  const negative = cleaned.startsWith('-');
  const unsigned = negative ? cleaned.slice(1) : cleaned;

  const parts = unsigned.split('.');
  if (parts.length > 2) return null;

  // `|| '0'` covers both an empty whole part ('.5') and, under
  // noUncheckedIndexedAccess, the possibility of an undefined index.
  const whole = parts[0] || '0';
  const fracRaw = parts[1] ?? '';

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fracRaw)) return null;

  const decimals = decimalsFor(currency);

  // Pad or round the fractional part to the currency's precision.
  let frac: string;
  if (fracRaw.length <= decimals) {
    frac = fracRaw.padEnd(decimals, '0');
  } else {
    // Round half-up on the first dropped digit.
    const keep = fracRaw.slice(0, decimals);
    const nextDigit = Number(fracRaw[decimals] ?? '0');
    frac = keep;
    if (nextDigit >= 5) {
      const bumped = (BigInt(whole + keep) + 1n).toString().padStart(keep.length + 1, '0');
      const value = Number(bumped);
      return negative ? -value : value;
    }
  }

  const value = Number(whole + frac);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** Minor units → a plain decimal string, e.g. 123456 INR → "1234.56". */
export function minorToDecimalString(minor: number, currency: CurrencyCode): string {
  const decimals = decimalsFor(currency);
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor)).toString().padStart(decimals + 1, '0');
  const whole = abs.slice(0, abs.length - decimals) || '0';
  const frac = decimals > 0 ? '.' + abs.slice(abs.length - decimals) : '';
  return (negative ? '-' : '') + whole + frac;
}

export interface FormatOptions {
  /** Drop ".00" when the amount is whole. Good for dense list rows. */
  compact?: boolean;
  /** Omit the currency symbol entirely. */
  noSymbol?: boolean;
  /** Force a leading + on positive amounts (income rows). */
  signed?: boolean;
  /** Override the locale used for grouping. Defaults to the currency's. */
  locale?: string;
}

/**
 * Minor units → a display string with correct grouping for the currency.
 * INR uses Indian grouping: ₹1,23,456.00, not ₹123,456.00.
 */
export function formatMinor(
  minor: number,
  currency: CurrencyCode,
  options: FormatOptions = {},
): string {
  const info = currencyInfo(currency);
  const locale = options.locale ?? info.locale;
  const value = Number(minorToDecimalString(minor, currency));

  const isWhole = minor % Math.pow(10, info.decimals) === 0;
  const fractionDigits = options.compact && isWhole ? 0 : info.decimals;

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(locale, {
      style: options.noSymbol ? 'decimal' : 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(Math.abs(value));
  } catch {
    // Unknown currency code, or an environment without full ICU.
    formatted =
      (options.noSymbol ? '' : info.symbol) +
      Math.abs(value).toFixed(fractionDigits);
  }

  if (minor < 0) return '-' + formatted;
  if (options.signed && minor > 0) return '+' + formatted;
  return formatted;
}

/** Sum minor-unit amounts. Integers, so no accumulation error. */
export function sumMinor(amounts: number[]): number {
  let total = 0;
  for (const a of amounts) total += a;
  return total;
}

/**
 * Split an amount into n parts that add back up to exactly the original.
 * The remainder paise are handed to the first parts, one each — so ₹10 across
 * 3 people is 334 + 333 + 333, not three lots of 333 with a paisa lost.
 */
export function splitEvenly(totalMinor: number, parts: number): number[] {
  if (parts <= 0) return [];
  const sign = totalMinor < 0 ? -1 : 1;
  const abs = Math.abs(totalMinor);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/** Apply a percentage (0–100) to an amount, rounding half-up. */
export function percentOfMinor(minor: number, percent: number): number {
  return Math.round((minor * percent) / 100);
}
