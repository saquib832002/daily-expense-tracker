import { describe, expect, it } from '@jest/globals';
import {
  describeRecurrence,
  formatRRule,
  nextOccurrence,
  occurrencesBetween,
  parseRRule,
} from '../recurrence';

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();
const ymd = (ms: number) => {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

describe('parseRRule', () => {
  it('parses the subset we support', () => {
    expect(parseRRule('FREQ=MONTHLY;BYMONTHDAY=3')).toEqual({
      freq: 'MONTHLY',
      interval: 1,
      byMonthDay: 3,
    });
    expect(parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR')).toEqual({
      freq: 'WEEKLY',
      interval: 2,
      byDay: 5,
    });
  });

  it('is forgiving about case and spacing', () => {
    expect(parseRRule(' freq=daily ; interval=3 ')).toEqual({ freq: 'DAILY', interval: 3 });
  });

  it('rejects nonsense rather than guessing', () => {
    expect(parseRRule('')).toBeNull();
    expect(parseRRule(null)).toBeNull();
    expect(parseRRule('FREQ=FORTNIGHTLY')).toBeNull();
    expect(parseRRule('INTERVAL=2')).toBeNull();
  });

  it('ignores out-of-range values instead of trusting them', () => {
    expect(parseRRule('FREQ=MONTHLY;BYMONTHDAY=99')?.byMonthDay).toBeUndefined();
    expect(parseRRule('FREQ=DAILY;INTERVAL=0')?.interval).toBe(1);
    expect(parseRRule('FREQ=DAILY;INTERVAL=-4')?.interval).toBe(1);
  });

  it('round-trips through formatRRule', () => {
    for (const s of ['FREQ=DAILY', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', 'FREQ=MONTHLY;BYMONTHDAY=3']) {
      expect(formatRRule(parseRRule(s)!)).toBe(s);
    }
  });
});

describe('nextOccurrence — daily', () => {
  const r = parseRRule('FREQ=DAILY')!;
  const anchor = at(2026, 8, 1);

  it('gives the next day', () => {
    expect(ymd(nextOccurrence(r, anchor, at(2026, 8, 5)))).toEqual([2026, 8, 6]);
  });

  it('gives the anchor itself when the anchor is still ahead', () => {
    expect(ymd(nextOccurrence(r, anchor, at(2026, 7, 20)))).toEqual([2026, 8, 1]);
  });

  it('respects an interval', () => {
    const every3 = parseRRule('FREQ=DAILY;INTERVAL=3')!;
    expect(ymd(nextOccurrence(every3, anchor, at(2026, 8, 1)))).toEqual([2026, 8, 4]);
    expect(ymd(nextOccurrence(every3, anchor, at(2026, 8, 5)))).toEqual([2026, 8, 7]);
  });

  it('is always strictly after the cutoff', () => {
    const next = nextOccurrence(r, anchor, at(2026, 8, 5));
    expect(next).toBeGreaterThan(at(2026, 8, 5));
  });
});

describe('nextOccurrence — weekly', () => {
  it('lands on the requested weekday', () => {
    const r = parseRRule('FREQ=WEEKLY;BYDAY=FR')!;
    const next = nextOccurrence(r, at(2026, 8, 1), at(2026, 8, 3));
    expect(new Date(next).getDay()).toBe(5);
  });

  it('respects a fortnightly interval', () => {
    const r = parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')!;
    const first = nextOccurrence(r, at(2026, 8, 1), at(2026, 8, 1));
    const second = nextOccurrence(r, at(2026, 8, 1), first);
    expect(Math.round((second - first) / 86400000)).toBe(14);
  });
});

describe('nextOccurrence — monthly', () => {
  it('keeps the anchor day when no BYMONTHDAY is given', () => {
    const r = parseRRule('FREQ=MONTHLY')!;
    expect(ymd(nextOccurrence(r, at(2026, 1, 3), at(2026, 5, 10)))).toEqual([2026, 6, 3]);
  });

  it('clamps to the end of a short month', () => {
    // The 31st of every month must not silently become the 1st or 2nd.
    const r = parseRRule('FREQ=MONTHLY;BYMONTHDAY=31')!;
    expect(ymd(nextOccurrence(r, at(2026, 1, 31), at(2026, 2, 1)))).toEqual([2026, 2, 28]);
    expect(ymd(nextOccurrence(r, at(2026, 1, 31), at(2026, 3, 1)))).toEqual([2026, 3, 31]);
  });

  it('does not stall on a clamped month', () => {
    // Jan 31 → Feb 28: the clamped date could otherwise land on or before the
    // cutoff and return the same day forever.
    const r = parseRRule('FREQ=MONTHLY;BYMONTHDAY=31')!;
    const next = nextOccurrence(r, at(2026, 1, 31), at(2026, 2, 28));
    expect(next).toBeGreaterThan(at(2026, 2, 28));
    expect(ymd(next)).toEqual([2026, 3, 31]);
  });

  it('respects a quarterly interval', () => {
    const r = parseRRule('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1')!;
    expect(ymd(nextOccurrence(r, at(2026, 1, 1), at(2026, 1, 1)))).toEqual([2026, 4, 1]);
  });

  it('catches up from far in the past in one step', () => {
    const r = parseRRule('FREQ=MONTHLY;BYMONTHDAY=5')!;
    expect(ymd(nextOccurrence(r, at(2020, 1, 5), at(2026, 8, 10)))).toEqual([2026, 9, 5]);
  });
});

describe('nextOccurrence — yearly', () => {
  it('repeats on the same date each year', () => {
    const r = parseRRule('FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=15')!;
    expect(ymd(nextOccurrence(r, at(2026, 4, 15), at(2026, 5, 1)))).toEqual([2027, 4, 15]);
  });

  it('clamps 29 February in a common year', () => {
    const r = parseRRule('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29')!;
    expect(ymd(nextOccurrence(r, at(2028, 2, 29), at(2028, 3, 1)))).toEqual([2029, 2, 28]);
  });
});

describe('occurrencesBetween', () => {
  const r = parseRRule('FREQ=MONTHLY;BYMONTHDAY=1')!;

  it('lists every occurrence in the window, start inclusive and end exclusive', () => {
    const out = occurrencesBetween(r, at(2026, 1, 1), at(2026, 1, 1), at(2026, 7, 1));
    expect(out.map((ms) => ymd(ms)[1])).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('is empty when the window contains none', () => {
    expect(occurrencesBetween(r, at(2026, 1, 1), at(2026, 1, 2), at(2026, 1, 28))).toEqual([]);
  });

  it('caps the catch-up so six months away cannot lock up the app', () => {
    const daily = parseRRule('FREQ=DAILY')!;
    const out = occurrencesBetween(daily, at(2026, 1, 1), at(2026, 1, 1), at(2026, 12, 31), 30);
    expect(out).toHaveLength(30);
  });

  it('is strictly increasing', () => {
    const out = occurrencesBetween(r, at(2026, 1, 1), at(2026, 1, 1), at(2026, 12, 1));
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  });
});

describe('describeRecurrence', () => {
  it('uses the simple wording for an interval of one', () => {
    expect(describeRecurrence(parseRRule('FREQ=MONTHLY')!).key).toBe('recurring.everyMonth');
  });

  it('uses the counted wording otherwise', () => {
    const d = describeRecurrence(parseRRule('FREQ=WEEKLY;INTERVAL=2')!);
    expect(d.key).toBe('recurring.everyNWeeks');
    expect(d.params.n).toBe('2');
  });
});
