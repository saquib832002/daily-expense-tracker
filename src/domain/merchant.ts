/**
 * Merchant normalization.
 *
 * Bank descriptors are noisy: "UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl",
 * "POS 4321 SWIGGY BANGALORE IN", "SWIGGY*ORDER 8821". All three are Swiggy.
 * Collapsing them to one key is what makes rules and merchant memory work —
 * and it is the reason this app needs no AI to categorize.
 *
 * Pure functions. No React, no database.
 */

/** Noise words and rails that carry no merchant identity. */
const NOISE = new Set([
  'UPI', 'POS', 'ATM', 'NEFT', 'IMPS', 'RTGS', 'ACH', 'ECS', 'EMI',
  'DR', 'CR', 'DEBIT', 'CREDIT', 'PAYMENT', 'PAYMENTS', 'PAY', 'TXN', 'TRANSACTION',
  'REF', 'REFNO', 'PURCHASE', 'CARD', 'AC', 'ACCT', 'ACCOUNT', 'BANK',
  'IN', 'IND', 'INDIA', 'LTD', 'PVT', 'PRIVATE', 'LIMITED', 'INC', 'LLP', 'CO',
  'ONLINE', 'ORDER', 'BILL', 'RECHARGE',
]);

/** Common Indian city suffixes that appear on POS descriptors. */
const CITIES = new Set([
  'BANGALORE', 'BENGALURU', 'MUMBAI', 'DELHI', 'NEWDELHI', 'CHENNAI', 'KOLKATA',
  'HYDERABAD', 'PUNE', 'AHMEDABAD', 'JAIPUR', 'LUCKNOW', 'NOIDA', 'GURGAON',
  'GURUGRAM', 'KOCHI', 'INDORE', 'BHOPAL', 'PATNA', 'SURAT', 'NAGPUR',
]);

/**
 * Reduce a raw bank descriptor to a stable key.
 * Returns '' when nothing identifying survives.
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  if (!raw) return '';

  let s = raw.toUpperCase();

  // A UPI handle is the most reliable identity we get — keep its local part.
  const vpa = s.match(/([A-Z0-9._-]{3,})@[A-Z]{2,}/);
  if (vpa?.[1]) s = vpa[1];

  // Split on anything that isn't a letter or digit.
  const tokens = s
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    // Drop pure numbers (reference ids, card fragments, amounts) and short noise.
    .filter((t) => !/^\d+$/.test(t))
    // Drop tokens that are mostly digits, e.g. "X4321" or "REF9982A".
    .filter((t) => (t.replace(/\d/g, '').length / t.length) > 0.5)
    .filter((t) => !NOISE.has(t))
    .filter((t) => !CITIES.has(t));

  if (tokens.length === 0) return '';

  // Two tokens is enough to identify a merchant and keeps the key stable.
  return tokens.slice(0, 2).join(' ');
}

/** A human-friendly version of the key, for showing in the UI. */
export function prettyMerchant(key: string): string {
  if (!key) return '';
  return key
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
