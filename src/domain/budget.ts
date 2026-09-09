/**
 * Budget pace.
 *
 * The home screen has one job: answer "am I okay this month?" without the user
 * having to think. That means comparing how much of the budget is gone against
 * how much of the month is gone — a budget 78% spent is fine on day 25 and
 * alarming on day 8.
 *
 * Pure functions. No React, no database.
 */

export type PaceStatus = 'ok' | 'warn' | 'over';

export interface BudgetPace {
  spentMinor: number;
  limitMinor: number;
  /** Negative when the budget is blown. */
  remainingMinor: number;
  /** 0–1+, how much of the money is gone. */
  fractionSpent: number;
  /** 0–1, how much of the period is gone. */
  fractionElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  /** What's left, divided by the days left. The most actionable number we have. */
  dailyAllowanceMinor: number;
  /** Where this month lands if spending continues at the current rate. */
  projectedMinor: number;
  status: PaceStatus;
}

export interface PeriodBounds {
  /** Inclusive, epoch ms. */
  start: number;
  /** Exclusive, epoch ms. */
  end: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The budget month, which is not always the calendar month — people who are
 * paid on the 25th think in terms of the 25th.
 *
 * @param firstDayOfMonth 1–28. Values above 28 are clamped so February works.
 */
export function monthBounds(now: number, firstDayOfMonth = 1): PeriodBounds {
  const anchor = Math.min(Math.max(Math.trunc(firstDayOfMonth), 1), 28);
  const d = new Date(now);

  const startYear = d.getFullYear();
  const startMonth = d.getMonth() - (d.getDate() < anchor ? 1 : 0);

  const start = new Date(startYear, startMonth, anchor, 0, 0, 0, 0).getTime();
  const end = new Date(startYear, startMonth + 1, anchor, 0, 0, 0, 0).getTime();

  return { start, end };
}

/** Whole days in the period, and whole days still to come (today counts). */
export function periodProgress(now: number, bounds: PeriodBounds) {
  const total = Math.max(1, Math.round((bounds.end - bounds.start) / DAY_MS));
  const elapsedMs = Math.min(Math.max(now - bounds.start, 0), bounds.end - bounds.start);
  const daysElapsed = Math.floor(elapsedMs / DAY_MS);
  const daysRemaining = Math.max(0, total - daysElapsed);
  return {
    daysTotal: total,
    daysElapsed,
    daysRemaining,
    fractionElapsed: elapsedMs / (bounds.end - bounds.start),
  };
}

export function computePace(
  spentMinor: number,
  limitMinor: number,
  now: number,
  bounds: PeriodBounds,
): BudgetPace {
  const { daysTotal, daysRemaining, fractionElapsed } = periodProgress(now, bounds);

  const remainingMinor = limitMinor - spentMinor;
  const fractionSpent = limitMinor > 0 ? spentMinor / limitMinor : 0;

  // Divide by the days left including today, so "you can spend X today" is honest.
  const dailyAllowanceMinor =
    remainingMinor > 0 && daysRemaining > 0
      ? Math.floor(remainingMinor / daysRemaining)
      : 0;

  const projectedMinor =
    fractionElapsed > 0 ? Math.round(spentMinor / fractionElapsed) : spentMinor;

  let status: PaceStatus = 'ok';
  if (remainingMinor < 0) {
    status = 'over';
  } else if (limitMinor > 0 && fractionSpent > fractionElapsed + 0.1) {
    // More than 10 percentage points ahead of the calendar.
    status = 'warn';
  }

  return {
    spentMinor,
    limitMinor,
    remainingMinor,
    fractionSpent,
    fractionElapsed,
    daysTotal,
    daysRemaining,
    dailyAllowanceMinor,
    projectedMinor,
    status,
  };
}
