/**
 * The annual statement.
 *
 * One year of a person's money, laid out the way an accountant — or the
 * person themselves in March — actually wants to read it: a grid of category
 * against month, with totals down the side and along the bottom, and the
 * numbers reconciling in both directions.
 *
 * This file does the arithmetic and nothing else. It does not format money, it
 * does not know what a PDF is, and it has no opinion about April. It takes
 * rows and a year, and returns a table. That is what makes it testable, and a
 * statement whose totals are wrong is worse than no statement at all —
 * somebody files it.
 *
 * Amounts are integer minor units throughout, signed as the ledger stores them
 * (expenses negative, income positive). The grid reports **positive** spend,
 * because a column of negative numbers is not how anybody reads a summary; the
 * sign lives in which section a row belongs to instead.
 */

import { isInFiscalYear, monthsOfFiscalYear, type FiscalYear } from './fiscalYear';

export interface StatementRow {
  occurredAt: number;
  /** Signed minor units, as stored. */
  amountMinor: number;
  /** Category id, or null for uncategorised. */
  categoryId: string | null;
  /** Human label for the category, resolved by the caller. */
  categoryName: string;
  /** True for income rows. Transfers must not be passed in at all — see below. */
  isIncome: boolean;
}

export interface StatementLine {
  key: string;
  label: string;
  /** Twelve buckets, in the year's own month order. Positive minor units. */
  monthly: number[];
  /** Sum of `monthly`. */
  totalMinor: number;
  /** Share of the section total, 0–1. Zero when the section is empty. */
  fraction: number;
}

export interface StatementSection {
  lines: StatementLine[];
  /** Twelve buckets summed across every line. */
  monthly: number[];
  totalMinor: number;
}

export interface Statement {
  year: FiscalYear;
  /** Month starts, in the year's order — April first for an April year. */
  months: number[];
  expenses: StatementSection;
  income: StatementSection;
  /** income.monthly[i] − expenses.monthly[i]. Can be negative. */
  netMonthly: number[];
  netTotalMinor: number;
  /** How many of the rows handed in actually fell inside the year. */
  rowsCounted: number;
  /** Rows outside the year, ignored. Surfaced so a caller can notice a bug. */
  rowsSkipped: number;
}

const UNCATEGORISED = '__uncategorised__';

function emptyMonths(): number[] {
  return Array<number>(12).fill(0);
}

/**
 * Which of the year's twelve buckets an instant belongs to, or −1 if outside.
 *
 * Done by calendar month arithmetic rather than by comparing against the
 * bucket boundaries, so a month of any length lands correctly and a DST
 * change cannot shift a transaction into the neighbouring column.
 */
function bucketFor(ms: number, year: FiscalYear): number {
  if (!isInFiscalYear(ms, year)) return -1;
  const start = new Date(year.start);
  const d = new Date(ms);
  const index = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
  return index >= 0 && index < 12 ? index : -1;
}

function buildSection(rows: StatementRow[], year: FiscalYear): StatementSection {
  const byCategory = new Map<string, { label: string; monthly: number[] }>();
  const monthly = emptyMonths();

  for (const row of rows) {
    const bucket = bucketFor(row.occurredAt, year);
    if (bucket < 0) continue;

    const key = row.categoryId ?? UNCATEGORISED;
    let line = byCategory.get(key);
    if (!line) {
      line = { label: row.categoryName, monthly: emptyMonths() };
      byCategory.set(key, line);
    }
    const amount = Math.abs(row.amountMinor);
    line.monthly[bucket] = (line.monthly[bucket] ?? 0) + amount;
    monthly[bucket] = (monthly[bucket] ?? 0) + amount;
  }

  const totalMinor = monthly.reduce((sum, n) => sum + n, 0);

  const lines: StatementLine[] = [...byCategory.entries()]
    .map(([key, line]) => {
      const lineTotal = line.monthly.reduce((sum, n) => sum + n, 0);
      return {
        key,
        label: line.label,
        monthly: line.monthly,
        totalMinor: lineTotal,
        fraction: totalMinor === 0 ? 0 : lineTotal / totalMinor,
      };
    })
    // Biggest first, then by label so the order is stable between runs — a
    // statement that reshuffles its rows every time it is regenerated looks
    // untrustworthy even when the numbers are identical.
    .sort((a, b) => b.totalMinor - a.totalMinor || a.label.localeCompare(b.label));

  return { lines, monthly, totalMinor };
}

