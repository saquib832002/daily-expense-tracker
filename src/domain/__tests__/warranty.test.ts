import { describe, expect, it } from '@jest/globals';

import {
  coverUsed,
  daysLeft,
  expiryOf,
  groupByStatus,
  isCovered,
  matches,
  statusOf,
  type WarrantyLike,
} from '../warranty';

const DAY = 24 * 60 * 60 * 1000;

function at(y: number, m: number, d: number, h = 12): number {
  return new Date(y, m - 1, d, h, 0, 0, 0).getTime();
}

function dateParts(ms: number): [number, number, number] {
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
}

describe('expiryOf', () => {
  it('adds months', () => {
    expect(dateParts(expiryOf(at(2026, 9, 11), 24))).toEqual([2028, 9, 11]);
  });

  /** 31 January + 1 month is 28 February, not 3 March. */
  it('clamps a month end', () => {
    expect(dateParts(expiryOf(at(2026, 1, 31), 1))).toEqual([2026, 2, 28]);
  });

  it('handles a leap year', () => {
    expect(dateParts(expiryOf(at(2027, 2, 28), 12))).toEqual([2028, 2, 28]);
    expect(dateParts(expiryOf(at(2028, 2, 29), 12))).toEqual([2029, 2, 28]);
  });

  it('lands at the end of the day, so the last day still counts', () => {
    const end = new Date(expiryOf(at(2026, 9, 11), 12));
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });
});

describe('status', () => {
  const now = at(2026, 9, 11, 10);

  it('is active when there is plenty of time', () => {
    expect(statusOf(at(2027, 9, 11), now)).toBe('active');
  });

  it('turns to soon inside thirty days', () => {
    expect(statusOf(at(2026, 10, 5), now)).toBe('soon');
  });

  it('is soon, not expired, on the very last day', () => {
    expect(statusOf(at(2026, 9, 11, 0), now)).toBe('soon');
    expect(isCovered(at(2026, 9, 11, 0), now)).toBe(true);
  });

  /**
   * The off-by-one that matters: a warranty is claimable ON its expiry date.
   * Getting this wrong tells somebody their television is out of cover while
   * the shop would still have honoured it.
   */
  it('expires the day after, not on the day', () => {
    const expiry = at(2026, 9, 11, 9);
    expect(statusOf(expiry, at(2026, 9, 11, 23))).toBe('soon');
    expect(statusOf(expiry, at(2026, 9, 12, 0, ))).toBe('expired');
  });

  it('counts the days left', () => {
    expect(daysLeft(at(2026, 9, 21), now)).toBe(10);
    expect(daysLeft(at(2026, 9, 11), now)).toBe(0);
    expect(daysLeft(at(2026, 9, 1), now)).toBe(-10);
  });
});

describe('groupByStatus', () => {
  const now = at(2026, 9, 11, 10);

  const items = [
    { id: 'tv', expiresOn: at(2028, 1, 1) },
    { id: 'kettle', expiresOn: at(2026, 9, 20) },
    { id: 'phone', expiresOn: at(2026, 10, 2) },
    { id: 'laptop', expiresOn: at(2027, 6, 1) },
    { id: 'oldMixer', expiresOn: at(2025, 3, 1) },
    { id: 'lastYearFan', expiresOn: at(2026, 6, 1) },
  ];

  it('sorts what is running out soonest first', () => {
    const { soon } = groupByStatus(items, now);
    expect(soon.map((i) => i.id)).toEqual(['kettle', 'phone']);
  });

  it('keeps the active list as a countdown', () => {
    const { active } = groupByStatus(items, now);
    expect(active.map((i) => i.id)).toEqual(['laptop', 'tv']);
  });

  it('shows the most recently expired first', () => {
    const { expired } = groupByStatus(items, now);
    expect(expired.map((i) => i.id)).toEqual(['lastYearFan', 'oldMixer']);
  });

  it('loses nothing', () => {
    const g = groupByStatus(items, now);
    expect(g.soon.length + g.active.length + g.expired.length).toBe(items.length);
  });

  it('copes with an empty list', () => {
    expect(groupByStatus([], now)).toEqual({ soon: [], active: [], expired: [] });
  });
});

describe('search', () => {
  const item: WarrantyLike = {
    id: 'w1',
    productName: 'Samsung 55" TV',
    brand: 'Samsung',
    retailer: 'Croma, Banjara Hills',
    serial: 'SN-8837-XZ',
    notes: 'Extended cover bought at the till',
    purchasedOn: at(2026, 1, 1),
    expiresOn: at(2028, 1, 1),
  };

  it('matches everything on an empty query', () => {
    expect(matches(item, '   ')).toBe(true);
  });

  it('matches the product, brand and shop', () => {
    expect(matches(item, 'samsung')).toBe(true);
    expect(matches(item, 'croma')).toBe(true);
    expect(matches(item, 'tv')).toBe(true);
  });

  /** Standing in the shop, reading the last digits off the sticker. */
  it('matches part of a serial number, whatever the case', () => {
    expect(matches(item, '8837')).toBe(true);
    expect(matches(item, 'sn-8837-xz')).toBe(true);
  });

  it('says no when it does not match', () => {
    expect(matches(item, 'refrigerator')).toBe(false);
  });

  it('does not fall over on missing fields', () => {
    const bare: WarrantyLike = {
      ...item,
      brand: null,
      retailer: null,
      serial: null,
      notes: null,
    };
    expect(matches(bare, 'samsung')).toBe(true);
    expect(matches(bare, 'croma')).toBe(false);
  });
});

describe('coverUsed', () => {
  const bought = at(2026, 1, 1);
  const expires = at(2027, 1, 1);

  it('is zero at the start and one at the end', () => {
    expect(coverUsed(bought, expires, bought)).toBe(0);
    expect(coverUsed(bought, expires, expires)).toBe(1);
  });

  it('is about half way through the middle', () => {
    const mid = bought + (expires - bought) / 2;
    expect(coverUsed(bought, expires, mid)).toBeCloseTo(0.5, 2);
  });

  it('clamps rather than running off either end', () => {
    expect(coverUsed(bought, expires, bought - 100 * DAY)).toBe(0);
    expect(coverUsed(bought, expires, expires + 100 * DAY)).toBe(1);
  });

  it('does not divide by zero on a nonsense span', () => {
    expect(coverUsed(expires, bought, bought)).toBe(1);
  });
});
