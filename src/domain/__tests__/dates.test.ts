import { describe, expect, it } from '@jest/globals';
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  isSameDay,
  monthGrid,
  notInFuture,
  quickDates,
  relativeDayKey,
  startOfDay,
} from '../dates';

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

describe('startOfDay / isSameDay', () => {
  it('collapses a day to midnight local', () => {
    const d = new Date(startOfDay(at(2026, 8, 15, 23, 59)));
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  it('treats 00:01 and 23:59 as the same day', () => {
    expect(isSameDay(at(2026, 8, 15, 0, 1), at(2026, 8, 15, 23, 59))).toBe(true);
  });

  it('treats 23:59 and 00:01 the next day as different', () => {
    expect(isSameDay(at(2026, 8, 15, 23, 59), at(2026, 8, 16, 0, 1))).toBe(false);
  });
});

describe('addDays', () => {
  it('moves by calendar day', () => {
    expect(new Date(addDays(at(2026, 8, 31), 1)).getDate()).toBe(1);
    expect(new Date(addDays(at(2026, 8, 1), -1)).getMonth()).toBe(6); // July
  });

  it('keeps the wall-clock day across a DST-style shift', () => {
    // Even where a day is 23 or 25 hours long, the calendar day must advance
    // by exactly one — this is why we use setDate rather than + 24h.
    const start = at(2026, 3, 8, 12);
    expect(new Date(addDays(start, 1)).getDate()).toBe(9);
  });
});

describe('addMonths', () => {
  it('clamps to the end of a shorter month', () => {
    const d = new Date(addMonths(at(2026, 1, 31), 1));
    expect(d.getMonth()).toBe(1); // February, not March
    expect(d.getDate()).toBe(28);
  });

  it('goes backwards too', () => {
    expect(new Date(addMonths(at(2026, 3, 31), -1)).getMonth()).toBe(1);
  });
});

describe('daysInMonth', () => {
  it('knows February', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29); // leap year
    expect(daysInMonth(2026, 0)).toBe(31);
  });
});

describe('daysBetween', () => {
  it('counts calendar days, not elapsed hours', () => {
    // 23:00 to 01:00 the next day is two hours, but one calendar day.
    expect(daysBetween(at(2026, 8, 15, 23), at(2026, 8, 16, 1))).toBe(1);
    expect(daysBetween(at(2026, 8, 15), at(2026, 8, 15))).toBe(0);
    expect(daysBetween(at(2026, 8, 16), at(2026, 8, 15))).toBe(-1);
  });
});

describe('relativeDayKey', () => {
  const now = at(2026, 8, 15);
  it('labels today and yesterday', () => {
    expect(relativeDayKey(at(2026, 8, 15, 8), now)).toBe('common.today');
    expect(relativeDayKey(at(2026, 8, 14, 22), now)).toBe('common.yesterday');
  });

  it('returns null for anything older', () => {
    expect(relativeDayKey(at(2026, 8, 13), now)).toBeNull();
  });
});

describe('quickDates', () => {
  const now = at(2026, 8, 15);
  it('offers five days, newest first, all at midnight', () => {
    const q = quickDates(now);
    expect(q).toHaveLength(5);
    expect(q[0]!.key).toBe('common.today');
    expect(q[1]!.key).toBe('common.yesterday');
    for (const d of q) expect(new Date(d.ms).getHours()).toBe(0);
  });

  it('is strictly descending', () => {
    const q = quickDates(now);
    for (let i = 1; i < q.length; i++) expect(q[i]!.ms).toBeLessThan(q[i - 1]!.ms);
  });
});

describe('monthGrid', () => {
  it('returns whole weeks', () => {
    for (const week of monthGrid(2026, 7)) expect(week).toHaveLength(7);
  });

  it('contains every day of the month exactly once', () => {
    const flat = monthGrid(2026, 7).flat().filter((d): d is number => d !== null);
    expect(flat).toHaveLength(31); // August
    expect(new Set(flat).size).toBe(31);
    expect(flat[0]).toBe(1);
    expect(flat[flat.length - 1]).toBe(31);
  });

  it('pads the lead correctly for a Sunday-first week', () => {
    // 1 Feb 2026 is a Sunday, so no padding is needed at the start.
    const grid = monthGrid(2026, 1, 0);
    expect(grid[0]![0]).toBe(1);
  });

  it('shifts when the week starts on Monday', () => {
    const sunFirst = monthGrid(2026, 1, 0);
    const monFirst = monthGrid(2026, 1, 1);
    expect(sunFirst[0]![0]).not.toBe(monFirst[0]![0]);
  });
});

describe('notInFuture', () => {
  const now = at(2026, 8, 15);
  it('clamps a future date to now', () => {
    expect(notInFuture(at(2026, 9, 1), now)).toBe(now);
  });
  it('leaves the past alone', () => {
    const past = at(2026, 8, 1);
    expect(notInFuture(past, now)).toBe(past);
  });
});
