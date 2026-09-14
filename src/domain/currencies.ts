/**
 * What the app knows about a currency — asked, not tabulated.
 *
 * There are about 180 currencies in circulation. Shipping a table of all of
 * them means shipping a table that is wrong the moment a country redenominates,
 * and it means an app that simply does not work for anyone whose currency the
 * author did not think of. Both of those are avoidable: every Android phone
 * carries ICU, and ICU already knows the symbol and the number of decimals for
 * every ISO 4217 code there is. So we ask it.
 *
 * A small table survives, for two honest reasons rather than laziness:
 *
 *   1. **Grouping.** ICU is asked for the symbol and the precision, but the
 *      thousands grouping comes from a locale, and ₹1,23,456 versus ₹123,456
 *      is a decision, not a lookup. The listed currencies carry the locale
 *      whose grouping their users expect.
 *   2. **A floor under a missing ICU.** If `Intl` is unavailable or throws,
 *      falling back to "two decimals" would silently turn ¥1,000 into ¥10 and
 *      1.000 KWD into 1 KWD. For the currencies most likely to be in use here,
 *      the right answer is written down.
 *
 * Everything not in that table still works completely. It is a preference
 * list, not a permission list.
 */

export type CurrencyCode = string;

export interface CurrencyInfo {
  decimals: number;
  symbol: string;
  /** Locale used for grouping and separators, not for the symbol. */
  locale: string;
}

/**
 * Currencies with a deliberate grouping locale, and a known-good precision to
 * fall back on. Also the shortlist the picker offers first.
 */
export const KNOWN_CURRENCIES: Record<string, CurrencyInfo> = {
  INR: { decimals: 2, symbol: '₹', locale: 'en-IN-u-nu-latn' },
  USD: { decimals: 2, symbol: '$', locale: 'en-US-u-nu-latn' },
  EUR: { decimals: 2, symbol: '€', locale: 'de-DE-u-nu-latn' },
  GBP: { decimals: 2, symbol: '£', locale: 'en-GB-u-nu-latn' },
  SGD: { decimals: 2, symbol: 'S$', locale: 'en-SG-u-nu-latn' },
  AUD: { decimals: 2, symbol: 'A$', locale: 'en-AU-u-nu-latn' },
  CAD: { decimals: 2, symbol: 'C$', locale: 'en-CA-u-nu-latn' },
  JPY: { decimals: 0, symbol: '¥', locale: 'ja-JP-u-nu-latn' },

  AED: { decimals: 2, symbol: 'د.إ', locale: 'ar-AE-u-nu-latn' },
  SAR: { decimals: 2, symbol: 'ر.س', locale: 'ar-SA-u-nu-latn' },
  QAR: { decimals: 2, symbol: 'ر.ق', locale: 'ar-QA-u-nu-latn' },
  KWD: { decimals: 3, symbol: 'د.ك', locale: 'ar-KW-u-nu-latn' },
  OMR: { decimals: 3, symbol: 'ر.ع.', locale: 'ar-OM-u-nu-latn' },
  BHD: { decimals: 3, symbol: 'د.ب', locale: 'ar-BH-u-nu-latn' },

  PKR: { decimals: 2, symbol: '₨', locale: 'ur-PK-u-nu-latn' },
};

/**
 * The locale used to format anything whose currency is not in the table above,
 * and to group its digits. Set once at startup from the device.
 *
 * Held here rather than imported from the localization service because this
 * file is pure domain code: it is unit-tested in plain Node, where there is no
 * device to ask.
 */
let formattingLocale = 'en-US-u-nu-latn';

export function setFormattingLocale(locale: string): void {
  formattingLocale = locale;
}

export function getFormattingLocale(): string {
  return formattingLocale;
}

/* --------------------------------------------------------------- from ICU */

const decimalCache = new Map<string, number>();
const symbolCache = new Map<string, string>();

/**
 * How many decimal places this currency divides into, according to ICU.
 *
 * Not a detail: it decides what a stored integer means. Get it wrong for a
 * three-decimal dinar and every amount is off by a factor of ten.
 */
export function isoDecimals(code: CurrencyCode): number {
  const key = code.toUpperCase();
  const hit = decimalCache.get(key);
  if (hit !== undefined) return hit;

  let decimals = 2;
  try {
    const resolved = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: key,
    }).resolvedOptions();
    if (typeof resolved.maximumFractionDigits === 'number') {
      decimals = resolved.maximumFractionDigits;
    }
  } catch {
    // Not a currency ICU recognises, or no ICU at all. Two decimals is the
    // commonest case and the least damaging guess.
  }

  decimalCache.set(key, decimals);
  return decimals;
}

/** The symbol ICU uses for this currency, or the code itself if it has none. */
export function isoSymbol(code: CurrencyCode, locale = formattingLocale): string {
  const key = `${code.toUpperCase()}|${locale}`;
  const hit = symbolCache.get(key);
  if (hit !== undefined) return hit;

  let symbol = code.toUpperCase();
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code.toUpperCase(),
    }).formatToParts(0);
    const found = parts.find((p) => p.type === 'currency')?.value;
    if (found) symbol = found;
  } catch {
    // Leave it as the code — "BRL 40" is worse than "R$40" but far better
    // than a blank space where the money should be.
  }

  symbolCache.set(key, symbol);
  return symbol;
}

/**
 * The currency's name in the user's language — "Brazilian Real", "الروبية
 * الهندية". Falls back to the code, because `Intl.DisplayNames` is the one
 * piece of Intl that some Hermes builds ship without.
 */
export function currencyName(code: CurrencyCode, locale = formattingLocale): string {
  try {
    const DisplayNames = (Intl as unknown as { DisplayNames?: typeof Intl.DisplayNames })
      .DisplayNames;
    if (!DisplayNames) return code.toUpperCase();
    return new DisplayNames([locale], { type: 'currency' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code.toUpperCase();
  }
}

/**
 * Everything the app needs to render an amount in this currency.
 * Listed currencies keep their chosen grouping; every other code in the world
 * is answered from ICU rather than refused.
 */
export function infoFor(code: CurrencyCode): CurrencyInfo {
  const key = code.toUpperCase();
  const known = KNOWN_CURRENCIES[key];
  if (known) return known;

  return {
    decimals: isoDecimals(key),
    symbol: isoSymbol(key),
    locale: formattingLocale,
  };
}
