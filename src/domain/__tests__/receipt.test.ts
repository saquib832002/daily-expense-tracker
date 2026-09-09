import { describe, expect, it } from '@jest/globals';
import { findDate, findMerchant, guessCategoryKey, parseReceipt } from '../receipt';

const NOW = new Date(2026, 8, 20, 12, 0, 0).getTime(); // 20 Sep 2026

const SWIGGY = `
SWIGGY
Bundl Technologies Pvt Ltd
GSTIN: 29AAFCB7383J1ZR
Invoice No: 1234567890123
Date: 18/09/2026  14:32

Chicken Biryani        1    249.00
Coke 500ml             2     80.00
Packing charges              20.00

Sub Total                   349.00
CGST 2.5%                     8.73
SGST 2.5%                     8.73
Delivery fee                 39.00
GRAND TOTAL                 405.46

Paid via UPI
Thank you!
`;

describe('parseReceipt', () => {
  it('reads the grand total, not the sub total or a line item', () => {
    const r = parseReceipt(SWIGGY, { now: NOW });
    expect(r.amountMinor).toBe(40546);
    expect(r.amountFrom).toBe('total');
  });

  it('reads the date, day first', () => {
    const r = parseReceipt(SWIGGY, { now: NOW });
    expect(new Date(r.occurredAt!).getDate()).toBe(18);
    expect(new Date(r.occurredAt!).getMonth()).toBe(8); // September
  });

  it('reads the shop name from the top, skipping the paperwork', () => {
    expect(parseReceipt(SWIGGY, { now: NOW }).merchant).toBe('SWIGGY');
  });

  it('is not fooled by an invoice number that is bigger than the total', () => {
    // 1234567890123 appears on the receipt and dwarfs every real figure.
    expect(parseReceipt(SWIGGY, { now: NOW }).amountMinor).toBe(40546);
  });

  it('prefers TOTAL over the largest number when both exist', () => {
    const r = parseReceipt(
      ['BIG BAZAAR', 'Rice 5kg        1250.00', 'TV stand        9999.00', 'TOTAL   11249.00'].join(
        '\n',
      ),
      { now: NOW },
    );
    expect(r.amountMinor).toBe(1124900);
    expect(r.amountFrom).toBe('total');
  });

  it('says so when it had to guess', () => {
    const r = parseReceipt(['CORNER SHOP', 'Milk  60.00', 'Bread 45.00'].join('\n'), { now: NOW });
    expect(r.amountFrom).toBe('largest');
    expect(r.amountMinor).toBe(6000);
  });

  it('never returns an amount of zero', () => {
    const r = parseReceipt(['SHOP', 'TOTAL 0.00'].join('\n'), { now: NOW });
    expect(r.amountMinor).toBeNull();
  });

  it('returns all nulls rather than guesses for an unreadable photo', () => {
    const r = parseReceipt('   \n \n', { now: NOW });
    expect(r).toEqual({
      amountText: null,
      amountMinor: null,
      amountFrom: null,
      occurredAt: null,
      merchant: null,
      categoryKey: null,
    });
  });

  it('handles Indian digit grouping', () => {
    const r = parseReceipt(['JEWELLERS', 'GRAND TOTAL  1,23,456.78'].join('\n'), { now: NOW });
    expect(r.amountMinor).toBe(12345678);
  });

  it('ignores CASH and CHANGE lines that come after the total', () => {
    const r = parseReceipt(
      ['SHOP', 'TOTAL      432.00', 'CASH      1000.00', 'CHANGE     568.00'].join('\n'),
      { now: NOW },
    );
    expect(r.amountMinor).toBe(43200);
  });

  it('takes the last TOTAL when a receipt prints several', () => {
    const r = parseReceipt(['SHOP', 'TOTAL 100.00', 'TOTAL 250.00'].join('\n'), { now: NOW });
    expect(r.amountMinor).toBe(25000);
  });
});

describe('findDate', () => {
  it('reads dd/mm/yyyy as day first', () => {
    const at = findDate('Date 03/09/2026', NOW)!;
    expect(new Date(at).getDate()).toBe(3);
    expect(new Date(at).getMonth()).toBe(8);
  });

  it('falls back to month first when day first is impossible', () => {
    // 13 cannot be a month, so this can only be 13 September.
    const at = findDate('09/13/2026', NOW)!;
    expect(new Date(at).getDate()).toBe(13);
    expect(new Date(at).getMonth()).toBe(8);
  });

  it('reads a two digit year', () => {
    const at = findDate('18-09-26', NOW)!;
    expect(new Date(at).getFullYear()).toBe(2026);
  });

  it('reads a named month either way round', () => {
    expect(new Date(findDate('18 Sep 2026', NOW)!).getDate()).toBe(18);
    expect(new Date(findDate('Sep 18, 2026', NOW)!).getDate()).toBe(18);
  });

  it('refuses a date in the future', () => {
    expect(findDate('25/12/2026', NOW)).toBeNull();
  });

  it('refuses a date too old to be a receipt you are filing now', () => {
    expect(findDate('01/01/2015', NOW)).toBeNull();
  });

  it('refuses 31 February', () => {
    expect(findDate('31/02/2026', NOW)).toBeNull();
  });

  it('is not fooled by a time', () => {
    expect(findDate('14:32:07', NOW)).toBeNull();
  });
});

describe('findMerchant', () => {
  it('skips a line that is an address or a phone number', () => {
    expect(findMerchant(['12/3 MG Road', '080 4123 4567', 'CAFE COFFEE DAY'])).toBe(
      'CAFE COFFEE DAY',
    );
  });

  it('skips GSTIN and invoice lines', () => {
    expect(findMerchant(['GSTIN 29AAFCB7383J1ZR', 'Invoice No 4412', 'RELIANCE FRESH'])).toBe(
      'RELIANCE FRESH',
    );
  });

  it('trims trailing punctuation', () => {
    expect(findMerchant(['MORE SUPERMARKET -'])).toBe('MORE SUPERMARKET');
  });

  it('returns null rather than something wrong', () => {
    expect(findMerchant(['1234', '99.00', '---'])).toBeNull();
  });

  it('reads a Devanagari name', () => {
    expect(findMerchant(['शर्मा जनरल स्टोर', 'दिनांक 18/09/2026'])).toBe('शर्मा जनरल स्टोर');
  });
});

describe('guessCategoryKey', () => {
  it('recognises a food delivery bill', () => {
    expect(parseReceipt(SWIGGY, { now: NOW }).categoryKey).toBe('category.food');
  });

  it('recognises a chemist', () => {
    expect(guessCategoryKey('APOLLO PHARMACY\nParacetamol 500mg')).toBe('category.health');
  });

  it('recognises a petrol pump', () => {
    expect(guessCategoryKey('INDIAN OIL\nDiesel 20.5 L')).toBe('category.fuel');
  });

  it('recognises a supermarket', () => {
    expect(guessCategoryKey('RELIANCE FRESH SUPERMARKET')).toBe('category.groceries');
  });

  it('is case and spacing insensitive', () => {
    expect(guessCategoryKey('  bigBasket   Super  Market ')).toBe('category.groceries');
  });

  it('returns null rather than filing a bill under the wrong thing', () => {
    expect(guessCategoryKey('SHARMA & SONS\nTOTAL 240.00')).toBeNull();
  });

  it('picks the category with the most evidence, not the first word seen', () => {
    // "coffee" alone would say Food; two grocery words outweigh it.
    expect(guessCategoryKey('DMART SUPERMARKET\nCoffee 200g\nGrocery bill')).toBe(
      'category.groceries',
    );
  });
});
