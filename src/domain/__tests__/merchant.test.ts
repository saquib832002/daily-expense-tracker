import { describe, expect, it } from '@jest/globals';
import { normalizeMerchant, prettyMerchant } from '../merchant';

describe('normalizeMerchant', () => {
  it('collapses the three ways a bank describes the same merchant', () => {
    const a = normalizeMerchant('UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl');
    const b = normalizeMerchant('POS 4321 SWIGGY BANGALORE IN');
    const c = normalizeMerchant('SWIGGY*ORDER 8821');
    expect(a).toBe('SWIGGY');
    expect(b).toBe('SWIGGY');
    expect(c).toBe('SWIGGY');
  });

  it('keeps the local part of a UPI handle', () => {
    expect(normalizeMerchant('paid to bigbasket@okhdfcbank')).toBe('BIGBASKET');
  });

  it('drops reference numbers and card fragments', () => {
    expect(normalizeMerchant('POS XX4321 RELIANCE FRESH 99283')).toBe('RELIANCE FRESH');
  });

  it('drops rails and boilerplate', () => {
    expect(normalizeMerchant('NEFT DR PAYMENT AMAZON PVT LTD')).toBe('AMAZON');
  });

  it('returns empty when nothing identifying survives', () => {
    expect(normalizeMerchant('UPI/DR/412345678901')).toBe('');
    expect(normalizeMerchant('')).toBe('');
    expect(normalizeMerchant(null)).toBe('');
    expect(normalizeMerchant(undefined)).toBe('');
  });

  it('is stable — the same input always gives the same key', () => {
    const input = 'POS 1234 CAFE COFFEE DAY MUMBAI IN';
    expect(normalizeMerchant(input)).toBe(normalizeMerchant(input));
  });
});

describe('prettyMerchant', () => {
  it('title-cases a key for display', () => {
    expect(prettyMerchant('RELIANCE FRESH')).toBe('Reliance Fresh');
    expect(prettyMerchant('')).toBe('');
  });
});
