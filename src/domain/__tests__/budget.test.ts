import { describe, expect, it } from '@jest/globals';
import { computePace, monthBounds, periodProgress } from '../budget';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('monthBounds', () => {
  it('uses the calendar month by default', () => {
    const b = monthBounds(at(2026, 8, 15), 1);
    expect(new Date(b.start).getDate()).toBe(1);
    expect(new Date(b.start).getMonth()).toBe(7); // August
    expect(new Date(b.end).getMonth()).toBe(8); // September
  });

  it('honours a salary-day start before the anchor', () => {
    // On the 10th with a 25th anchor, we are still in the period that began
    // on the 25th of last month.
    const b = monthBounds(at(2026, 8, 10), 25);
    expect(new Date(b.start).getDate()).toBe(25);
    expect(new Date(b.start).getMonth()).toBe(6); // July
  });

  it('honours a salary-day start on or after the anchor', () => {
    const b = monthBounds(at(2026, 8, 25), 25);
    expect(new Date(b.start).getMonth()).toBe(7); // August
  });

  it('clamps the anchor so February works', () => {
    const b = monthBounds(at(2026, 2, 10), 31);
    expect(new Date(b.start).getDate()).toBe(28);
  });
});

describe('periodProgress', () => {
  it('counts days across a full month', () => {
    const bounds = monthBounds(at(2026, 8, 1), 1);
    const p = periodProgress(at(2026, 8, 1, 0), bounds);
    expect(p.daysTotal).toBe(31);
    expect(p.daysElapsed).toBe(0);
    expect(p.daysRemaining).toBe(31);
  });

  it('never reports negative days remaining', () => {
    const bounds = monthBounds(at(2026, 8, 1), 1);
    const p = periodProgress(at(2026, 10, 1), bounds);
    expect(p.daysRemaining).toBe(0);
  });
});

describe('computePace', () => {
  const bounds = monthBounds(at(2026, 8, 1), 1); // 31 days

  it('is ok when spending tracks the calendar', () => {
    // Half the month gone, half the budget gone.
    const pace = computePace(500000, 1000000, at(2026, 8, 16, 0), bounds);
    expect(pace.status).toBe('ok');
    expect(pace.remainingMinor).toBe(500000);
  });

  it('warns when spending runs ahead of the calendar', () => {
    // Day 8 of 31 (~23% elapsed) but 78% of the budget is gone.
    const pace = computePace(780000, 1000000, at(2026, 8, 9, 0), bounds);
    expect(pace.status).toBe('warn');
  });

  it('does not warn late in the month at the same fraction', () => {
    // Same 78% spent, but on day 25 that is fine.
    const pace = computePace(780000, 1000000, at(2026, 8, 26, 0), bounds);
    expect(pace.status).toBe('ok');
  });

  it('reports over when the budget is blown', () => {
    const pace = computePace(1200000, 1000000, at(2026, 8, 20), bounds);
    expect(pace.status).toBe('over');
    expect(pace.remainingMinor).toBeLessThan(0);
  });

  it('computes a daily allowance from the days actually left', () => {
    // 21 days elapsed, 10 remaining, ₹1000 left.
    const pace = computePace(900000, 1000000, at(2026, 8, 22, 0), bounds);
    expect(pace.daysRemaining).toBe(10);
    expect(pace.dailyAllowanceMinor).toBe(10000);
  });

  it('gives no allowance when already over', () => {
    const pace = computePace(1100000, 1000000, at(2026, 8, 22), bounds);
    expect(pace.dailyAllowanceMinor).toBe(0);
  });

  it('projects the month-end total', () => {
    // Half the month, ₹5000 spent → projecting ₹10000.
    const pace = computePace(500000, 1000000, at(2026, 8, 16, 12), bounds);
    expect(pace.projectedMinor).toBeGreaterThan(950000);
    expect(pace.projectedMinor).toBeLessThan(1050000);
  });

  it('survives a zero budget', () => {
    const pace = computePace(5000, 0, at(2026, 8, 10), bounds);
    expect(pace.status).toBe('over');
    expect(Number.isFinite(pace.fractionSpent)).toBe(true);
  });
});