/**
 * Build the statement.
 *
 * **Transfers must not be in `rows`.** Money moved from a bank account to a
 * wallet is not spending, and counting it inflates the year by the size of a
 * person's own housekeeping. The caller filters them out, because only the
 * caller knows how this ledger marks them — and a silent double-count is
 * exactly the kind of error that survives into a document somebody files.
 */
export function buildStatement(rows: StatementRow[], year: FiscalYear): Statement {
  const inside = rows.filter((r) => bucketFor(r.occurredAt, year) >= 0);

  const expenses = buildSection(
    inside.filter((r) => !r.isIncome),
    year,
  );
  const income = buildSection(
    inside.filter((r) => r.isIncome),
    year,
  );

  const netMonthly = income.monthly.map((n, i) => n - (expenses.monthly[i] ?? 0));

  return {
    year,
    months: monthsOfFiscalYear(year),
    expenses,
    income,
    netMonthly,
    netTotalMinor: income.totalMinor - expenses.totalMinor,
    rowsCounted: inside.length,
    rowsSkipped: rows.length - inside.length,
  };
}

/**
 * The three sentences worth putting at the top of the statement.
 *
 * Returned as data rather than as a formatted string so the caller can
 * translate and format the money. `busiestMonth` is an index into
 * `statement.months`, or null when nothing was spent at all.
 */
export interface StatementHighlights {
  totalSpentMinor: number;
  totalEarnedMinor: number;
  netMinor: number;
  /** Mean across months that have actually elapsed, not across twelve. */
  averageMonthlySpendMinor: number;
  busiestMonth: number | null;
  busiestMonthAmountMinor: number;
  biggestCategory: StatementLine | null;
}

export function highlightsOf(statement: Statement, monthsElapsed: number): StatementHighlights {
  const divisor = Math.min(12, Math.max(1, Math.trunc(monthsElapsed)));

  let busiestMonth: number | null = null;
  let busiestMonthAmountMinor = 0;
  statement.expenses.monthly.forEach((amount, i) => {
    if (amount > busiestMonthAmountMinor) {
      busiestMonthAmountMinor = amount;
      busiestMonth = i;
    }
  });

  return {
    totalSpentMinor: statement.expenses.totalMinor,
    totalEarnedMinor: statement.income.totalMinor,
    netMinor: statement.netTotalMinor,
    // Divided by months *elapsed*, not twelve. Averaging a part-finished year
    // over twelve reports a monthly spend the person has never had, and it is
    // always too low — which is the flattering direction, and therefore the
    // one to be most careful about.
    averageMonthlySpendMinor: Math.round(statement.expenses.totalMinor / divisor),
    busiestMonth,
    busiestMonthAmountMinor,
    biggestCategory: statement.expenses.lines[0] ?? null,
  };
}

/**
 * The statement as a rectangular grid, for CSV and for the spreadsheet.
 *
 * One function rather than two, because the day CSV and XLSX disagree about a
 * total is the day both become useless. The difference between them is only
 * how a cell is rendered, so that is the only thing the caller supplies:
 * CSV passes a formatter returning a decimal *string*, XLSX passes one
 * returning a *number* so the cells can be summed in the sheet.
 *
 * Either way the caller converts out of minor units. A spreadsheet column of
 * "45000" meaning ₹450.00 is a support request waiting to happen.
 */
export function statementToGrid(
  statement: Statement,
  monthLabels: string[],
  labels: { category: string; total: string; expenses: string; income: string; net: string },
  toDecimal: (minor: number) => string | number,
): (string | number)[][] {
  const out: (string | number)[][] = [];
  out.push([labels.category, ...monthLabels, labels.total]);

  const section = (title: string, s: StatementSection) => {
    out.push([title]);
    for (const line of s.lines) {
      out.push([line.label, ...line.monthly.map(toDecimal), toDecimal(line.totalMinor)]);
    }
    out.push([title, ...s.monthly.map(toDecimal), toDecimal(s.totalMinor)]);
  };

  section(labels.expenses, statement.expenses);
  if (statement.income.lines.length > 0) section(labels.income, statement.income);

  out.push([labels.net, ...statement.netMonthly.map(toDecimal), toDecimal(statement.netTotalMinor)]);
  return out;
}
