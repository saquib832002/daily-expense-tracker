/**
 * Warranties: the arithmetic and the judgement.
 *
 * The feature is a list of things you own and the dates their cover runs out.
 * Almost all of the value is in one question — *is this still under warranty,
 * and for how much longer* — so that question is a pure function here, tested,
 * rather than an expression buried in a screen.
 *
 * Two decisions worth stating up front, because both look like corners cut:
 *
 * **The last day counts.** A two-year warranty bought on 3 September 2024
 * expires on 3 September 2026, and it is still valid *on* that day — walk into
 * the shop that morning and they will honour it. So the comparison everywhere
 * is against the end of the expiry day, not the instant. Off-by-one here is
 * not a rounding error; it is telling someone their television is out of cover
 * when it is not.
 *
 * **"Expiring soon" is thirty days.** Long enough to actually do something —
 * book a service visit, find the receipt, argue with a call centre — and short
 * enough that the warning still feels like news. Anything longer and the amber
 * section becomes a second list of everything you own.
 */
import { addMonths, daysBetween, endOfDay, startOfDay } from './dates';

/** Lengths offered as one tap in the form. Everything else is typed. */
export const MONTH_PRESETS = [6, 12, 18, 24, 36, 60] as const;

/** How long before expiry a warranty starts showing as "expiring soon". */
export const SOON_DAYS = 30;

export type WarrantyStatus = 'active' | 'soon' | 'expired';

/** The subset of a warranty row this module needs. Keeps the tests honest. */
export interface WarrantyLike {
  id: string;
  productName: string;
  brand: string | null;
  retailer: string | null;
  serial: string | null;
  notes: string | null;
  purchasedOn: number;
  expiresOn: number;
}

/**
 * When cover runs out, given when it started and how many months it lasts.
 *
 * Delegates the month arithmetic to `addMonths`, which clamps — so a phone
 * bought on 31 January with a one-month warranty expires on 28 February, not
 * on 3 March. Normalised to the *end* of that day for the reason above.
 */
export function expiryOf(purchasedOn: number, months: number): number {
  return endOfDay(addMonths(startOfDay(purchasedOn), months));
}

/**
 * Whole days of cover remaining. 0 means it runs out today — still covered.
 * Negative means it has already gone.
 */
export function daysLeft(expiresOn: number, now: number = Date.now()): number {
  return daysBetween(now, expiresOn);
}

export function statusOf(
  expiresOn: number,
  now: number = Date.now(),
  soonDays: number = SOON_DAYS,
): WarrantyStatus {
  if (now > endOfDay(expiresOn)) return 'expired';
  return daysLeft(expiresOn, now) <= soonDays ? 'soon' : 'active';
}

/** Still claimable today? The question the whole screen exists to answer. */
export function isCovered(expiresOn: number, now: number = Date.now()): boolean {
  return statusOf(expiresOn, now) !== 'expired';
}

export interface Grouped<T> {
  /** Running out inside the next thirty days. Soonest first — act on these. */
  soon: T[];
  /** Comfortably in cover. Soonest first, so the list stays a countdown. */
  active: T[];
  /** Gone. Most recently expired first: the older it is, the less it matters. */
  expired: T[];
}

/**
 * Split a list into the three things a person actually wants to see.
 *
 * Sort order differs per group on purpose. Future dates read best as a
 * countdown — the next one to worry about at the top — while past dates read
 * best as a history, newest first. Using one sort for both would bury either
 * the urgent item or the recent one.
 */
export function groupByStatus<T extends { expiresOn: number }>(
  items: T[],
  now: number = Date.now(),
  soonDays: number = SOON_DAYS,
): Grouped<T> {
  const out: Grouped<T> = { soon: [], active: [], expired: [] };

  for (const item of items) {
    out[statusOf(item.expiresOn, now, soonDays)].push(item);
  }

  out.soon.sort((a, b) => a.expiresOn - b.expiresOn);
  out.active.sort((a, b) => a.expiresOn - b.expiresOn);
  out.expired.sort((a, b) => b.expiresOn - a.expiresOn);
  return out;
}

/**
 * Free-text search across the fields somebody would actually remember.
 *
 * Serial numbers are included and matched case-insensitively on a substring,
 * because the realistic use is standing in a shop reading the last few digits
 * off a sticker.
 */
export function matches(item: WarrantyLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  return [item.productName, item.brand, item.retailer, item.serial, item.notes]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .some((v) => v.toLowerCase().includes(q));
}

/**
 * How much of the cover has been used, 0 to 1, for the little bar on each row.
 *
 * Clamped at both ends: a purchase date in the future (someone mistyped the
 * year) must not produce a negative bar, and an expired warranty sits at a
 * full one rather than running off the end.
 */
export function coverUsed(
  purchasedOn: number,
  expiresOn: number,
  now: number = Date.now(),
): number {
  const span = expiresOn - purchasedOn;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (now - purchasedOn) / span));
}
