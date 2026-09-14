import { describe, expect, it } from '@jest/globals';
import {
  amountCandidates,
  detectDateOrder,
  findDate,
  findMerchant,
  findMerchantBySize,
  joinRows,
  parseReceipt,
  parseReceiptFromLines,
  readDate,
  type PositionedLine,
} from '../receipt';

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
      categoryFrom: null,
      categoryEvidence: [],
      dateAlternative: null,
      candidates: [],
      rows: [],
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

/**
 * `guessCategoryKey` was replaced by `guessCategory` in receiptCategory.ts,
 * which reads the basket as well as the sign above the door. Its cases live in
 * receiptCategory.test.ts now, and against whole receipts rather than phrases —
 * the phrases were the reason the old version passed its tests while failing
 * on paper.
 */

/* ------------------------------------------------------------------------ */
/* The row rebuilder — the part that decides whether a real scan works.      */
/* ------------------------------------------------------------------------ */

/** ML Kit hands back BLOCKS, so labels and amounts arrive separated. */
const line = (text: string, top: number, left: number, height = 20): PositionedLine => ({
  text,
  top,
  left,
  width: text.length * 10,
  height,
});

describe('joinRows', () => {
  it('puts a label back with its amount when OCR returned them separately', () => {
    // This is the shape that broke real scans: the label column is one block,
    // the amount column another, so the plain text never has them adjacent.
    const rows = joinRows([
      line('Sub Total', 300, 40),
      line('GRAND TOTAL', 360, 40),
      line('349.00', 302, 400),
      line('405.46', 361, 400),
    ]);
    expect(rows).toEqual(['Sub Total  349.00', 'GRAND TOTAL  405.46']);
  });

  it('orders a row left to right, not in OCR order', () => {
    expect(joinRows([line('249.00', 100, 400), line('Chicken Biryani', 100, 40)])).toEqual([
      'Chicken Biryani  249.00',
    ]);
  });

  it('keeps rows apart when they are close but distinct', () => {
    const rows = joinRows([line('TOTAL', 100, 40), line('CASH', 130, 40)]);
    expect(rows).toHaveLength(2);
  });

  it('tolerates a label and amount printed slightly off each other', () => {
    expect(joinRows([line('TOTAL', 100, 40), line('432.00', 106, 400)])).toEqual([
      'TOTAL  432.00',
    ]);
  });

  it('scales its tolerance to the text size, so a big photo behaves like a small one', () => {
    const big = joinRows([line('TOTAL', 1000, 400, 200), line('432.00', 1060, 4000, 200)]);
    expect(big).toEqual(['TOTAL  432.00']);
  });

  it('survives lines with no bounding box at all', () => {
    expect(joinRows([{ text: 'TOTAL 99.00', top: 0, left: 0, width: 0, height: 0 }])).toEqual([
      'TOTAL 99.00',
    ]);
  });

  it('ignores empty lines', () => {
    expect(joinRows([line('  ', 10, 10), line('SHOP', 10, 40)])).toEqual(['SHOP']);
  });
});

describe('parseReceiptFromLines', () => {
  it('reads a total that plain text would have got wrong', () => {
    const r = parseReceiptFromLines(
      [
        line('MORE SUPERMARKET', 20, 60, 46),
        line('Sub Total', 300, 40),
        line('CGST 9%', 340, 40),
        line('GRAND TOTAL', 380, 40),
        line('CASH', 420, 40),
        line('1180.00', 302, 400),
        line('106.20', 342, 400),
        line('1286.20', 381, 400),
        line('1500.00', 421, 400),
      ],
      { now: NOW },
    );
    expect(r.amountMinor).toBe(128620);
    expect(r.amountFrom).toBe('total');
    expect(r.merchant).toBe('MORE SUPERMARKET');
  });

  it('offers the other figures as alternatives, best first', () => {
    const r = parseReceiptFromLines(
      [
        line('SHOP', 20, 60, 40),
        line('TOTAL', 200, 40),
        line('432.00', 201, 400),
        line('Item one', 120, 40),
        line('180.00', 121, 400),
      ],
      { now: NOW },
    );
    expect(r.candidates[0]!.minor).toBe(43200);
    expect(r.candidates.map((c) => c.minor)).toContain(18000);
    expect(r.candidates[0]!.row).toContain('TOTAL');
  });
});

describe('findMerchantBySize', () => {
  it('picks the biggest text near the top, not merely the first line', () => {
    expect(
      findMerchantBySize([
        line('Tax Invoice', 10, 40, 16),
        line('RELIANCE FRESH', 40, 40, 52),
        line('MG Road, Bengaluru', 110, 40, 16),
        line('TOTAL', 900, 40, 18),
      ]),
    ).toBe('RELIANCE FRESH');
  });

  it('ignores big text that is obviously paperwork', () => {
    expect(
      findMerchantBySize([
        line('TAX INVOICE', 10, 40, 60),
        line('SHARMA STORES', 80, 40, 40),
      ]),
    ).toBe('SHARMA STORES');
  });

  it('returns null when nothing near the top looks like a name', () => {
    expect(findMerchantBySize([line('99.00', 10, 40, 40), line('12345', 60, 40, 40)])).toBeNull();
  });
});

