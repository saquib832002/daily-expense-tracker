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
import { guessCategory } from './receiptCategory';

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
  /**
   * Why that category — the words on the bill that decided it, and whether
   * they came from the shop's name or from the basket. Shown on the confirm
   * screen, because a category that appears with no explanation is a category
   * people stop trusting the moment it is once wrong.
   */
  categoryFrom: 'shop' | 'items' | null;
  categoryEvidence: string[];
  /**
   * The other way of reading an ambiguous printed date, e.g. `09/04` as
   * 9 April when we chose 4 September. Null when the date could only be read
   * one way — which is most of the time.
   */
  dateAlternative: number | null;
  /**
   * Every other figure on the bill that could plausibly be the total, best
   * first. The confirm screen offers these as one-tap alternatives — when the
   * guess is wrong, being right is a tap away instead of a retype, and that is
   * what makes a scanner feel reliable rather than clever.
   */
  candidates: AmountCandidate[];
  /** The rows as we rebuilt them. Shown under "what the scan read". */
  rows: string[];
}

export interface AmountCandidate {
  minor: number;
  /** The number exactly as printed. */
  text: string;
  /** The whole row it came from, so the user can see the context. */
  row: string;
}

/** One line of OCR output with its position on the image. */
export interface PositionedLine {
  text: string;
  top: number;
  left: number;
  width: number;
  height: number;
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
  /sub\s*-?\s*total|cash|change|tender|balance|saving|discount|c?gst|igst|vat|(^|[^a-z])tax|round(ing)?\s*off|qty|quantity|item|invoice|gstin|phone|tel|mobile|card|upi|ref|table|token|no\.?\s*:/i;

/**
 * Rows whose numbers are never worth offering, even as an alternative.
 *
 * Deliberately narrower than `NOT_THE_TOTAL`. A line item is not the bill
 * total, but it *is* a sensible thing to tap when the total was misread — so
 * "Chicken Biryani 249.00" is barred from being the automatic answer and
 * allowed as a suggestion. What money you handed over and what the taxman
 * took are never the expense, so those stay out of both.
 */
const NEVER_AN_AMOUNT =
  /cash|change|tender|balance|saving|discount|c?gst|igst|vat|(^|[^a-z])tax|round(ing)?\s*off|invoice|gstin|phone|tel|mobile|no\.?\s*:/i;

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
 * Which way round does this receipt print `09/04/2026`?
 *
 * The device's locale tells you how the *user* writes dates, not how the shop
 * printed them — an Indian phone photographing a Boston coffee receipt gets
 * this wrong every time. So the receipt is asked first, and the strongest
 * evidence it carries is the currency it is denominated in.
 *
 * Returns null when the bill gives us nothing to go on, and the caller falls
 * back to the phone's locale.
 */
export function detectDateOrder(text: string): 'dmy' | 'mdy' | null {
  // Rupees, or any of the Indian tax vocabulary. Unambiguous.
  if (/₹|(^|\W)rs\.?(\W|$)|(^|\W)inr(\W|$)|gstin|c?gst|sgst|igst/i.test(text)) return 'dmy';

  // Dollars. Australia, Singapore and Canada also print `$` and write the day
  // first, so this used to require a second American word — but that made the
  // rule fragile, and it is now only a tiebreak for dates that recency could
  // not settle. On balance a dollar receipt reaching this app is American.
  if (/\$\s?\d|sales\s*tax|\bUSD\b/i.test(text)) return 'mdy';

  // Pounds or euros: day first.
  if (/[£€]\s?\d|(^|\W)(gbp|eur)(\W|$)/i.test(text)) return 'dmy';

  return null;
}

/**
 * How recent a receipt has to be for recency to settle an ambiguous date.
 * Six weeks covers "I photograph my bills at the weekend" and "I am catching
 * up on last month" without stretching to a date that is genuinely old.
 */
const RECENT_MS = 45 * 86400000;

export interface DateReading {
  /** Our best reading. */
  at: number;
  /**
   * The other way round, when `09/04` could legitimately be either. Null when
   * the date was unambiguous — a named month, a four-digit year first, or a
   * number above twelve forcing the order.
   */
  alternative: number | null;
}

/**
 * The first plausible date on the receipt, and the other reading if there is
 * one.
 *
 * `dayFirst` decides only the genuinely ambiguous case. When one of the two
 * numbers is above twelve the order is forced by arithmetic and the preference
 * is ignored.
 */
export function readDate(
  text: string,
  now = Date.now(),
  dayFirst = true,
): DateReading | null {
  // 2026-03-12 — ISO, never ambiguous.
  for (const m of text.matchAll(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/g)) {
    const at = makeDate(Number(m[1]), Number(m[2]), Number(m[3]), now);
    if (at !== null) return { at, alternative: null };
  }

  // 12/03/2026 — the interesting case.
  for (const m of text.matchAll(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);

    const asDayFirst = makeDate(y, b, a, now);
    const asMonthFirst = makeDate(y, a, b, now);

    // Arithmetic settles it whenever one of the numbers is above twelve.
    if (asDayFirst === null && asMonthFirst === null) continue;
    if (asDayFirst === null) return { at: asMonthFirst!, alternative: null };
    if (asMonthFirst === null) return { at: asDayFirst, alternative: null };

    /*
     * Both readings are valid dates. The decisive fact is not which country
     * the shop is in — it is that **people photograph recent receipts**.
     *
     * On 9 September, "09/03" is either 3 September (six days ago) or
     * 9 March (six months ago). One of those is a receipt someone is filing;
     * the other is not. This resolves an American bill on an Indian phone and
     * an Indian bill on an American phone, with no country detection at all —
     * which matters, because detecting the country from OCR text is exactly
     * the fragile part: a dollar sign is small, faint, and frequently misread.
     */
    const dayIsRecent = now - asDayFirst <= RECENT_MS;
    const monthIsRecent = now - asMonthFirst <= RECENT_MS;

    let at: number;
    let other: number;
    if (dayIsRecent !== monthIsRecent) {
      at = dayIsRecent ? asDayFirst : asMonthFirst;
      other = dayIsRecent ? asMonthFirst : asDayFirst;
    } else {
      // Equally plausible — both recent, or both old. Now the receipt's own
      // evidence, and failing that the phone's locale, breaks the tie.
      at = dayFirst ? asDayFirst : asMonthFirst;
      other = dayFirst ? asMonthFirst : asDayFirst;
    }

    return { at, alternative: other !== at ? other : null };
  }

  // 12 Jan 2026 / 12-Jan-26 — a named month settles it.
  for (const m of text.matchAll(/(\d{1,2})[\s\-.]*([A-Za-z]{3,9})\.?[\s\-,]*(\d{2,4})/g)) {
    const month =
      MONTHS[(m[2] ?? '').slice(0, 4).toLowerCase()] ?? MONTHS[(m[2] ?? '').slice(0, 3).toLowerCase()];
    if (!month) continue;
    const at = makeDate(Number(m[3]), month, Number(m[1]), now);
    if (at !== null) return { at, alternative: null };
  }

  // Jan 12, 2026
  for (const m of text.matchAll(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})/g)) {
    const month =
      MONTHS[(m[1] ?? '').slice(0, 4).toLowerCase()] ?? MONTHS[(m[1] ?? '').slice(0, 3).toLowerCase()];
    if (!month) continue;
    const at = makeDate(Number(m[3]), month, Number(m[2]), now);
    if (at !== null) return { at, alternative: null };
  }

  return null;
}

