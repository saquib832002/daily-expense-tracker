/**
 * Changing the base currency.
 *
 * The base currency is the one every report is labelled in, and it was decided
 * once — at first launch, from the phone's region code — and then never again.
 * That is fine right up until the guess is wrong, and then it is permanent.
 *
 * The subtle part is not the label, it is the decimals.
 *
 * Amounts are stored as integer minor units, and how much a minor unit is
 * worth depends entirely on the currency: 123456 is ₹1,234.56 in rupees,
 * ¥123,456 in yen, and 123.456 dinar in Kuwait. Reports sum `baseAmountMinor`
 * and hand the total to `formatMinor` with the base currency. So relabelling
 * INR as KWD without touching the stored integers would quietly divide every
 * historical total by ten, and relabelling it as JPY would multiply it by a
 * hundred — no error, no warning, just a dashboard that has become fiction.
 *
 * So the stored integers are rescaled to the new currency's precision. This
 * deliberately does NOT apply an exchange rate: the numbers keep the same
 * value, they are just re-denominated. That matches what someone actually
 * means when they change this setting — "these were always dirhams, the app
 * guessed rupees" — and it is the only honest thing to do in an app that has
 * no exchange rates.
 */
import { decimalsFor, type CurrencyCode } from './money';

/**
 * Restate an amount held in `from`'s minor units as `to`'s minor units.
 *
 * Rounds half-away-from-zero when precision is lost, so -1250 → -13 rather
 * than -12: an expense must not shrink because of a currency change.
 */
export function rescaleMinor(
  minor: number,
  from: CurrencyCode,
  to: CurrencyCode,
): number {
  const shift = decimalsFor(to) - decimalsFor(from);
  if (shift === 0) return minor;

  if (shift > 0) return minor * Math.pow(10, shift);

  const divisor = Math.pow(10, -shift);
  const sign = minor < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(minor) / divisor);
}

/** True when the two currencies keep amounts at the same precision. */
export function sameScale(from: CurrencyCode, to: CurrencyCode): boolean {
  return decimalsFor(from) === decimalsFor(to);
}

/**
 * What a base-currency change is about to do, so the screen can say it out
 * loud before anything is written.
 */
export interface RebasePlan {
  from: CurrencyCode;
  to: CurrencyCode;
  /** Are stored integers going to be rewritten? */
  rescales: boolean;
  /** Every currency currently in the ledger, base excluded. */
  otherCurrencies: string[];
  /**
   * Totals will silently mix currencies at 1:1, because this app holds no
   * exchange rates. True whenever more than one currency is in play.
   */
  mixes: boolean;
}

export function planRebase(
  from: CurrencyCode,
  to: CurrencyCode,
  ledgerCurrencies: string[],
): RebasePlan {
  const others = [...new Set(ledgerCurrencies.map((c) => c.toUpperCase()))]
    .filter((c) => c !== to.toUpperCase())
    .sort();

  return {
    from,
    to,
    rescales: !sameScale(from, to),
    otherCurrencies: others,
    mixes: others.length > 0,
  };
}