describe('amountCandidates', () => {
  it('never offers a figure from a ruled-out row', () => {
    const list = amountCandidates(['TOTAL 432.00', 'CASH 1000.00', 'CGST 38.88'], 'INR');
    expect(list.map((c) => c.minor)).toEqual([43200]);
  });

  it('deduplicates the same amount printed twice', () => {
    const list = amountCandidates(['TOTAL 432.00', 'Amount 432.00'], 'INR');
    expect(list).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ */
/* 09/04 is 4 September in Mumbai and 9 April in Boston.                     */
/* ------------------------------------------------------------------------ */

describe('detectDateOrder', () => {
  it('reads rupees as an Indian bill', () => {
    expect(detectDateOrder('TOTAL ₹405.46')).toBe('dmy');
    expect(detectDateOrder('GSTIN 29AAFCB7383J1ZR')).toBe('dmy');
    expect(detectDateOrder('CGST 2.5%  8.73')).toBe('dmy');
  });

  it('reads dollars plus American paperwork as a US bill', () => {
    expect(detectDateOrder('Subtotal $18.40\nSales Tax $1.61')).toBe('mdy');
  });

  it('treats a dollar sign as American, since it is only ever a tiebreak now', () => {
    expect(detectDateOrder('TOTAL $18.40')).toBe('mdy');
  });

  it('reads pounds and euros as day-first', () => {
    expect(detectDateOrder('TOTAL £18.40')).toBe('dmy');
  });

  it('admits when the bill says nothing useful', () => {
    expect(detectDateOrder('CORNER SHOP\nTOTAL 240.00')).toBeNull();
  });
});

describe('readDate', () => {
  it('picks the recent reading over the old one, whatever the preference', () => {
    // NOW is 20 Sep 2026. 09/03 is either 3 September (recent) or 9 March
    // (six months ago). A receipt being photographed is the recent one.
    for (const preference of [true, false]) {
      const r = readDate('09/03/2026', NOW, preference)!;
      expect(new Date(r.at).getMonth()).toBe(8); // September
      expect(new Date(r.at).getDate()).toBe(3);
    }
  });

  it('resolves an Indian receipt the same way, from the other direction', () => {
    // 03/09 is 3 September day-first, 9 March month-first. Same answer.
    for (const preference of [true, false]) {
      const r = readDate('03/09/2026', NOW, preference)!;
      expect(new Date(r.at).getMonth()).toBe(8);
      expect(new Date(r.at).getDate()).toBe(3);
    }
  });

  it('falls back to the preference when both readings are equally stale', () => {
    // Both 4 Feb and 2 April are months old, so recency cannot choose.
    expect(new Date(readDate('02/04/2026', NOW, true)!.at).getDate()).toBe(2);
    expect(new Date(readDate('02/04/2026', NOW, false)!.at).getDate()).toBe(4);
  });

  it('offers the other reading when both are possible', () => {
    // Day-first makes this 2 April; the alternative is 4 February.
    const r = readDate('02/04/2026', NOW, true)!;
    expect(new Date(r.at).getMonth()).toBe(3); // April
    expect(new Date(r.alternative!).getMonth()).toBe(1); // February
  });

  it('offers nothing when arithmetic settles it', () => {
    // 18 cannot be a month, so there is only one reading.
    expect(readDate('18/09/2026', NOW, false)!.alternative).toBeNull();
  });

  it('offers nothing for a named month', () => {
    expect(readDate('Sep 18, 2026', NOW, false)!.alternative).toBeNull();
  });
});

describe('a US receipt', () => {
  const US = [
    'BLUE BOTTLE COFFEE',
    '1 Ferry Building, San Francisco',
    'Date 09/03/2026  08:14 AM',
    'Latte              $5.75',
    'Croissant          $4.25',
    'Subtotal          $10.00',
    'Sales Tax          $0.88',
    'TOTAL             $10.88',
  ].join('\n');

  it('reads 09/03 as 3 September on an Indian phone', () => {
    // The exact case that was still wrong: dollars may not survive OCR, so
    // recency has to carry it.
    const r = parseReceipt(US, { now: NOW, dayFirst: true });
    expect(new Date(r.occurredAt!).getMonth()).toBe(8); // September
    expect(new Date(r.occurredAt!).getDate()).toBe(3);
  });

  it('is still right when OCR loses every dollar sign', () => {
    const stripped = US.replace(/\$/g, '');
    const r = parseReceipt(stripped, { now: NOW, dayFirst: true });
    expect(new Date(r.occurredAt!).getMonth()).toBe(8);
    expect(new Date(r.occurredAt!).getDate()).toBe(3);
  });

  it('still finds the total', () => {
    expect(parseReceipt(US, { now: NOW }).amountMinor).toBe(1088);
  });
});

describe('an Indian receipt keeps reading day-first', () => {
  it('even on a phone set to a month-first locale', () => {
    const r = parseReceipt(SWIGGY, { now: NOW, dayFirst: false });
    expect(new Date(r.occurredAt!).getDate()).toBe(18);
    expect(new Date(r.occurredAt!).getMonth()).toBe(8);
  });
});
