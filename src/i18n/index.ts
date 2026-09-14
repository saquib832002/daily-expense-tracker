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
import { useEffect, useState } from 'react';
import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';

import type { DateOrder } from '@/domain/dateOrder';
import { setFormattingLocale } from '@/domain/currencies';
import { deviceDateOrder, formattingLocaleFor } from '@/services/region';

import ar from './ar.json';
import en from './en.json';
import hi from './hi.json';
import ur from './ur.json';

export type LanguageCode = 'en' | 'hi' | 'ur' | 'ar';

const RESOURCES: Record<LanguageCode, Record<string, string>> = { en, hi, ur, ar };

/** Native names, because a language list nobody can read is not a list. */
export const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ur', label: 'اردو' },
  { code: 'ar', label: 'العربية' },
];

/** Languages written right to left. */
const RTL: ReadonlySet<LanguageCode> = new Set<LanguageCode>(['ur', 'ar']);

export function isRTL(code: LanguageCode = current): boolean {
  return RTL.has(code);
}

/**
 * Should the whole interface be mirrored for right-to-left languages?
 *
 * **Off by default, deliberately, and that is a reversal of the original
 * design.** Mirroring is what a native Arabic or Urdu app does and it is the
 * more correct thing in principle. In practice it stranded this app twice in
 * testing, and the failure is far worse than the thing it fixes:
 *
 *   Android fixes layout direction when the PROCESS starts. So every change
 *   here lands one launch late — and in between, the words say one thing while
 *   the layout says another. Tabs run backwards, "back" points forward, and
 *   nothing about the screen explains why. Worse, the state survives a rebuild,
 *   because `forceRTL` is written to SharedPreferences and an app update does
 *   not clear them. Someone who tried Arabic once can find an English build
 *   mirrored days later with no obvious way out.
 *
 * An Arabic interface that is NOT mirrored is merely less idiomatic: the text
 * still reads right-to-left inside every label, because Unicode handles that on
 * its own, and every button still works. An English interface that IS mirrored
 * is broken. Between a small loss of polish and a broken app, the default has
 * to be the one that cannot break.
 *
 * So it is a setting, off unless asked for, and the code below always states
 * the direction it wants rather than only correcting a mismatch — which is what
 * guarantees the next launch escapes a stuck state however it was reached.
 */
let mirrorRTL = false;

export function mirrorIsOn(): boolean {
  return mirrorRTL;
}

export function setMirrorRTL(on: boolean): void {
  mirrorRTL = on;
}

/** Should the layout be mirrored, given both the language and the setting? */
export function wantsMirror(code: LanguageCode = current): boolean {
  return mirrorRTL && isRTL(code);
}

/**
 * Will this change of language or setting only take hold after a restart?
 *
 * Android will not change layout direction in a running process, so the answer
 * is yes whenever the direction we want differs from the one we have.
 */
export function needsRestartFor(code: LanguageCode = current): boolean {
  return I18nManager.isRTL !== wantsMirror(code);
}

/**
 * Is the layout currently mirrored when it should not be, or the reverse?
 *
 * The banner keyed off this stays up until a cold start resolves it, because a
 * one-time alert at the moment of switching is no help to someone who notices
 * the tabs have reversed an hour later and three screens away.
 */
export function directionMismatch(): boolean {
  return needsRestartFor(current);
}

/** True when the layout is mirrored right now, whatever the language says. */
export function layoutIsRTL(): boolean {
  return I18nManager.isRTL;
}

/**
 * State the direction we want, every launch, unconditionally.
 *
 * The earlier version only acted when it detected a mismatch, which sounds
 * thriftier and is the reason a stuck mirrored state could persist: if nothing
 * ever calls `forceRTL(false)`, nothing ever clears the flag Android wrote the
 * day someone tried Arabic. Saying "left to right" out loud on every launch
 * costs nothing and means the next launch is always correct.
 */
export function applyDirection(code: LanguageCode = current): void {
  const want = wantsMirror(code);
  I18nManager.allowRTL(want);
  I18nManager.forceRTL(want);
}

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
  const changed = code !== current;
  current = code;
  // Set every time, not only on a change: the very first call at boot usually
  // picks the language that is already current, and the formatting locale still
  // has to be established. Currencies outside the hand-picked list are grouped
  // with the user's own locale, so this is what makes them right.
  setFormattingLocale(dateLocale());
  if (changed) listeners.forEach((fn) => fn());
}

export function onLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Re-render this component when the language changes.
 *
 * Until this existed, `onLanguageChange` had no subscribers at all — the whole
 * notification mechanism was dead code, and the app appeared to translate only
 * by luck. `t()` reads the current language at call time, so a screen picks up
 * the new words the next time it happens to render, and navigating between
 * tabs renders them often enough that almost everything looked right.
 *
 * Almost. The tab bar is mounted once, above every screen, and nothing ever
 * invalidated it — so `tab.home`, `tab.history`, `tab.add`, `tab.budget` and
 * `tab.more` kept whatever language the app started in, for the life of the
 * process. Anything else rendered high in the tree and never re-mounted had
 * the same problem waiting.
 *
 * Calling this hook anywhere makes that subtree honest about language changes
 * rather than dependent on navigation happening to refresh it.
 */
export function useLanguage(): LanguageCode {
  const [, force] = useState(current);
  useEffect(() => onLanguageChange(() => force(current)), []);
  return current;
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

/**
 * The locale to hand Intl for dates: the chosen LANGUAGE, spoken in the
 * device's REGION.
 *
 * These are two different questions and this function used to answer only the
 * first, mapping every language to one hardcoded country — English meant
 * `en-IN`, so an American running the app in English was told their dates were
 * day-first. That is not a preference, it is a wrong answer, and it is how a
 * receipt dated 9/3 in Ohio came out as 9 March.
 *
 * The words come from the language the user picked. The order of the numbers,
 * the month names' case, the grouping — all of that comes from the country
 * their phone is set to. Someone running the app in Hindi on a US phone gets
 * Hindi month names in American order, which is what they asked for twice over.
 *
 * Two extensions ride along on every locale, both deliberate:
 *
 *   `nu-latn`    keeps dates in 0-9, matching the amounts and the keypad.
 *                Left alone, `ur-IN` renders ۹ ستمبر ۲۰۲۶ while `ur-PK` renders
 *                9 ستمبر 2026 — same language, different digits, decided by a
 *                region code the user never chose.
 *   `ca-gregory` pins the calendar. Some ICU builds default `ar-SA` to the
 *                Islamic calendar, which would silently restate every
 *                transaction date in Hijri — an expense tracker showing a date
 *                that does not match the receipt is worse than useless.
 */
export function dateLocale(): string {
  return formattingLocaleFor(current);
}

/**
 * How this user's country writes a numeric date: 31/12, 12/31 or 2026/12/31.
 *
 * Taken from the phone's own locale rather than from `dateLocale()`, because
 * only the phone's tag is guaranteed to carry its country's conventions. See
 * the note on `deviceDateOrder`.
 */
export function dateOrder(): DateOrder {
  return deviceDateOrder();
}

/**
 * Does this user's country write the day before the month?
 *
 * The scanner's fallback for a genuinely ambiguous receipt date. Asked of ICU
 * via the device's region, so it is right in every country without anyone
 * maintaining a table of them.
 */
export function prefersDayFirst(): boolean {
  return deviceDateOrder() === 'dmy';
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
