/**
 * The base-currency change rewrites stored money. If it is wrong, it is wrong
 * for every transaction the user has ever entered, silently, with no way to
 * tell from the screen — so it gets tested harder than anything else here.
 */
import { describe, expect, it } from '@jest/globals';

import { planRebase, rescaleMinor, sameScale } from '../rebase';

describe('rescaleMinor', () => {
  it('leaves amounts alone between currencies of equal precision', () => {
    // INR, AED, USD, PKR are all two-decimal. 123456 means 1,234.56 in each,
    // so the integer must not move.
    expect(rescaleMinor(123456, 'INR', 'AED')).toBe(123456);
    expect(rescaleMinor(123456, 'AED', 'PKR')).toBe(123456);
    expect(rescaleMinor(-5000, 'USD', 'INR')).toBe(-5000);
  });

  it('gains precision when moving to a three-decimal currency', () => {
    // ₹1,234.56 restated as dinar is 1,234.560 — same number, finer unit.
    expect(rescaleMinor(123456, 'INR', 'KWD')).toBe(1234560);
    expect(rescaleMinor(123456, 'INR', 'OMR')).toBe(1234560);
    expect(rescaleMinor(123456, 'INR', 'BHD')).toBe(1234560);
  });

  it('loses precision when moving to a whole-unit currency', () => {
    // ₹1,234.56 as yen is ¥1,235. Without this the dashboard would read
    // ¥123,456 — a hundredfold overstatement, shown without a word of warning.
    expect(rescaleMinor(123456, 'INR', 'JPY')).toBe(1235);
    expect(rescaleMinor(100, 'INR', 'JPY')).toBe(1);
  });

  it('rounds half away from zero, so an expense never shrinks', () => {
    expect(rescaleMinor(1250, 'INR', 'JPY')).toBe(13);
    expect(rescaleMinor(-1250, 'INR', 'JPY')).toBe(-13);
    expect(rescaleMinor(-1249, 'INR', 'JPY')).toBe(-12);
  });

  it('keeps the sign, because expenses are stored negative', () => {
    expect(rescaleMinor(-123456, 'INR', 'KWD')).toBe(-1234560);
    expect(rescaleMinor(-123456, 'KWD', 'INR')).toBe(-12346);
  });

  it('round-trips within the precision it kept', () => {
    // Two decimals to three and back must be lossless.
    const there = rescaleMinor(987654, 'INR', 'OMR');
    expect(rescaleMinor(there, 'OMR', 'INR')).toBe(987654);
  });

  it('handles zero and small change', () => {
    expect(rescaleMinor(0, 'INR', 'JPY')).toBe(0);
    expect(rescaleMinor(0, 'JPY', 'KWD')).toBe(0);
    expect(rescaleMinor(49, 'INR', 'JPY')).toBe(0); // 49 paise really is ¥0
    expect(rescaleMinor(50, 'INR', 'JPY')).toBe(1);
  });

  it('treats an unknown currency as two decimals rather than throwing', () => {
    // decimalsFor falls back to 2. A base currency that is not in the table
    // must not take the whole ledger down with it.
    expect(rescaleMinor(123456, 'INR', 'XXX')).toBe(123456);
  });
});

describe('sameScale', () => {
  it('groups currencies by precision, not by region', () => {
    expect(sameScale('INR', 'AED')).toBe(true);
    expect(sameScale('KWD', 'OMR')).toBe(true);
    expect(sameScale('INR', 'KWD')).toBe(false);
    expect(sameScale('INR', 'JPY')).toBe(false);
  });
});

describe('planRebase', () => {
  it('reports that nothing will be rewritten between like currencies', () => {
    const plan = planRebase('INR', 'AED', ['INR', 'INR']);
    expect(plan.rescales).toBe(false);
    expect(plan.mixes).toBe(true); // the ledger is still in rupees
    expect(plan.otherCurrencies).toEqual(['INR']);
  });

  it('reports a rewrite when precision changes', () => {
    expect(planRebase('INR', 'KWD', ['INR']).rescales).toBe(true);
  });

  it('says totals are clean when the whole ledger is already the new currency', () => {
    const plan = planRebase('INR', 'AED', ['AED', 'AED', 'aed']);
    expect(plan.mixes).toBe(false);
    expect(plan.otherCurrencies).toEqual([]);
  });

  it('is clean for an empty ledger — the fresh-install case', () => {
    const plan = planRebase('INR', 'SAR', []);
    expect(plan.mixes).toBe(false);
    expect(plan.rescales).toBe(false);
  });

  it('lists every other currency once, uppercased and sorted', () => {
    const plan = planRebase('INR', 'INR', ['aed', 'AED', 'PKR', 'INR', 'jpy']);
    expect(plan.otherCurrencies).toEqual(['AED', 'JPY', 'PKR']);
  });
});
