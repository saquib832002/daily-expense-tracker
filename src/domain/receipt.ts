/**
 * Reading a till receipt.
 *
 * OCR hands back a pile of lines in roughly the order they appear on the
 * paper. Turning that into "₹428 at Swiggy on the 3rd" is guesswork, and the
 * guessing is exactly the part that must be testable — which is why it lives
 * here as pure functions with no camera, no native module and no React.
 *
 * Two rules the whole file is built around:
 *
 *  1. **Never invent.** Every field can come back null. A blank the user fills
 *     in costs three seconds; a wrong amount they did not notice costs their
 *     trust in the entire app.
 *  2. **Say how sure you are.** `amountFrom` records whether the number came
 *     from a line that said TOTAL or from "the biggest number we could see",
 *     so the screen can be honest about which it is.
 */

import { parseAmountToMinor } from './money';

export interface ReceiptGuess {
  /** The number as it appeared, for showing next to the field. */
  amountText: string | null;
  amountMinor: number | null;
  /** `total` — a line said so. `largest` — we picked the biggest number. */
  amountFrom: 'total' | 'largest' | null;
  occurredAt: number | null;
  merchant: string | null;
  /** A seeded category key such as `category.food`, or null. */
  categoryKey: string | null;
}

/* --------------------------------------------------------------- keywords */

/**
 * Lines that announce the figure we want, best first.
 * Rank matters: a receipt with SUB TOTAL, TOTAL and GRAND TOTAL should give
 * up the grand total, not whichever line OCR happened to read first.
 */
const TOTAL_RANKS: { rank: number; re: RegExp }[] = [
  {
    rank: 3,
    re: /grand\s*total|net\s*(amount|payable|total)|amount\s*payable|total\s*payable|bill\s*amount|कुल\s*(राशि|योग)/i,
  },
  { rank: 2, re: /(^|[^a-z])total([^a-z]|$)|कुल/i },
  { rank: 1, re: /(^|[^a-z])(amount|paid|payable|due)([^a-z]|$)|राशि/i },
];

/**
 * Lines whose numbers are never the bill total, however they are labelled.
 * `SUB TOTAL` and `TOTAL TAX` both contain "total"; both are disqualified
 * here, which is why this list is checked first and wins outright.
 */
const NOT_THE_TOTAL =
  /sub\s*-?\s*total|cash|change|tender|balance|saving|discount|c?gst|igst|vat|(^|[^a-z])tax|round(ing)?\s*off|qty|quantity|item|invoice|gstin|phone|tel|mobile|card|upi|ref|table|token|점|no\.?\s*:/i;

/** Lines that are never a shop's name. */
const NOT_A_NAME =
  /invoice|bill\s*(no|number)|receipt|gstin|tax|tel|phone|mobile|www\.|@|http|order\s*no|table|cashier|date|time|gst\s*no|gstin|cin|fssai|gstn/i;

/* ---------------------------------------------------------------- numbers */

/**
 * Money-looking numbers on one line.
 *
 * Dates and long identifiers are removed first: a receipt is full of digits
 * that are not amounts — invoice numbers, phone numbers, GSTINs, times — and
 * every one of them is a chance to charge someone ₹9,90,12,345.
 */
function numbersOn(line: string): string[] {
  const cleaned = line
    // dates: 12/03/2026, 12-03-26, 2026.03.12
    .replace(/\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}/g, ' ')
    // times: 14:05, 2:05:33 PM
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')
    // runs of 9+ digits — phone numbers, GSTINs, invoice ids
    .replace(/\d{9,}/g, ' ');

  const out: string[] = [];
  const re = /(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{1,8}(?:\.\d{1,2})?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[1];
    if (raw) out.push(raw);
  }
  return out;
}

function toMinor(text: string, currency: string): number | null {
  const minor = parseAmountToMinor(text, currency);
  return minor != null && minor > 0 ? minor : null;
}

/* ------------------------------------------------------------------ dates */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

/**
 * A date, only if it is one a receipt could plausibly carry: not in the
 * future, not more than three years old. Anything else is OCR noise that
 * happens to look like a date, and silently dating an expense to 2019 is
 * worse than leaving it as today.
 */
function makeDate(y: number, m: number, d: number, now: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const year = fullYear(y);
  const date = new Date(year, m - 1, d, 12, 0, 0, 0);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return null; // 31 Feb

  const at = date.getTime();
  const dayMs = 86400000;
  if (at > now + dayMs) return null;
  if (at < now - 1095 * dayMs) return null;
  return at;
}

