/**
 * Exchange rates: fetched when there is signal, remembered when there is not.
 *
 * **This is the first network call in the app that is about the user's own
 * question rather than their own storage**, so it is worth being exact about
 * what leaves the phone: a URL containing one currency code, and nothing else.
 * No amounts, no account, no identifier. The provider learns that somebody
 * somewhere asked what a dollar is worth.
 *
 * Rates are cached in the `fx_rates` table — which has been sitting in the
 * schema since Phase 1 waiting for this — so the converter opens instantly,
 * works on a plane, and never shows an empty screen while a request is in
 * flight. The cache is the source of truth for display; the network only ever
 * updates it.
 *
 * Two providers, tried in order, both free and neither needing a key:
 *
 *   1. **open.er-api.com** — 160-odd currencies including INR, PKR, AED, SAR,
 *      BDT. Updated daily. This is the one that matters for this app's users.
 *   2. **frankfurter.dev** — central-bank rates, fewer currencies, as a
 *      fallback for the day the first one is down.
 *
 * Neither is a trading feed and the screen says so. Free daily rates are the
 * honest ceiling here; a live market rate would mean a paid API and a monthly
 * bill this project does not have.
 */
import { db } from '@/db/client';
import { fxRates } from '@/db/schema';
import type { RateTable } from '@/domain/fx';

/** Everything is fetched against this base and crossed from it. */
export const BASE = 'USD';

const PRIMARY = `https://open.er-api.com/v6/latest/${BASE}`;
const FALLBACK = `https://api.frankfurter.dev/v1/latest?base=${BASE}`;

/** Rows are keyed "USD:INR" in a table built for exactly this. */
const KEY_PREFIX = `${BASE}:`;

/** Give up rather than hang: a converter that spins forever is worse than a stale number. */
const TIMEOUT_MS = 8000;

export interface RatesResult {
  table: RateTable | null;
  /** True when this call actually reached a provider. */
  refreshed: boolean;
  /** Set when a fetch was attempted and failed, for the screen to explain. */
  error: string | null;
}

/* ------------------------------------------------------------------- cache */

export async function cachedTable(): Promise<RateTable | null> {
  const rows = await db.select().from(fxRates);
  const mine = rows.filter((r) => r.pair.startsWith(KEY_PREFIX));
  if (mine.length === 0) return null;

  const rates: Record<string, number> = {};
  let at = 0;
  for (const row of mine) {
    rates[row.pair.slice(KEY_PREFIX.length)] = row.rate;
    if (row.fetchedAt > at) at = row.fetchedAt;
  }

  return { base: BASE, rates, at };
}

async function saveTable(table: RateTable): Promise<void> {
  for (const [code, rate] of Object.entries(table.rates)) {
    const pair = `${KEY_PREFIX}${code}`;
    await db
      .insert(fxRates)
      .values({ pair, rate, fetchedAt: table.at })
      .onConflictDoUpdate({ target: fxRates.pair, set: { rate, fetchedAt: table.at } });
  }
  // Nothing is deleted: a currency a provider stopped quoting is better shown
  // stale than made to vanish from the picker in the middle of a trip.
}

/* ------------------------------------------------------------------- fetch */

async function getJson(url: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

function readNumbers(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object') {
    for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out[code.toUpperCase()] = value;
      }
    }
  }
  return out;
}

async function fetchPrimary(): Promise<RateTable> {
  const json = await getJson(PRIMARY);
  if (json.result !== 'success') throw new Error('provider said no');

  const rates = readNumbers(json.rates);
  if (Object.keys(rates).length === 0) throw new Error('no rates');

  // The provider dates its own numbers. Using that rather than "now" is what
  // lets the screen say honestly how old they are.
  const stamp = Number(json.time_last_update_unix);
  const at = Number.isFinite(stamp) && stamp > 0 ? stamp * 1000 : Date.now();
  return { base: BASE, rates, at };
}

async function fetchFallback(): Promise<RateTable> {
  const json = await getJson(FALLBACK);
  const rates = readNumbers(json.rates);
  if (Object.keys(rates).length === 0) throw new Error('no rates');

  const date = typeof json.date === 'string' ? Date.parse(`${json.date}T00:00:00Z`) : NaN;
  return { base: BASE, rates, at: Number.isFinite(date) ? date : Date.now() };
}

/**
 * The table to show, and whether it is fresh.
 *
 * Always returns the cache when the network fails, and never throws: a
 * converter that shows yesterday's rate with a note is useful, and one that
 * shows an error is not.
 */
export async function getRates(force = false): Promise<RatesResult> {
  const cached = await cachedTable();

  // Once a day is the most these providers publish, so asking more often would
  // spend somebody's mobile data to be told the same number.
  const stale = !cached || Date.now() - cached.at > 12 * 60 * 60 * 1000;
  if (!force && !stale) return { table: cached, refreshed: false, error: null };

  try {
    const table = await fetchPrimary();
    await saveTable(table);
    return { table, refreshed: true, error: null };
  } catch (primaryError) {
    try {
      const table = await fetchFallback();
      await saveTable(table);
      return { table, refreshed: true, error: null };
    } catch {
      return {
        table: cached,
        refreshed: false,
        error: primaryError instanceof Error ? primaryError.message : String(primaryError),
      };
    }
  }
}

/** Currency codes the cached table can actually convert, sorted. */
export function codesIn(table: RateTable | null): string[] {
  if (!table) return [BASE];
  return [...new Set([table.base, ...Object.keys(table.rates)])].sort();
}
