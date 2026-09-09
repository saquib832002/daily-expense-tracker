/**
 * Translation, without a dependency.
 *
 * Two languages, simple interpolation, and a device-locale default is all this
 * app needs, and forty lines is cheaper than a library plus a version to keep
 * aligned with the Expo SDK. If pluralization rules get complicated later,
 * this can be swapped for i18next without touching a single call site.
 *
 * Adding a language = adding one JSON file and one line in LANGUAGES.
 */
import { getLocales } from 'expo-localization';

import en from './en.json';
import hi from './hi.json';

export type LanguageCode = 'en' | 'hi';

const RESOURCES: Record<LanguageCode, Record<string, string>> = { en, hi };

export const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
];

let current: LanguageCode = 'en';
const listeners = new Set<() => void>();

/** Pick the device's language if we have it, otherwise English. */
export function detectLanguage(): LanguageCode {
  const tag = getLocales()[0]?.languageCode ?? 'en';
  return tag in RESOURCES ? (tag as LanguageCode) : 'en';
}

export function getLanguage(): LanguageCode {
  return current;
}

export function setLanguage(code: LanguageCode) {
  if (code === current) return;
  current = code;
  listeners.forEach((fn) => fn());
}

export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Look up a string. Falls back to English, then to the key itself — a missing
 * translation should look obviously wrong in development, never blank.
 *
 *   t('home.remaining')
 *   t('budget.pace', { spent: '78', elapsed: '60' })
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = RESOURCES[current][key] ?? RESOURCES.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{{${name}}}`,
  );
}

/** The locale to hand Intl for dates. Money formatting uses the currency's own. */
export function dateLocale(): string {
  return current === 'hi' ? 'hi-IN' : 'en-IN';
}

export function formatDate(epochMs: number, style: 'short' | 'long' = 'short'): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { day: 'numeric', month: 'long', year: 'numeric' }
      : { day: 'numeric', month: 'short' };
  try {
    return new Intl.DateTimeFormat(dateLocale(), options).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toDateString();
  }
}
