import { describe, expect, it } from '@jest/globals';

import {
  addFiscalYears,
  defaultYearStartMonth,
  fiscalYearEnd,
  fiscalYearLabel,
  fiscalYearOf,
  fiscalYearStart,
  fiscalYearsBetween,
  isCurrentFiscalYear,
  isInFiscalYear,
  monthsElapsed,
  monthsOfFiscalYear,
  normalizeYearStartMonth,
} from '../fiscalYear';

/** Local midnight, so the tests read in the same time zone the code works in. */
const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

describe('defaultYearStartMonth', () => {
  it('gives India April', () => {
    expect(defaultYearStartMonth('IN')).toBe(4);
    expect(defaultYearStartMonth('in')).toBe(4);
  });

  it('gives Pakistan and Bangladesh July, not April', () => {
    // Easy to get wrong by lumping the subcontinent together. Pakistan and
    // Bangladesh run July–June; India runs April–March.
    expect(defaultYearStartMonth('PK')).toBe(7);
    expect(defaultYearStartMonth('BD')).toBe(7);
  });

  it('gives Australia July and the Gulf and US January', () => {
    expect(defaultYearStartMonth('AU')).toBe(7);
    expect(defaultYearStartMonth('AE')).toBe(1);
    expect(defaultYearStartMonth('US')).toBe(1);
  });

  it('falls back to January when the OS will not say', () => {
    expect(defaultYearStartMonth(null)).toBe(1);
  });
});

describe('normalizeYearStartMonth', () => {
  it('accepts 1 to 12', () => {
    expect(normalizeYearStartMonth(4)).toBe(4);
    expect(normalizeYearStartMonth('12')).toBe(12);
  });

  it('turns anything else into January rather than throwing', () => {
    // This value comes out of a settings row, which a restored backup from a
    // future version could have written. A bad value must not break reports.
    expect(normalizeYearStartMonth(0)).toBe(1);
    expect(normalizeYearStartMonth(13)).toBe(1);
    expect(normalizeYearStartMonth('april')).toBe(1);
    expect(normalizeYearStartMonth(null)).toBe(1);
    expect(normalizeYearStartMonth(undefined)).toBe(1);
  });
});

describe('fiscalYearStart / End with an April year', () => {
  it('puts May 2026 in the year beginning April 2026', () => {
    expect(fiscalYearStart(at(2026, 5, 20), 4)).toBe(at(2026, 4, 1));
    expect(fiscalYearEnd(at(2026, 5, 20), 4)).toBe(at(2027, 4, 1));
  });

  it('puts February 2026 in the year that began in April 2025', () => {
    // The case that breaks naive implementations: a date before the start
    // month belongs to the year that started in the *previous* calendar year.
    expect(fiscalYearStart(at(2026, 2, 15), 4)).toBe(at(2025, 4, 1));
    expect(fiscalYearEnd(at(2026, 2, 15), 4)).toBe(at(2026, 4, 1));
  });

  it('treats 31 March as the last day of the old year and 1 April as the first of the new', () => {
    expect(fiscalYearStart(at(2026, 3, 31, 23), 4)).toBe(at(2025, 4, 1));
    expect(fiscalYearStart(at(2026, 4, 1, 0), 4)).toBe(at(2026, 4, 1));
  });

  it('starts at local midnight, not at the instant passed in', () => {
    expect(new Date(fiscalYearStart(at(2026, 7, 9, 17), 4)).getHours()).toBe(0);
  });
});

describe('fiscalYearStart with a January year', () => {
  it('is just the calendar year', () => {
    expect(fiscalYearStart(at(2026, 1, 1), 1)).toBe(at(2026, 1, 1));
    expect(fiscalYearStart(at(2026, 12, 31), 1)).toBe(at(2026, 1, 1));
    expect(fiscalYearEnd(at(2026, 6, 6), 1)).toBe(at(2027, 1, 1));
  });
});

describe('fiscalYearOf and its label', () => {
  it('labels a January year with a single number', () => {
    expect(fiscalYearLabel(fiscalYearOf(at(2026, 6, 1), 1))).toBe('2026');
  });

  it('labels an April year as a span, the way people write it', () => {
    expect(fiscalYearLabel(fiscalYearOf(at(2026, 6, 1), 4))).toBe('2026–27');
    expect(fiscalYearLabel(fiscalYearOf(at(2026, 2, 1), 4))).toBe('2025–26');
  });

  it('pads the tail across a century boundary', () => {
    expect(fiscalYearLabel(fiscalYearOf(at(2099, 6, 1), 4))).toBe('2099–00');
  });

  it('reports both calendar years', () => {
    const y = fiscalYearOf(at(2026, 6, 1), 4);
    expect(y.startYear).toBe(2026);
    expect(y.endYear).toBe(2027);
  });
});

