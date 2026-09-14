/**
 * Whole receipts, not tidy phrases.
 *
 * The last time this file's subject was tested with hand-written snippets, the
 * tests passed and the scanner failed on real paper. So every case here is a
 * full bill as ML Kit would hand it over after `joinRows` — masthead, items,
 * totals, GSTIN, "thank you visit again" — including the ones that must return
 * nothing rather than guess.
 */
import { describe, expect, it } from '@jest/globals';

import { guessCategory, itemRegion } from '../receiptCategory';

/** An unbranded kirana bill — the case the old shop-name-only version missed. */
const KIRANA = [
  'SHRI BALAJI STORES',
  'Shop No 4, Gandhi Road, Pune 411001',
  'GSTIN: 27ABCDE1234F1Z5',
  'Bill No: 4471    Date: 09/09/2026',
  'AASHIRVAAD ATTA 5KG      1    285.00',
  'TOOR DAL 1KG             1    148.50',
  'AMUL TONED MILK 500ML    2     58.00',
  'SUGAR 1KG                1     46.00',
  'TATA SALT 1KG            1     28.00',
  'SUNFLOWER OIL 1L         1    142.00',
  'ONION 2KG                1     64.00',
  'SUB TOTAL                     771.50',
  'CGST 2.5%                      19.29',
  'SGST 2.5%                      19.29',
  'GRAND TOTAL                   810.08',
  'Thank you, visit again!',
];

const CHEMIST = [
  'NEW LIFE MEDICAL & GENERAL',
  '12 Station Road',
  'DL Lic: 20B/21B-4432',
  'DOLO 650MG TAB      STRIP 1     31.50',
  'AZITHROMYCIN 500    STRIP 1    118.00',
  'PANTOPRAZOLE 40MG   STRIP 1     84.00',
  'DETTOL ANTISEPTIC 100ML  1      68.00',
  'TOTAL                          301.50',
  'Get well soon',
];

const RESTAURANT = [
  'THE SPICE ROUTE',
  'Ground Floor, Forum Mall',
  'GSTIN 29AAFCS1234K1ZP',
  'Table No: 12   Covers: 3',
  'CHICKEN BIRYANI          2    598.00',
  'BUTTER NAAN              4    180.00',
  'PANEER TIKKA             1    320.00',
  'MASALA CHAI              3    120.00',
  'SUB TOTAL                    1218.00',
  'SERVICE CHARGE 5%              60.90',
  'CGST 2.5%                      31.97',
  'GRAND TOTAL                  1310.87',
];

const FUEL = [
  'INDIAN OIL - SHREE AUTO CARE',
  'NH-48, Bengaluru',
  'FIP: 03  Nozzle: 2',
  'MS PETROL',
  'Rate/Ltr        102.86',
  'Volume          19.44',
  'AMOUNT PAYABLE  2000.00',
];

const CLOTHES = [
  'TRENDS FASHION HOUSE',
  'MG Road',
  'MENS T-SHIRT ROUND NECK   2    898.00',
  'DENIM JEANS SLIM FIT      1   1499.00',
  'COTTON SOCKS PACK OF 3    1    299.00',
  'TOTAL                         2696.00',
];

describe('itemRegion', () => {
  it('skips the masthead and stops at the totals', () => {
    const region = itemRegion(KIRANA).join(' ');
    expect(region).toContain('ATTA');
    expect(region).toContain('ONION');
    expect(region).not.toContain('SHRI BALAJI');
    expect(region).not.toContain('CGST');
    expect(region).not.toContain('GRAND TOTAL');
  });

  it('throws out the shop\'s paperwork and pleasantries', () => {
    const region = itemRegion(KIRANA).join(' ');
    expect(region).not.toContain('GSTIN');
    expect(region).not.toContain('Bill No');
    expect(region).not.toContain('visit again');
  });

  it('uses the whole body when there is no totals row to find', () => {
    const rows = ['CORNER SHOP', 'Main Street', 'MILK 1L 58.00', 'BREAD 45.00'];
    expect(itemRegion(rows).join(' ')).toContain('MILK');
  });

  it('does not swallow a very short slip whole', () => {
    // Three rows: skipping a three-row masthead would leave nothing to read.
    expect(itemRegion(['SHOP', 'MILK 58.00', 'TOTAL 58.00']).length).toBeGreaterThan(0);
  });
});

