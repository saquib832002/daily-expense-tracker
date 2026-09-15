/**
 * The financial year.
 *
 * Almost every expense app assumes the year starts in January, and for a large
 * part of the world that is simply wrong. India's financial year runs 1 April
 * to 31 March; so does the United Kingdom's corporation year, Japan's, and a
 * dozen others. A user who opens an annual summary in April to sort out their
 * tax and finds it covering January to December is holding a document they
 * cannot use.
 *
 * So the year here is a **setting**, not a constant: a start month from 1 to
 * 12. Everything else — boundaries, labels, the list of months inside a year,
 * which year a date belongs to — derives from it, and all of it is pure
 * functions over local time for the same reason `dates.ts` is: a person
 * thinks in their own calendar, not UTC.
 *
 * Nothing in here is about tax *rules*. It is about where the boundaries sit.
 * What a user does with the resulting statement is between them and their
 * accountant.
 */

/** 1 = January … 12 = December. */
export type YearStartMonth = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * Countries whose financial year does not start in January, for the default
 * on first run.
 *
 * Deliberately short. A wrong guess is a setting the user must find and
 * change, so this lists only places where the April (or other) year is the
 * everyday convention rather than a specialist one — and the setting is one
 * tap away in any case.
 *
 * The United Kingdom is the awkward one: the personal tax year starts on
 * **6** April, not the 1st. This app models a start *month*, so a UK user gets
 * 1 April — five days out, and wrong for a self-assessment return. That is
 * stated in the settings screen rather than papered over.
 */
const APRIL_YEAR = new Set(['IN', 'GB', 'JP', 'NZ', 'ZA', 'HK']);
/** July to June: Australia, and — note, not April — Pakistan and Bangladesh. */
const JULY_YEAR = new Set(['AU', 'PK', 'BD', 'EG']);

/** The sensible default for a region, or January when there is nothing to go on. */
export function defaultYearStartMonth(countryCode: string | null): YearStartMonth {
  if (!countryCode) return 1;
  const code = countryCode.toUpperCase();
  if (APRIL_YEAR.has(code)) return 4;
  if (JULY_YEAR.has(code)) return 7;
  return 1;
}

/** Coerce anything stored or typed into a valid month. Out of range becomes January. */
export function normalizeYearStartMonth(value: unknown): YearStartMonth {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 12) return 1;
  return n as YearStartMonth;
}

/**
 * The start of the financial year containing `ms`, as local midnight on the
 * first day of the start month.
 */
export function fiscalYearStart(ms: number, startMonth: YearStartMonth): number {
  const d = new Date(ms);
  const monthIndex = startMonth - 1;
  // Before the start month, we are still in the year that began last calendar
  // year. 15 February with an April year belongs to the year that began in
  // April of the *previous* calendar year.
  const year = d.getMonth() < monthIndex ? d.getFullYear() - 1 : d.getFullYear();
  return new Date(year, monthIndex, 1, 0, 0, 0, 0).getTime();
}

/**
 * The exclusive end of the financial year containing `ms` — i.e. the start of
 * the next one.
 *
 * Exclusive on purpose. Half-open ranges are the only way to bucket instants
 * without either losing the last millisecond of the year or counting it twice,
 * and "23:59:59.999" is a bug waiting for a device with a finer clock.
 */
export function fiscalYearEnd(ms: number, startMonth: YearStartMonth): number {
  const start = new Date(fiscalYearStart(ms, startMonth));
  return new Date(start.getFullYear() + 1, start.getMonth(), 1, 0, 0, 0, 0).getTime();
}

/** Move `count` financial years from the one containing `ms`. Negative goes back. */
export function addFiscalYears(ms: number, startMonth: YearStartMonth, count: number): number {
  const start = new Date(fiscalYearStart(ms, startMonth));
  return new Date(start.getFullYear() + count, start.getMonth(), 1, 0, 0, 0, 0).getTime();
}

