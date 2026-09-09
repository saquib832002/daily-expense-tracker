import { describe, expect, it } from '@jest/globals';
import {
  changeFraction,
  dailyAverage,
  dailySeries,
  daysLeftInMonth,
  foldTail,
  monthlySeries,
  niceMax,
  rankSlices,
} from '../report';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('rankSlices', () => {
  it('sorts biggest first and adds shares that total 1', () => {
    const out = rankSlices([
      { key: 'food', amountMinor: -3000 },
      { key: 'rent', amountMinor: -6000 },
      { key: 'fuel', amountMinor: -1000 },
    ]);
    expect(out.map((s) => s.key)).toEqual(['rent', 'food', 'fuel']);
    expect(out[0]!.fraction).toBeCloseTo(0.6);
    expect(out.reduce((s, x) => s + x.fraction, 0)).toBeCloseTo(1);
  });

  it('returns positive amounts from the ledger’s negative expenses', () => {
    const out = rankSlices([{ key: 'food', amountMinor: -2500 }]);
    expect(out[0]!.amountMinor).toBe(2500);
  });

  it('drops zeroes rather than drawing empty wedges', () => {
    const out = rankSlices([
      { key: 'food', amountMinor: -100 },
      { key: 'gifts', amountMinor: 0 },
    ]);
    expect(out.map((s) => s.key)).toEqual(['food']);
  });

  it('is empty when there is nothing to show', () => {
    expect(rankSlices([])).toEqual([]);
    expect(rankSlices([{ key: 'a', amountMinor: 0 }])).toEqual([]);
  });

  it('breaks ties deterministically, so the chart never reshuffles', () => {
    const a = rankSlices([
      { key: 'zeta', amountMinor: -100 },
      { key: 'alpha', amountMinor: -100 },
    ]);
    expect(a.map((s) => s.key)).toEqual(['alpha', 'zeta']);
  });
});

describe('foldTail', () => {
  const slices = rankSlices([
    { key: 'a', amountMinor: -500 },
    { key: 'b', amountMinor: -300 },
    { key: 'c', amountMinor: -100 },
    { key: 'd', amountMinor: -60 },
    { key: 'e', amountMinor: -40 },
  ]);

  it('leaves a short list alone', () => {
    expect(foldTail(slices, 9)).toHaveLength(5);
  });

  it('keeps the total exactly when folding', () => {
    const folded = foldTail(slices, 3);
    expect(folded).toHaveLength(3);
    expect(folded.map((s) => s.amountMinor).reduce((x, y) => x + y, 0)).toBe(1000);
    expect(folded.reduce((s, x) => s + x.fraction, 0)).toBeCloseTo(1);
  });

  it('names the folded slice so the UI can translate it', () => {
    expect(foldTail(slices, 3)[2]!.key).toBe('__other__');
  });

  it('handles a nonsense max', () => {
    expect(foldTail(slices, 0)).toEqual([]);
  });
});

describe('niceMax', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(23)).toBe(50);
    expect(niceMax(60)).toBe(100);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1234)).toBe(2000);
  });

  it('never returns zero, so a bar height is never divided by nothing', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });
});

describe('dailySeries', () => {
  const from = at(2026, 8, 1, 0);
  const to = at(2026, 9, 1, 0);

  it('includes every day of the month, empty ones too', () => {
    const out = dailySeries([{ occurredAt: at(2026, 8, 5), amountMinor: -100 }], from, to);
    expect(out).toHaveLength(31);
    expect(out.filter((p) => p.amountMinor === 0)).toHaveLength(30);
  });

  it('buckets by local day regardless of the time of day', () => {
    const out = dailySeries(
      [
        { occurredAt: at(2026, 8, 5, 1), amountMinor: -100 },
        { occurredAt: at(2026, 8, 5, 23), amountMinor: -400 },
      ],
      from,
      to,
    );
    expect(out.find((p) => new Date(p.at).getDate() === 5)!.amountMinor).toBe(500);
  });

  it('ignores rows outside the window', () => {
    const out = dailySeries([{ occurredAt: at(2026, 7, 15), amountMinor: -900 }], from, to);
    expect(out.every((p) => p.amountMinor === 0)).toBe(true);
  });

  it('is in ascending date order', () => {
    const out = dailySeries([], from, to);
    for (let i = 1; i < out.length; i++) expect(out[i]!.at).toBeGreaterThan(out[i - 1]!.at);
  });
});

describe('monthlySeries', () => {
  const now = at(2026, 8, 15);

  it('returns the requested number of months, ending with this one', () => {
    const out = monthlySeries([], now, 6);
    expect(out).toHaveLength(6);
    expect(new Date(out[5]!.at).getMonth()).toBe(7); // August
    expect(new Date(out[0]!.at).getMonth()).toBe(2); // March
  });

  it('buckets a transaction into the right month', () => {
    const out = monthlySeries([{ occurredAt: at(2026, 6, 10), amountMinor: -700 }], now, 6);
    expect(out.find((p) => new Date(p.at).getMonth() === 5)!.amountMinor).toBe(700);
  });

  it('respects a salary-day month start', () => {
    // With a 25th anchor, 10 August belongs to the month that began 25 July.
    const out = monthlySeries([{ occurredAt: at(2026, 8, 10), amountMinor: -500 }], now, 3, 25);
    const july = out.find((p) => new Date(p.at).getMonth() === 6);
    expect(july!.amountMinor).toBe(500);
  });

  it('ignores anything older than the window', () => {
    const out = monthlySeries([{ occurredAt: at(2024, 1, 1), amountMinor: -999 }], now, 6);
    expect(out.every((p) => p.amountMinor === 0)).toBe(true);
  });
});

describe('changeFraction', () => {
  it('reports a rise and a fall', () => {
    expect(changeFraction(150, 100)).toBeCloseTo(0.5);
    expect(changeFraction(50, 100)).toBeCloseTo(-0.5);
  });

  it('refuses to compare against nothing', () => {
    // "Up 100% from zero" is a meaningless claim and erodes trust in the rest.
    expect(changeFraction(150, 0)).toBeNull();
    expect(changeFraction(150, -20)).toBeNull();
  });
});

describe('dailyAverage', () => {
  it('divides by the days actually elapsed', () => {
    expect(dailyAverage(1000, 4)).toBe(250);
  });

  it('survives day zero', () => {
    expect(dailyAverage(1000, 0)).toBe(1000);
  });
});

describe('daysLeftInMonth', () => {
  it('counts to the end of a calendar month', () => {
    expect(daysLeftInMonth(at(2026, 8, 1, 0), 1)).toBe(31);
    expect(daysLeftInMonth(at(2026, 8, 31, 0), 1)).toBe(1);
  });

  it('respects a salary-day anchor', () => {
    // On 10 August with a 25th anchor, the period runs 25 Jul – 25 Aug.
    expect(daysLeftInMonth(at(2026, 8, 10, 0), 25)).toBe(15);
  });

  it('never goes negative', () => {
    expect(daysLeftInMonth(at(2026, 8, 15), 1)).toBeGreaterThanOrEqual(0);
  });
});