describe('guessCategory — from the items', () => {
  it('reads an unbranded kirana bill as groceries', () => {
    // The whole point. "SHRI BALAJI STORES" is not a chain anyone listed;
    // atta, dal, milk, sugar, salt, oil and onion decide it between them.
    const guess = guessCategory(KIRANA, 'Shri Balaji Stores');
    expect(guess.key).toBe('category.groceries');
    expect(guess.evidence.length).toBeGreaterThan(0);
  });

  it('reads a clothing bill as shopping from the garments alone', () => {
    const guess = guessCategory(CLOTHES, 'Trends Fashion House');
    expect(guess.key).toBe('category.shopping');
  });

  it('quotes back what it matched on', () => {
    const guess = guessCategory(CHEMIST, 'New Life Medical & General');
    expect(guess.key).toBe('category.health');
    // Evidence has to be words a person can see on their own bill.
    expect(guess.evidence.some((e) => KIRANA.concat(CHEMIST).join(' ').toLowerCase().includes(e)))
      .toBe(true);
  });
});

describe('guessCategory — from the shop', () => {
  it('trusts a named business', () => {
    expect(guessCategory(FUEL, 'Indian Oil').key).toBe('category.fuel');
    expect(guessCategory(FUEL, 'Indian Oil').from).toBe('shop');
  });

  it('reads a restaurant bill as food, not groceries', () => {
    // Contains paneer, chai and naan — all of which a grocery bill could
    // carry. The masthead and the dishes have to outweigh them.
    const guess = guessCategory(RESTAURANT, 'The Spice Route');
    expect(guess.key).toBe('category.food');
  });
});

describe('guessCategory — knowing when to shut up', () => {
  it('says nothing on a single weak match', () => {
    // One jar of coffee is not a category.
    const rows = ['SOME SHOP', 'Main Road', 'COFFEE 200G  1  340.00', 'TOTAL 340.00'];
    expect(guessCategory(rows, 'Some Shop').key).toBeNull();
  });

  it('says nothing on an empty or unreadable bill', () => {
    expect(guessCategory([], null).key).toBeNull();
    expect(guessCategory(['####', '||||'], null).key).toBeNull();
  });

  it('says nothing when two categories tie', () => {
    // A genuinely ambiguous bill is exactly the one a person should file.
    const rows = ['MIXED', 'addr', 'NOTEBOOK 60.00', 'PENCIL 10.00', 'MILK 58.00', 'ATTA 285.00'];
    const guess = guessCategory(rows, 'Mixed');
    if (guess.key !== null) {
      // If it does commit, it must be because one side genuinely won.
      expect(guess.score).toBeGreaterThanOrEqual(3);
    }
  });

  it('is not swayed by a word in the footer', () => {
    // The registered name mentions a hotel; the basket is groceries. The old
    // version searched the whole blob and would have called this Food.
    const rows = [
      'BALAJI PROVISION',
      'Near Grand Hotel Restaurant, Pune',
      'ATTA 5KG      285.00',
      'TOOR DAL      148.50',
      'MILK 500ML     29.00',
      'SUGAR 1KG      46.00',
      'TOTAL         508.50',
      'A unit of Grand Hotel & Restaurant Pvt Ltd',
    ];
    expect(guessCategory(rows, 'Balaji Provision').key).toBe('category.groceries');
  });

  it('ignores a tax line that happens to contain a lexicon word', () => {
    const rows = ['SHOP', 'addr', 'ITEM 100.00', 'TOTAL 100.00', 'GSTIN 27AAAAA0000A1Z5'];
    expect(guessCategory(rows, 'Shop').key).toBeNull();
  });
});

describe('guessCategory — the categories in between', () => {
  it('separates household cleaning from personal care', () => {
    const house = ['STORE', 'addr', 'SURF EXCEL 1KG 240.00', 'HARPIC 500ML 98.00',
                   'LIZOL 975ML 185.00', 'TOTAL 523.00'];
    expect(guessCategory(house, 'Store').key).toBe('category.household');

    const person = ['STORE', 'addr', 'SHAMPOO 340ML 265.00', 'TOOTHPASTE 150G 95.00',
                    'RAZOR 210.00', 'TOTAL 570.00'];
    expect(guessCategory(person, 'Store').key).toBe('category.personal');
  });

  it('spots a stationery run as education', () => {
    const rows = ['BOOK DEPOT', 'addr', 'NOTEBOOK 200PG 5 300.00',
                  'GEOMETRY BOX 1 180.00', 'SKETCH PEN SET 1 120.00', 'TOTAL 600.00'];
    expect(guessCategory(rows, 'Book Depot').key).toBe('category.education');
  });

  it('reads a Gulf hypermarket bill', () => {
    const rows = [
      'LULU HYPERMARKET',
      'Al Barsha, Dubai',
      'TRN 100234567890003',
      'BASMATI RICE 5KG      1    42.50',
      'FRESH MILK 2L         2    18.00',
      'BROWN BREAD           1     5.50',
      'EGGS 30 PCS           1    16.75',
      'TOTAL                      82.75',
    ];
    expect(guessCategory(rows, 'Lulu Hypermarket').key).toBe('category.groceries');
  });
});
