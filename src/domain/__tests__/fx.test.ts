import { describe, expect, it } from '@jest/globals';

import {
  convert,
  formatRate,
  freshnessOf,
  parseAmount,
  rateDecimals,
  rateFor,
  type RateTable,
} from '../fx';

const HOUR = 60 * 60 * 1000;

const table: RateTable = {
  base: 'USD',
  rates: { INR: 95.51, EUR: 0.86266, AED: 3.6725, PKR: 277.64 },
  at: Date.parse('2026-09-11T00:02:31Z'),
};

describe('rateFor', () => {
  it('reads a rate straight off the table', () => {
    expect(rateFor('USD', 'INR', table)).toBe(95.51);
  });

  it('inverts for the other direction', () => {
    expect(rateFor('INR', 'USD', table)).toBeCloseTo(1 / 95.51, 10);
  });

  /** The reason one table is enough: everything else is a cross rate. */
  it('crosses two non-base currencies through the base', () => {
    const inrToAed = rateFor('INR', 'AED', table)!;
    expect(inrToAed).toBeCloseTo(3.6725 / 95.51, 10);
  });

  it('is exactly 1 for a currency against itself, even an unknown one', () => {
    expect(rateFor('INR', 'INR', table)).toBe(1);
    expect(rateFor('XYZ', 'XYZ', table)).toBe(1);
  });

  it('is case insensitive', () => {
    expect(rateFor('usd', 'inr', table)).toBe(95.51);
  });

  it('says null for a currency the table does not carry', () => {
    expect(rateFor('USD', 'XYZ', table)).toBeNull();
    expect(rateFor('XYZ', 'INR', table)).toBeNull();
  });

  /** A zero or negative rate is corrupt data, not a cheap currency. */
  it('refuses a nonsense rate rather than dividing by it', () => {
    const broken: RateTable = { ...table, rates: { ...table.rates, ZWL: 0 } };
    expect(rateFor('ZWL', 'USD', broken)).toBeNull();
    expect(rateFor('USD', 'ZWL', broken)).toBeNull();
  });
});

describe('convert', () => {
  it('converts an amount', () => {
    expect(convert(100, 'USD', 'INR', table)).toBeCloseTo(9551, 6);
  });

  it('round-trips back to where it started', () => {
    const there = convert(2500, 'INR', 'AED', table)!;
    expect(convert(there, 'AED', 'INR', table)).toBeCloseTo(2500, 6);
  });

  it('passes the null through when it cannot', () => {
    expect(convert(100, 'USD', 'XYZ', table)).toBeNull();
  });

  it('handles zero without inventing anything', () => {
    expect(convert(0, 'USD', 'INR', table)).toBe(0);
  });
});

describe('freshness', () => {
  const at = Date.parse('2026-09-11T06:00:00Z');

  it('is live within a couple of hours', () => {
    expect(freshnessOf(at, at + HOUR)).toBe('live');
  });

  it('is today within a day and a half', () => {
    expect(freshnessOf(at, at + 20 * HOUR)).toBe('today');
  });

  it('is stale within the week', () => {
    expect(freshnessOf(at, at + 3 * 24 * HOUR)).toBe('stale');
  });

  it('is old after that', () => {
    expect(freshnessOf(at, at + 30 * 24 * HOUR)).toBe('old');
  });
});

describe('rate formatting', () => {
  /**
   * 0.86 euros to the dollar shown to two places reads as a rounded-off number;
   * 95.51 rupees shown to six reads as false precision. The digits follow the
   * size of the rate.
   */
  it('scales the decimals to the size of the rate', () => {
    expect(rateDecimals(95.51)).toBe(4);
    expect(rateDecimals(277.64)).toBe(2);
    expect(rateDecimals(0.86266)).toBe(5);
    expect(rateDecimals(0.00031)).toBe(6);
    expect(rateDecimals(0)).toBe(2);
  });

  it('formats without throwing on a strange locale', () => {
    expect(formatRate(95.51, 'en')).toContain('95.51');
    expect(formatRate(95.51, 'not-a-locale')).toContain('95.51');
  });
});

describe('parseAmount', () => {
  it('reads a plain number', () => {
    expect(parseAmount('1234.5')).toBe(1234.5);
  });

  /** Somebody converting ₹1,00,000 types it the way their phone shows it. */
  it('ignores grouping separators, Indian ones included', () => {
    expect(parseAmount('1,00,000')).toBe(100000);
    expect(parseAmount('1 234')).toBe(1234);
  });

  it('is null for anything that is not a number', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('12.3.4')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
  });

  /**
   * Mid-typing states are "nothing yet", which the screen shows as a blank
   * result rather than as an error — the same answer as an empty box.
   */
  it('treats a lone decimal point as nothing yet', () => {
    expect(parseAmount('.')).toBeNull();
  });
});