export interface FiscalYear {
  /** Local midnight on the first day. */
  start: number;
  /** Exclusive: local midnight on the first day of the next year. */
  end: number;
  /** Calendar year the year begins in. */
  startYear: number;
  /**
   * Calendar year the year ends *in* — the same as startYear for a January
   * year, one more for any other.
   *
   * Taken from the last instant of the year rather than from `end`, which is
   * exclusive: a January 2026 year ends at midnight on 1 January 2027, and
   * reading the calendar year off that would label it "2026–27".
   */
  endYear: number;
}

export function fiscalYearOf(ms: number, startMonth: YearStartMonth): FiscalYear {
  const start = fiscalYearStart(ms, startMonth);
  const end = fiscalYearEnd(ms, startMonth);
  return {
    start,
    end,
    startYear: new Date(start).getFullYear(),
    endYear: new Date(end - 1).getFullYear(),
  };
}

/**
 * How a financial year is written down.
 *
 * A January year is just "2026". Anything else spans two calendar years and
 * has to say so, because "2026" is ambiguous the moment the year does not
 * match the calendar. The Indian convention is `2026–27`; the two-digit tail
 * is what people actually write, and it is unambiguous for every century this
 * app will see.
 *
 * Uses an en dash, not a hyphen: it is a range.
 */
export function fiscalYearLabel(year: FiscalYear): string {
  if (year.startYear === year.endYear) return String(year.startYear);
  const tail = String(year.endYear % 100).padStart(2, '0');
  return `${year.startYear}–${tail}`;
}

/**
 * Whether a date falls inside a year. Half-open, matching `end`.
 */
export function isInFiscalYear(ms: number, year: FiscalYear): boolean {
  return ms >= year.start && ms < year.end;
}

/**
 * The twelve month-starts inside a financial year, in order.
 *
 * A statement is laid out month by month, and for an April year the columns
 * run April … March rather than January … December. Generating them from the
 * year rather than from a hard-coded list is what makes that fall out for
 * free.
 */
export function monthsOfFiscalYear(year: FiscalYear): number[] {
  const start = new Date(year.start);
  return Array.from({ length: 12 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth() + i, 1, 0, 0, 0, 0).getTime(),
  );
}

/**
 * Every financial year touched by the range `from`–`to`, oldest first.
 *
 * Used to offer a picker of the years a person actually has data in, rather
 * than a list of years they must scroll through to discover are empty.
 */
export function fiscalYearsBetween(
  from: number,
  to: number,
  startMonth: YearStartMonth,
): FiscalYear[] {
  if (to < from) return [];
  const out: FiscalYear[] = [];
  let cursor = fiscalYearStart(from, startMonth);
  const last = fiscalYearStart(to, startMonth);
  // Guard against a pathological range: a hundred years is more than anyone
  // will have, and an unbounded while loop on bad input is how an app hangs.
  for (let i = 0; cursor <= last && i < 200; i++) {
    out.push(fiscalYearOf(cursor, startMonth));
    cursor = addFiscalYears(cursor, startMonth, 1);
  }
  return out;
}

/**
 * Which of a year's months have passed, given "now".
 *
 * A statement for the year in progress should not show eight empty columns as
 * though the money simply was not spent. Returns the count of month buckets
 * that have started, 1–12.
 */
export function monthsElapsed(year: FiscalYear, now: number): number {
  if (now < year.start) return 0;
  if (now >= year.end) return 12;
  const start = new Date(year.start);
  const n = new Date(now);
  const months = (n.getFullYear() - start.getFullYear()) * 12 + (n.getMonth() - start.getMonth());
  return Math.min(12, Math.max(1, months + 1));
}

/** True when the year has not finished yet — a statement for it is provisional. */
export function isCurrentFiscalYear(year: FiscalYear, now: number): boolean {
  return now >= year.start && now < year.end;
}
