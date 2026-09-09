/**
 * Dates.
 *
 * Date maths is the other place — after money — where quiet bugs cost a user
 * their trust in the app. A transaction that lands on the wrong day puts it in
 * the wrong month, which puts it in the wrong budget.
 *
 * Everything here works in LOCAL time, because a person recording lunch thinks
 * in their own day, not UTC. Pure functions, no React, no database.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/**
 * Add days by calendar, not by arithmetic.
 * `ms + 24h` is wrong across a DST boundary; setDate is not.
 */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  // Clamp: 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
  const lastDay = daysInMonth(d.getFullYear(), d.getMonth());
  d.setDate(Math.min(day, lastDay));
  return d.getTime();
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Whole days between two instants, by calendar day. Positive when b is later. */
export function daysBetween(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

/**
 * A translation key for a day relative to now, or null when it needs a real
 * date. Returning a key rather than a string keeps this testable and keeps
 * Hindi working.
 */
export function relativeDayKey(ms: number, now: number = Date.now()): string | null {
  const diff = daysBetween(now, ms);
  if (diff === 0) return 'common.today';
  if (diff === -1) return 'common.yesterday';
  return null;
}

export interface QuickDate {
  /** Translation key, or null when `label` should be used directly. */
  key: string | null;
  label: string | null;
  ms: number;
}

/**
 * The date choices offered on the add screen: today, yesterday, then the three
 * days before that. Almost nobody records something older than that by hand,
 * and the full calendar is one tap away for when they do.
 */
export function quickDates(now: number = Date.now()): QuickDate[] {
  const out: QuickDate[] = [
    { key: 'common.today', label: null, ms: startOfDay(now) },
    { key: 'common.yesterday', label: null, ms: startOfDay(addDays(now, -1)) },
  ];
  for (let i = 2; i <= 4; i++) {
    const ms = startOfDay(addDays(now, -i));
    out.push({ key: null, label: String(new Date(ms).getDate()), ms });
  }
  return out;
}

/**
 * A month laid out as calendar weeks. Cells outside the month are null, so a
 * grid renderer never has to think about padding.
 *
 * @param weekStartsOn 0 = Sunday (the Indian convention), 1 = Monday.
 */
export function monthGrid(
  year: number,
  monthIndex: number,
  weekStartsOn: 0 | 1 = 0,
): (number | null)[][] {
  const total = daysInMonth(year, monthIndex);
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const lead = (firstWeekday - weekStartsOn + 7) % 7;

  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Clamp a date to no later than today — you cannot spend money in the future. */
export function notInFuture(ms: number, now: number = Date.now()): number {
  return ms > now ? now : ms;
}
