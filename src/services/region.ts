/**
 * Where the phone thinks it is, and what that implies.
 *
 * The app used to answer both of these from a sixteen-line table written by
 * hand — `IN → INR`, `US → USD`, and INR for everywhere else on earth. For an
 * app going worldwide that is not a default, it is a wrong answer for about a
 * hundred and eighty countries.
 *
 * Android already knows all of it. `expo-localization` hands over the region
 * the user set, the currency for that region, and the full ISO 4217 list, and
 * ICU supplies the date order. Nothing here needs maintaining when a country
 * changes its money.
 *
 * Everything is read once and cached: these do not change while the app is
 * open, and `getLocales()` crosses the native bridge.
 */
import { getLocales, isoCurrencyCodes } from 'expo-localization';

import { KNOWN_CURRENCIES } from '@/domain/currencies';
import { dateOrderFor, type DateOrder } from '@/domain/dateOrder';

export interface DeviceRegion {
  /** ISO 3166 country, e.g. 'IN', 'US', 'AE'. Null when the OS won't say. */
  code: string | null;
  /** ISO 4217 currency the OS associates with that region. */
  currency: string | null;
  /** Full BCP 47 tag, e.g. 'en-US'. */
  languageTag: string;
}

let cached: DeviceRegion | null = null;

/**
 * Read the device's region.
 *
 * `regionCode` is documented as possibly null on Android, so the language tag
 * is the fallback: `en-US` still carries the country even when the dedicated
 * field is empty.
 */
export function deviceRegion(): DeviceRegion {
  if (cached) return cached;

  let region: DeviceRegion = { code: null, currency: null, languageTag: 'en' };
  try {
    const first = getLocales()[0];
    if (first) {
      const fromTag = first.languageTag?.split('-').find((p) => /^[A-Z]{2}$/.test(p)) ?? null;
      region = {
        code: first.regionCode ?? fromTag,
        currency: first.currencyCode ?? null,
        languageTag: first.languageTag ?? 'en',
      };
    }
  } catch {
    // No native module (a JS-only test run, or an old build). The defaults
    // above are deliberately neutral rather than Indian.
  }

  cached = region;
  return region;
}

/**
 * The currency to start someone off with.
 *
 * Asks the OS first, because it knows the answer for every country. The tiny
 * map below is not a substitute for that — it only covers the case where the
 * OS gives a region but no currency, which happens on some Android builds.
 */
const REGION_FALLBACK: Record<string, string> = {
  IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', SG: 'SGD', AU: 'AUD', CA: 'CAD',
  JP: 'JPY', SA: 'SAR', QA: 'QAR', KW: 'KWD', OM: 'OMR', BH: 'BHD', PK: 'PKR',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', IE: 'EUR',
};

export function deviceCurrency(): string {
  const { currency, code } = deviceRegion();
  if (currency && /^[A-Z]{3}$/i.test(currency)) return currency.toUpperCase();
  if (code && REGION_FALLBACK[code]) return REGION_FALLBACK[code]!;
  return 'USD';
}

/**
 * The locale to format numbers and dates with: the user's chosen language
 * spoken in the region their phone is set to.
 *
 * This pairing is the whole point. Someone running the app in Hindi on a US
 * phone gets Hindi month names in American order, which is what they asked for
 * twice over. Digits are pinned to 0-9 and the calendar to Gregorian for the
 * reasons set out in the i18n module.
 */
export function formattingLocaleFor(language: string): string {
  const { code } = deviceRegion();
  const base = code ? `${language}-${code}` : language;
  return `${base}-u-ca-gregory-nu-latn`;
}

/**
 * How this device's country writes a numeric date.
 *
 * Asked of the phone's OWN locale tag — `en-US`, `de-DE`, `pt-BR` — and not of
 * a tag assembled from the user's chosen language plus their region. That
 * distinction was found by a test, and it matters:
 *
 *   `hi-US` does not mean "Hindi, American conventions". ICU has no such
 *   locale, so it falls back to plain `hi` and answers day-first — the Indian
 *   convention, for a phone sitting in Ohio. `en-DE` behaves the same way in
 *   reverse, falling back to `en` and claiming month-first for Germany. The
 *   Unicode regional-override extension (`-u-rg-uszzzz`) is the documented cure
 *   and is simply ignored by the ICU builds in play here.
 *
 * The device's own tag has none of that ambiguity: it is the locale the
 * operating system is itself formatting with, so ICU is guaranteed to hold
 * real data for it. Whatever the phone thinks 9/3 means, so does the scanner.
 */
export function deviceDateOrder(): DateOrder {
  return dateOrderFor(deviceRegion().languageTag);
}

/**
 * Every currency code the OS knows, for the picker.
 *
 * Three sources, tried in order, because the picker is now the only way to set
 * a currency and a short list is a wrong answer for most of the planet:
 *
 *   1. `expo-localization`, which reads the platform's own ISO list.
 *   2. ICU through `Intl.supportedValuesOf`, for the Hermes builds where the
 *      first comes back empty. Newer than Hermes' Intl in places, hence the
 *      feature test rather than a plain call.
 *   3. The fifteen hand-tuned currencies, as a floor.
 *
 * Falling back to the shortlist is a limitation; falling back to nothing is a
 * broken screen, and that is the one outcome ruled out here.
 */
export function allCurrencyCodes(): string[] {
  try {
    const codes = isoCurrencyCodes;
    if (Array.isArray(codes) && codes.length > 0) {
      return [...new Set(codes.map((c) => c.toUpperCase()))].sort();
    }
  } catch {
    // fall through
  }

  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    const codes = supported?.('currency');
    if (Array.isArray(codes) && codes.length > 0) {
      return [...new Set(codes.map((c) => c.toUpperCase()))].sort();
    }
  } catch {
    // fall through
  }

  return Object.keys(KNOWN_CURRENCIES).sort();
}

/** Test seam — lets a screen re-read after the OS locale changes. */
export function forgetRegion(): void {
  cached = null;
}
