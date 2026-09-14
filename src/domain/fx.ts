/**
 * Currency conversion: the arithmetic, and how old the numbers are.
 *
 * Rates come from the network, so the two questions that matter are *what is
 * this worth* and *should I believe it*. The second is the one converter apps
 * get wrong: they show four decimal places of a rate fetched last Tuesday with
 * nothing to say so, and a number that precise reads as a number that current.
 *
 * Everything here is pure. The fetching and the caching are in
 * `services/rates.ts`; this file only ever sees numbers and a clock.
 */

/** A table of rates against one base currency, as fetched. */
export interface RateTable {
  base: string;
  /** `{ INR: 95.51, EUR: 0.86 }` — how many units per 1 of `base`. */
  rates: Record<string, number>;
  /** When the provider says the rates were set, epoch ms. */
  at: number;
}

/**
 * Convert between any two currencies in the table, including when neither of
 * them is the base.
 *
 * Cross rates go through the base: USD→INR and USD→AED give INR→AED. That is
 * one division and one multiplication, and it is why the app only ever needs to
 * fetch a single table rather than one per pair.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  table: RateTable,
): number | null {
  const rate = rateFor(from, to, table);
  return rate === null ? null : amount * rate;
}

/** The rate from one currency to another, or null if the table cannot say. */
export function rateFor(from: string, to: string, table: RateTable): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return 1;

  const base = table.base.toUpperCase();
  const perBase = (code: string): number | null => {
    if (code === base) return 1;
    const value = table.rates[code];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  };

  const fromRate = perBase(f);
  const toRate = perBase(t);
  if (fromRate === null || toRate === null) return null;

  return toRate / fromRate;
}

/* ----------------------------------------------------------------- freshness */

export type Freshness = 'live' | 'today' | 'stale' | 'old';

/**
 * How much to trust what is on screen.
 *
 * The thresholds are generous on purpose, because the rates this app can get
 * for free are published once a day by central banks and their aggregators.
 * Pretending to a minute-by-minute market rate would be a lie told in four
 * decimal places; what matters is whether the number is from this week or from
 * whenever the phone last had signal.
 */
export function freshnessOf(at: number, now: number = Date.now()): Freshness {
  const age = now - at;
  const hour = 60 * 60 * 1000;

  if (age < 2 * hour) return 'live';
  if (age < 36 * hour) return 'today';
  if (age < 7 * 24 * hour) return 'stale';
  return 'old';
}

/**
 * A sensible number of decimals for showing a *rate* — not an amount.
 *
 * One dollar is 95.51 rupees and 0.86 euros; showing both to two places makes
 * the euro look rounded to nothing. So small rates get more digits, and the
 * result is always something a person can read back.
 */
export function rateDecimals(rate: number): number {
  const value = Math.abs(rate);
  if (value === 0) return 2;
  if (value >= 100) return 2;
  if (value >= 1) return 4;
  if (value >= 0.01) return 5;
  return 6;
}

export function formatRate(rate: number, locale = 'en'): string {
  const decimals = rateDecimals(rate);
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(rate);
  } catch {
    return rate.toFixed(decimals);
  }
}

/**
 * Parse what somebody typed into the amount box.
 *
 * Deliberately forgiving about grouping separators, because a person converting
 * ₹1,00,000 will type it the way their phone shows it. Returns null rather than
 * NaN so the caller never has to test for it.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,  ]/g, '');
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