/**
 * The first plausible date on the receipt.
 *
 * Ambiguous numeric dates are read **day first**, which is what an Indian
 * till prints. When the first number cannot be a day (13/06) it is read the
 * other way round rather than thrown away.
 */
export function findDate(text: string, now = Date.now()): number | null {
  // 2026-03-12
  for (const m of text.matchAll(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/g)) {
    const at = makeDate(Number(m[1]), Number(m[2]), Number(m[3]), now);
    if (at !== null) return at;
  }

  // 12/03/2026 — day first, unless that is impossible
  for (const m of text.matchAll(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    const at = makeDate(y, b, a, now) ?? makeDate(y, a, b, now);
    if (at !== null) return at;
  }

  // 12 Jan 2026 / 12-Jan-26
  for (const m of text.matchAll(/(\d{1,2})[\s\-.]*([A-Za-z]{3,9})\.?[\s\-,]*(\d{2,4})/g)) {
    const month = MONTHS[(m[2] ?? '').slice(0, 4).toLowerCase()] ?? MONTHS[(m[2] ?? '').slice(0, 3).toLowerCase()];
    if (!month) continue;
    const at = makeDate(Number(m[3]), month, Number(m[1]), now);
    if (at !== null) return at;
  }

  // Jan 12, 2026
  for (const m of text.matchAll(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/g)) {
    const month = MONTHS[(m[1] ?? '').slice(0, 4).toLowerCase()] ?? MONTHS[(m[1] ?? '').slice(0, 3).toLowerCase()];
    if (!month) continue;
    const at = makeDate(Number(m[3]), month, Number(m[2]), now);
    if (at !== null) return at;
  }

  return null;
}

/* --------------------------------------------------------------- merchant */

/**
 * The shop's name, which is almost always in the first few lines and almost
 * never labelled. Anything that looks like paperwork rather than a name is
 * skipped; if nothing survives, the answer is null and the user types it.
 */
export function findMerchant(lines: string[]): string | null {
  for (const original of lines.slice(0, 6)) {
    const line = original.replace(/\s+/g, ' ').trim();
    if (line.length < 3 || line.length > 40) continue;

    const letters = line.replace(/[^A-Za-zऀ-ॿ]/g, '').length;
    if (letters < 3) continue;
    // Mostly digits: an address, a phone number, a bill number.
    if (letters < line.replace(/\s/g, '').length * 0.5) continue;
    if (NOT_A_NAME.test(line)) continue;
    if (/^\d/.test(line)) continue;

    return line.replace(/[.,:;\-–—|]+$/, '').trim();
  }
  return null;
}

/* ----------------------------------------------------------------- amount */

interface AmountHit {
  text: string;
  minor: number;
  from: 'total' | 'largest';
}

function findAmount(lines: string[], currency: string): AmountHit | null {
  let best: { rank: number; index: number; text: string; minor: number } | null = null;

  lines.forEach((line, index) => {
    if (NOT_THE_TOTAL.test(line)) return;

    const rank = TOTAL_RANKS.find((r) => r.re.test(line))?.rank ?? 0;
    if (rank === 0) return;

    // The biggest number on a TOTAL line is the total; the others are counts
    // or a line reference.
    let top: { text: string; minor: number } | null = null;
    for (const text of numbersOn(line)) {
      const minor = toMinor(text, currency);
      if (minor == null) continue;
      if (!top || minor > top.minor) top = { text, minor };
    }
    if (!top) return;

    // A later line of the same rank wins: receipts print the final figure last.
    if (!best || rank > best.rank || (rank === best.rank && index > best.index)) {
      best = { rank, index, text: top.text, minor: top.minor };
    }
  });

  if (best) {
    const hit: { text: string; minor: number } = best;
    return { text: hit.text, minor: hit.minor, from: 'total' };
  }

  // Nothing announced itself. Fall back to the biggest number that is not on
  // a line we have already ruled out — and say that is what we did.
  let largest: { text: string; minor: number } | null = null;
  for (const line of lines) {
    if (NOT_THE_TOTAL.test(line)) continue;
    for (const text of numbersOn(line)) {
      const minor = toMinor(text, currency);
      if (minor == null) continue;
      if (!largest || minor > largest.minor) largest = { text, minor };
    }
  }

  return largest ? { text: largest.text, minor: largest.minor, from: 'largest' } : null;
}

/* --------------------------------------------------------------- category */

/**
 * What kind of shop was this?
 *
 * Deliberately a keyword table rather than anything cleverer. It costs nothing,
 * runs offline, is obvious to read, and — the part that matters — is wrong in
 * ways a person can predict and correct. A model that is right 85% of the time
 * but inscrutable when wrong is worse here, because the user has to check every
 * scan anyway.
 *
 * Order matters only for ties: the earlier category wins, so the more specific
 * ones come first.
 */
const CATEGORY_WORDS: { key: string; words: string[] }[] = [
  { key: 'category.fuel', words: ['petrol', 'diesel', 'fuel', 'indian oil', 'iocl', 'bpcl', 'hpcl', 'bharat petroleum', 'hindustan petroleum', 'filling station', 'पेट्रोल', 'डीज़ल'] },
  { key: 'category.health', words: ['pharmacy', 'pharma', 'medical', 'medicals', 'chemist', 'hospital', 'clinic', 'diagnostic', 'pathology', 'apollo', 'medplus', 'dentist', 'दवा', 'अस्पताल'] },
  { key: 'category.groceries', words: ['supermarket', 'super market', 'grocery', 'groceries', 'kirana', 'provision', 'general store', 'dmart', 'd-mart', 'big bazaar', 'bigbasket', 'reliance fresh', 'more retail', 'departmental', 'किराना'] },
  { key: 'category.food', words: ['restaurant', 'cafe', 'coffee', 'swiggy', 'zomato', 'pizza', 'burger', 'biryani', 'bakery', 'sweets', 'mithai', 'dhaba', 'food court', 'kitchen', 'eatery', 'tiffin', 'canteen', 'रेस्टोरेंट', 'कैफ़े'] },
  { key: 'category.transport', words: ['uber', 'ola cabs', 'rapido', 'taxi', 'cab ', 'metro rail', 'irctc', 'railway', 'toll plaza', 'fastag', 'parking', 'rickshaw', 'ऑटो'] },
  { key: 'category.travel', words: ['airlines', 'indigo', 'spicejet', 'air india', 'makemytrip', 'goibibo', 'oyo', 'resort', 'tourism', 'travels'] },
  { key: 'category.entertainment', words: ['cinema', 'pvr', 'inox', 'multiplex', 'bookmyshow', 'netflix', 'spotify', 'movie'] },
  { key: 'category.phone', words: ['airtel', 'jio', 'vodafone', 'bsnl', 'recharge', 'prepaid', 'postpaid'] },
  { key: 'category.utilities', words: ['electricity', 'water bill', 'gas bill', 'broadband', 'bescom', 'bses', 'power corporation'] },
  { key: 'category.education', words: ['school', 'college', 'tuition', 'academy', 'stationery', 'book store', 'bookstore', 'institute'] },
  { key: 'category.personal', words: ['salon', 'spa', 'barber', 'parlour', 'parlor', 'beauty'] },
  { key: 'category.household', words: ['hardware', 'plumbing', 'furniture', 'paints', 'sanitary'] },
  { key: 'category.shopping', words: ['amazon', 'flipkart', 'myntra', 'apparel', 'garment', 'footwear', 'fashion', 'lifestyle', 'textiles', 'saree', 'boutique', 'readymade'] },
];

/**
 * The most likely category, or null.
 *
 * Null is a perfectly good answer and is returned often — the confirm screen
 * simply leaves the category unchosen, which is a two-second tap, rather than
 * filing a chemist's bill under Entertainment because one word matched.
 */
export function guessCategoryKey(text: string): string | null {
  const haystack = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;

  let best: { key: string; hits: number } | null = null;
  for (const { key, words } of CATEGORY_WORDS) {
    let hits = 0;
    for (const word of words) {
      if (haystack.includes(word.toLowerCase())) hits++;
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { key, hits };
  }
  return best?.key ?? null;
}

/* ------------------------------------------------------------------- main */

/**
 * Everything we can work out from one receipt.
 * Any field may be null; the confirm screen shows blanks, never guesses.
 */
export function parseReceipt(
  text: string,
  options: { currency?: string; now?: number } = {},
): ReceiptGuess {
  const currency = options.currency ?? 'INR';
  const now = options.now ?? Date.now();

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      amountText: null,
      amountMinor: null,
      amountFrom: null,
      occurredAt: null,
      merchant: null,
      categoryKey: null,
    };
  }

  const amount = findAmount(lines, currency);

  return {
    amountText: amount?.text ?? null,
    amountMinor: amount?.minor ?? null,
    amountFrom: amount?.from ?? null,
    occurredAt: findDate(text, now),
    merchant: findMerchant(lines),
    categoryKey: guessCategoryKey(text),
  };
}