/** The date alone. Kept because most callers only want the one number. */
export function findDate(text: string, now = Date.now(), dayFirst = true): number | null {
  return readDate(text, now, dayFirst)?.at ?? null;
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

/**
 * Every figure on the bill that could be the total, best first.
 *
 * Ranked by how the line describes itself — a row saying GRAND TOTAL beats one
 * saying TOTAL, which beats an unlabelled number — and within a rank, by size.
 * Rows we have ruled out entirely (CASH, CHANGE, GST) never appear.
 */
export function amountCandidates(rows: string[], currency: string): AmountCandidate[] {
  const seen = new Map<number, AmountCandidate & { score: number }>();

  rows.forEach((row, index) => {
    if (NEVER_AN_AMOUNT.test(row)) return;
    // A row that cannot be the total can still be a useful suggestion, so it
    // is kept — just ranked below anything that announced itself.
    const rank = NOT_THE_TOTAL.test(row)
      ? 0
      : (TOTAL_RANKS.find((r) => r.re.test(row))?.rank ?? 0);

    for (const text of numbersOn(row)) {
      const minor = toMinor(text, currency);
      if (minor == null) continue;
      // A later row of the same rank wins the tie: receipts print the final
      // figure last. Bigger amounts win within a row.
      const score = rank * 1_000_000 + index * 1_000 + Math.min(999, minor / 1000);
      const previous = seen.get(minor);
      if (!previous || score > previous.score) {
        seen.set(minor, { minor, text, row: row.trim(), score });
      }
    }
  });

  return [...seen.values()]
    .sort((a, b) => b.score - a.score || b.minor - a.minor)
    .slice(0, 4)
    .map(({ minor, text, row }) => ({ minor, text, row }));
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
/**
 * Category guessing moved to `src/domain/receiptCategory.ts`.
 *
 * What used to be here searched the whole receipt as one lowercase blob against
 * a list of shop names, and took whichever category matched the most words. It
 * could recognise a chain and nothing else: a bill headed SHRI BALAJI STORES
 * listing atta, dal, milk and sugar matched none of its vocabulary, because the
 * app had no words for groceries — only words for grocers. It also let a shop's
 * footer address vote, and let a single incidental word win outright.
 */

/* ------------------------------------------------------------------- rows */

/**
 * Rebuild the rows as they are printed on the paper.
 *
 * This is the single most important function in the file. ML Kit returns
 * *blocks* of text, and on a receipt the column of labels and the column of
 * amounts are usually two different blocks — so the plain text arrives with
 * every label separated from its number. Reading "TOTAL" and "405.46" as one
 * row is only possible from the bounding boxes.
 *
 * Lines belong to the same row when they overlap vertically. The tolerance is
 * derived from the text's own height rather than fixed in pixels, so it works
 * on a 12-megapixel photo and a cropped thumbnail alike.
 */
export function joinRows(lines: PositionedLine[]): string[] {
  const usable = lines.filter((l) => l.text.trim().length > 0);
  if (usable.length === 0) return [];

  const heights = usable.map((l) => l.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 20;
  // Half a line of text: enough to catch a label and an amount printed
  // slightly off each other, tight enough not to merge adjacent rows.
  const tolerance = Math.max(4, medianHeight * 0.5);

  const sorted = [...usable].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: PositionedLine[][] = [];

  for (const line of sorted) {
    const centre = line.top + line.height / 2;
    const current = rows[rows.length - 1];

    if (current && current.length > 0) {
      const first = current[0]!;
      const rowCentre = first.top + first.height / 2;
      if (Math.abs(centre - rowCentre) <= tolerance) {
        current.push(line);
        continue;
      }
    }
    rows.push([line]);
  }

  return rows.map((row) =>
    row
      .sort((a, b) => a.left - b.left)
      .map((l) => l.text.trim())
      .join('  ')
      .replace(/\s{3,}/g, '  ')
      .trim(),
  );
}

/**
 * The shop name, using how big the text is.
 *
 * A till receipt prints its name larger than everything else, near the top.
 * That is far more reliable than "the first line with some letters in it",
 * which picks up addresses, slogans and GST numbers.
 */
export function findMerchantBySize(lines: PositionedLine[]): string | null {
  const usable = lines.filter((l) => l.text.trim().length >= 3 && l.height > 0);
  if (usable.length === 0) return null;

  const byPosition = [...usable].sort((a, b) => a.top - b.top);
  const top = byPosition[0]!.top;
  const bottom = Math.max(...usable.map((l) => l.top + l.height));

  // The name lives in the masthead — beyond the first third we are into the
  // address, the bill number and the items. On a long receipt that fraction
  // is the right rule; on a short one it can exclude everything, so the first
  // six lines always qualify regardless.
  const cutoff = top + (bottom - top) * 0.35;
  const alwaysEligible = new Set(byPosition.slice(0, 6));

  const candidates = usable
    .filter((l) => l.top <= cutoff || alwaysEligible.has(l))
    .map((l) => ({ line: l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter(({ text }) => {
      if (text.length > 40) return false;
      const letters = text.replace(/[^A-Za-z\u0900-\u097F]/g, '').length;
      if (letters < 3) return false;
      if (letters < text.replace(/\s/g, '').length * 0.5) return false;
      if (NOT_A_NAME.test(text)) return false;
      return true;
    })
    .sort((a, b) => b.line.height - a.line.height);

  const best = candidates[0];
  return best ? best.text.replace(/[.,:;\-\u2013\u2014|]+$/, '').trim() : null;
}

/* ------------------------------------------------------------------- main */

/**
 * Everything we can work out from one receipt.
 * Any field may be null; the confirm screen shows blanks, never guesses.
 */
const EMPTY: ReceiptGuess = {
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
};

export interface ParseOptions {
  currency?: string;
  now?: number;
  /**
   * How the user's own locale writes dates. Used only when the receipt gives
   * no clue of its own, and only for genuinely ambiguous dates.
   */
  dayFirst?: boolean;
}

function parseRows(
  rows: string[],
  options: ParseOptions,
  merchant: string | null,
): ReceiptGuess {
  if (rows.length === 0) return { ...EMPTY };

  const currency = options.currency ?? 'INR';
  const now = options.now ?? Date.now();
  const joined = rows.join('\n');

  // The receipt's own evidence beats the phone's locale, because the question
  // is how the SHOP printed the date, not how the reader writes one.
  const order = detectDateOrder(joined);
  const dayFirst = order !== null ? order === 'dmy' : (options.dayFirst ?? true);

  const amount = findAmount(rows, currency);
  const date = readDate(joined, now, dayFirst);

  // The categoriser wants the rows, not the flattened text: it reads the
  // masthead and the basket as separate evidence, and that distinction is
  // exactly what a single joined string throws away.
  const resolvedMerchant = merchant ?? findMerchant(rows);
  const category = guessCategory(rows, resolvedMerchant);

  return {
    amountText: amount?.text ?? null,
    amountMinor: amount?.minor ?? null,
    amountFrom: amount?.from ?? null,
    occurredAt: date?.at ?? null,
    dateAlternative: date?.alternative ?? null,
    merchant: resolvedMerchant,
    categoryKey: category.key,
    categoryFrom: category.from,
    categoryEvidence: category.evidence,
    candidates: amountCandidates(rows, currency),
    rows,
  };
}

/**
 * Everything we can work out from one receipt, given plain text.
 * Any field may be null; the confirm screen shows blanks, never guesses.
 */
export function parseReceipt(text: string, options: ParseOptions = {}): ReceiptGuess {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return parseRows(rows, options, null);
}

/**
 * The same, from OCR output that still has its bounding boxes — which is
 * always better, because the rows can be rebuilt as printed rather than as
 * ML Kit happened to concatenate them.
 */
export function parseReceiptFromLines(
  lines: PositionedLine[],
  options: ParseOptions = {},
): ReceiptGuess {
  return parseRows(joinRows(lines), options, findMerchantBySize(lines));
}
