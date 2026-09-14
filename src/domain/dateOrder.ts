/**
 * Which way round a country writes its dates.
 *
 * This exists because of a bug that cost a real round of debugging: a receipt
 * from a US shop reading 9/3 was entered as 9 March instead of 3 September. The
 * scanner was asking "does this user write day first?" and getting its answer
 * from the *interface language* — which was English, mapped to `en-IN`, which
 * says day first. The user's phone was set to the United States the whole time.
 * Nobody had asked it.
 *
 * Language and country are different questions and the app had been conflating
 * them. An Indian who runs their phone in English still wants 03/09/2026; an
 * American who switches this app to Hindi still wants 9/3/2026 to mean
 * September. The words come from the language. The order comes from the region.
 *
 * Asked of ICU rather than kept as a country list, because a table of 195
 * countries is a table that is wrong somewhere and that nobody will ever
 * revisit. Every phone already carries this data.
 */

/** Day-month-year, month-day-year, or year-month-day. */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

const cache = new Map<string, DateOrder>();

/**
 * How this locale orders a numeric date.
 *
 * India, the UK and most of the world: `dmy`. The United States and a handful
 * of others: `mdy`. Japan, China, Korea, Hungary, and ISO-8601 style: `ymd`.
 */
export function dateOrderFor(locale: string): DateOrder {
  const hit = cache.get(locale);
  if (hit) return hit;

  let order: DateOrder = 'dmy';
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(new Date(2026, 0, 2));

    // Only the three fields matter; literals and era markers are noise.
    const sequence = parts
      .map((p) => p.type)
      .filter((t): t is 'day' | 'month' | 'year' => t === 'day' || t === 'month' || t === 'year');

    const first = sequence[0];
    if (first === 'year') order = 'ymd';
    else if (first === 'month') order = 'mdy';
    else if (first === 'day') order = 'dmy';
  } catch {
    // No ICU. Day-first is right for the large majority of the world, and it
    // is what this app already assumed before any of this existed.
  }

  cache.set(locale, order);
  return order;
}

/**
 * Does this locale put the day before the month?
 *
 * `ymd` counts as day-before-month for the scanner's purposes: a locale writing
 * 2026/01/02 puts the smaller unit last, and when it drops the year it writes
 * 01/02 as month then day — so it is asked separately below.
 */
export function prefersDayFirstIn(locale: string): boolean {
  return dateOrderFor(locale) === 'dmy';
}

/**
 * A short human example of the order, for showing someone what the app decided
 * — "31/12/2026", "12/31/2026", "2026/12/31". A setting nobody can see is a
 * setting nobody can correct.
 */
export function dateOrderExample(order: DateOrder): string {
  switch (order) {
    case 'mdy':
      return '12/31/2026';
    case 'ymd':
      return '2026/12/31';
    default:
      return '31/12/2026';
  }
}
