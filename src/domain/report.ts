/**
 * Report aggregation.
 *
 * Turning rows into the shapes a chart needs — ranked breakdowns, daily and
 * monthly series, month-on-month change. Pure functions with no React, no
 * database and no formatting, so every edge case here is cheap to test.
 *
 * All amounts are integer minor units, signed the way the ledger stores them
 * (expenses negative). These helpers return POSITIVE spend figures, because a
 * chart of "where the money went" reads better upwards.
 */

import { addMonths, daysInMonth, startOfDay } from './dates';

export interface Slice {
  key: string;
  /** Positive minor units. */
  amountMinor: number;
  /** 0–1 of the total. */
  fraction: number;
}

export interface RawSlice {
  key: string;
  amountMinor: number;
}

/**
 * Sort by size, biggest first, and attach each one's share of the total.
 * Zero and negative rows are dropped — a breakdown of spending should not
 * contain a refund as a negative wedge.
 */
export function rankSlices(rows: RawSlice[]): Slice[] {
  const positive = rows
    .map((r) => ({ key: r.key, amountMinor: Math.abs(r.amountMinor) }))
    .filter((r) => r.amountMinor > 0);

  const total = positive.reduce((sum, r) => sum + r.amountMinor, 0);
  if (total === 0) return [];

  return positive
    .sort((a, b) => b.amountMinor - a.amountMinor || a.key.localeCompare(b.key))
    .map((r) => ({ ...r, fraction: r.amountMinor / total }));
}

/**
 * Keep the biggest `max` slices and fold everything else into one "other".
 *
 * A long tail of nine-rupee categories tells the reader nothing and makes the
 * chart unreadable; the fold keeps the picture honest because the total is
 * preserved exactly.
 */
export function foldTail(slices: Slice[], max: number, otherKey = '__other__'): Slice[] {
  if (max <= 0) return [];
  if (slices.length <= max) return slices;

  const head = slices.slice(0, max - 1);
  const tail = slices.slice(max - 1);
  const amountMinor = tail.reduce((sum, s) => sum + s.amountMinor, 0);
  const fraction = tail.reduce((sum, s) => sum + s.fraction, 0);

  return [...head, { key: otherKey, amountMinor, fraction }];
}

/**
 * A round number at or above `value`, for a chart's upper bound.
 * 1, 2 or 5 times a power of ten — the values people read easily.
 */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export interface SeriesPoint {
  /** Epoch ms at the start of the bucket. */
  at: number;
  /** Positive minor units spent in this bucket. */
  amountMinor: number;
}

export interface DatedAmount {
  occurredAt: number;
  amountMinor: number;
}

/**
 * One bucket per day between `from` (inclusive) and `to` (exclusive), including
 * the empty ones — a spending chart with days missing lies about the rhythm of
 * a month.
 */
export function dailySeries(rows: DatedAmount[], from: number, to: number): SeriesPoint[] {
  const buckets = new Map<number, number>();
  for (let d = startOfDay(from); d < to; d = startOfDay(d + 36 * 60 * 60 * 1000)) {
    buckets.set(d, 0);
  }
  for (const r of rows) {
    const day = startOfDay(r.occurredAt);
    if (!buckets.has(day)) continue;
    buckets.set(day, buckets.get(day)! + Math.abs(r.amountMinor));
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, amountMinor]) => ({ at, amountMinor }));
}

/**
 * One bucket per month, oldest first, ending with the month containing `now`.
 * Empty months are included for the same reason empty days are.
 */
export function monthlySeries(
  rows: DatedAmount[],
  now: number,
  months: number,
  firstDayOfMonth = 1,
): SeriesPoint[] {
  const anchor = Math.min(Math.max(Math.trunc(firstDayOfMonth), 1), 28);

  const startOfBudgetMonth = (ms: number): number => {
    const d = new Date(ms);
    const shift = d.getDate() < anchor ? -1 : 0;
    return new Date(d.getFullYear(), d.getMonth() + shift, anchor, 0, 0, 0, 0).getTime();
  };

  const buckets = new Map<number, number>();
  for (let i = months - 1; i >= 0; i--) {
    buckets.set(startOfBudgetMonth(addMonths(now, -i)), 0);
  }
  for (const r of rows) {
    const key = startOfBudgetMonth(r.occurredAt);
    if (!buckets.has(key)) continue;
    buckets.set(key, buckets.get(key)! + Math.abs(r.amountMinor));
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, amountMinor]) => ({ at, amountMinor }));
}

/**
 * Change from `previous` to `current`, as a fraction.
 * Null when there is no previous figure to compare against — "up 100%" from
 * nothing is a meaningless claim, and showing it erodes trust in every other
 * number on the screen.
 */
export function changeFraction(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

/** Average daily spend so far, for pacing text. */
export function dailyAverage(spentMinor: number, daysElapsed: number): number {
  if (daysElapsed <= 0) return spentMinor;
  return Math.round(spentMinor / daysElapsed);
}

/** How many days of a month remain, given the anchor day. Used for forecasts. */
export function daysLeftInMonth(now: number, firstDayOfMonth = 1): number {
  const anchor = Math.min(Math.max(Math.trunc(firstDayOfMonth), 1), 28);
  const d = new Date(now);
  const shift = d.getDate() < anchor ? -1 : 0;
  const start = new Date(d.getFullYear(), d.getMonth() + shift, anchor);
  const end = new Date(d.getFullYear(), d.getMonth() + shift + 1, anchor);
  const total = Math.round((end.getTime() - start.getTime()) / 86400000);
  const elapsed = Math.floor((startOfDay(now) - start.getTime()) / 86400000);
  return Math.max(0, total - elapsed);
}

/** Exposed for tests that need to reason about month lengths. */
export { daysInMonth };