describe('isInFiscalYear', () => {
  const y = fiscalYearOf(at(2026, 6, 1), 4);

  it('includes the first instant and excludes the last', () => {
    // Half-open. The end belongs to the next year, or a transaction at exactly
    // midnight on 1 April would be counted twice.
    expect(isInFiscalYear(y.start, y)).toBe(true);
    expect(isInFiscalYear(y.end, y)).toBe(false);
    expect(isInFiscalYear(y.end - 1, y)).toBe(true);
    expect(isInFiscalYear(y.start - 1, y)).toBe(false);
  });
});

describe('monthsOfFiscalYear', () => {
  it('runs April to March for an April year', () => {
    const months = monthsOfFiscalYear(fiscalYearOf(at(2026, 6, 1), 4));
    expect(months).toHaveLength(12);
    expect(new Date(months[0]!).getMonth()).toBe(3); // April
    expect(new Date(months[0]!).getFullYear()).toBe(2026);
    expect(new Date(months[11]!).getMonth()).toBe(2); // March
    expect(new Date(months[11]!).getFullYear()).toBe(2027);
  });

  it('runs January to December for a January year', () => {
    const months = monthsOfFiscalYear(fiscalYearOf(at(2026, 6, 1), 1));
    expect(new Date(months[0]!).getMonth()).toBe(0);
    expect(new Date(months[11]!).getMonth()).toBe(11);
  });

  it('gives every month a distinct start and all inside the year', () => {
    const y = fiscalYearOf(at(2026, 6, 1), 4);
    const months = monthsOfFiscalYear(y);
    expect(new Set(months).size).toBe(12);
    for (const m of months) expect(isInFiscalYear(m, y)).toBe(true);
  });
});

describe('addFiscalYears', () => {
  it('steps forward and back a year at a time', () => {
    expect(addFiscalYears(at(2026, 6, 1), 4, -1)).toBe(at(2025, 4, 1));
    expect(addFiscalYears(at(2026, 6, 1), 4, 1)).toBe(at(2027, 4, 1));
    expect(addFiscalYears(at(2026, 2, 1), 4, 1)).toBe(at(2026, 4, 1));
  });
});

describe('fiscalYearsBetween', () => {
  it('lists every year the range touches, oldest first', () => {
    const years = fiscalYearsBetween(at(2024, 8, 3), at(2026, 6, 1), 4);
    expect(years.map(fiscalYearLabel)).toEqual(['2024–25', '2025–26', '2026–27']);
  });

  it('returns one year when the range sits inside a year', () => {
    const years = fiscalYearsBetween(at(2026, 5, 1), at(2026, 9, 1), 4);
    expect(years.map(fiscalYearLabel)).toEqual(['2026–27']);
  });

  it('returns two when the range straddles a boundary by a day', () => {
    const years = fiscalYearsBetween(at(2026, 3, 31), at(2026, 4, 1), 4);
    expect(years.map(fiscalYearLabel)).toEqual(['2025–26', '2026–27']);
  });

  it('returns nothing for a reversed range rather than looping', () => {
    expect(fiscalYearsBetween(at(2026, 6, 1), at(2024, 6, 1), 4)).toEqual([]);
  });

  it('caps a pathological range instead of hanging', () => {
    // A corrupt or absurd `occurredAt` — year 900 — must not spin.
    const years = fiscalYearsBetween(at(900, 1, 1), at(2026, 1, 1), 1);
    expect(years.length).toBeLessThanOrEqual(200);
  });
});

describe('monthsElapsed', () => {
  const y = fiscalYearOf(at(2026, 6, 1), 4); // April 2026 – March 2027

  it('counts the month in progress', () => {
    expect(monthsElapsed(y, at(2026, 4, 1))).toBe(1);
    expect(monthsElapsed(y, at(2026, 4, 30))).toBe(1);
    expect(monthsElapsed(y, at(2026, 6, 15))).toBe(3);
  });

  it('is 12 once the year is over, and 0 before it starts', () => {
    expect(monthsElapsed(y, at(2027, 4, 1))).toBe(12);
    expect(monthsElapsed(y, at(2030, 1, 1))).toBe(12);
    expect(monthsElapsed(y, at(2026, 3, 31))).toBe(0);
  });

  it('never exceeds twelve in the final month', () => {
    expect(monthsElapsed(y, at(2027, 3, 31))).toBe(12);
  });
});

describe('isCurrentFiscalYear', () => {
  const y = fiscalYearOf(at(2026, 6, 1), 4);

  it('marks a statement for the year in progress as provisional', () => {
    expect(isCurrentFiscalYear(y, at(2026, 9, 1))).toBe(true);
    expect(isCurrentFiscalYear(y, at(2027, 4, 1))).toBe(false);
    expect(isCurrentFiscalYear(y, at(2026, 3, 31))).toBe(false);
  });
});
