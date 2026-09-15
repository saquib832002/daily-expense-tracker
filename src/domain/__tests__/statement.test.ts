import { describe, expect, it } from '@jest/globals';

import { fiscalYearOf } from '../fiscalYear';
import {
  buildStatement,
  highlightsOf,
  statementToGrid,
  type StatementRow,
} from '../statement';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime();

/** April 2026 – March 2027. */
const YEAR = fiscalYearOf(at(2026, 6, 1), 4);

const spend = (
  when: number,
  amount: number,
  categoryId: string | null,
  categoryName: string,
): StatementRow => ({
  occurredAt: when,
  amountMinor: -amount,
  categoryId,
  categoryName,
  isIncome: false,
});

const earn = (when: number, amount: number): StatementRow => ({
  occurredAt: when,
  amountMinor: amount,
  categoryId: 'salary',
  categoryName: 'Salary',
  isIncome: true,
});

describe('buildStatement bucketing', () => {
  it('puts April in the first column and March in the twelfth', () => {
    const s = buildStatement(
      [spend(at(2026, 4, 2), 1000, 'food', 'Food'), spend(at(2027, 3, 30), 2000, 'food', 'Food')],
      YEAR,
    );
    expect(s.expenses.monthly[0]).toBe(1000);
    expect(s.expenses.monthly[11]).toBe(2000);
    expect(s.expenses.totalMinor).toBe(3000);
  });

  it('ignores rows outside the year and says how many', () => {
    const s = buildStatement(
      [
        spend(at(2026, 3, 31), 500, 'food', 'Food'), // previous year
        spend(at(2026, 5, 1), 700, 'food', 'Food'),
        spend(at(2027, 4, 1), 900, 'food', 'Food'), // next year
      ],
      YEAR,
    );
    expect(s.rowsCounted).toBe(1);
    expect(s.rowsSkipped).toBe(2);
    expect(s.expenses.totalMinor).toBe(700);
  });

  it('is empty, not broken, with no rows at all', () => {
    const s = buildStatement([], YEAR);
    expect(s.expenses.lines).toEqual([]);
    expect(s.expenses.monthly).toHaveLength(12);
    expect(s.expenses.totalMinor).toBe(0);
    expect(s.netTotalMinor).toBe(0);
  });
});

describe('buildStatement totals reconcile', () => {
  const rows = [
    spend(at(2026, 4, 5), 1200, 'food', 'Food'),
    spend(at(2026, 4, 20), 800, 'travel', 'Travel'),
    spend(at(2026, 9, 9), 5000, 'food', 'Food'),
    spend(at(2027, 1, 1), 300, null, 'Uncategorised'),
    earn(at(2026, 4, 1), 50000),
    earn(at(2026, 5, 1), 50000),
  ];

  it('sums each line across months to that line total', () => {
    const s = buildStatement(rows, YEAR);
    for (const line of s.expenses.lines) {
      expect(line.monthly.reduce((a, b) => a + b, 0)).toBe(line.totalMinor);
    }
  });

  it('sums the lines down each month to the section month total', () => {
    const s = buildStatement(rows, YEAR);
    for (let i = 0; i < 12; i++) {
      const down = s.expenses.lines.reduce((sum, l) => sum + (l.monthly[i] ?? 0), 0);
      expect(down).toBe(s.expenses.monthly[i]);
    }
  });

  it('agrees whichever way the grand total is reached', () => {
    const s = buildStatement(rows, YEAR);
    const acrossMonths = s.expenses.monthly.reduce((a, b) => a + b, 0);
    const downLines = s.expenses.lines.reduce((sum, l) => sum + l.totalMinor, 0);
    expect(acrossMonths).toBe(s.expenses.totalMinor);
    expect(downLines).toBe(s.expenses.totalMinor);
    expect(s.expenses.totalMinor).toBe(1200 + 800 + 5000 + 300);
  });

  it('computes net as income minus expenses, month by month', () => {
    const s = buildStatement(rows, YEAR);
    expect(s.income.totalMinor).toBe(100000);
    expect(s.netTotalMinor).toBe(100000 - 7300);
    // April: earned 50000, spent 2000.
    expect(s.netMonthly[0]).toBe(48000);
    // September: earned nothing, spent 5000 — net is negative, and that is a
    // fact the statement must be willing to print.
    expect(s.netMonthly[5]).toBe(-5000);
  });
});

describe('buildStatement lines', () => {
  it('reports positive amounts even though expenses are stored negative', () => {
    const s = buildStatement([spend(at(2026, 5, 1), 2500, 'food', 'Food')], YEAR);
    expect(s.expenses.lines[0]!.totalMinor).toBe(2500);
  });

  it('groups uncategorised rows together under one line', () => {
    const s = buildStatement(
      [spend(at(2026, 5, 1), 100, null, 'Uncategorised'), spend(at(2026, 6, 1), 200, null, 'Uncategorised')],
      YEAR,
    );
    expect(s.expenses.lines).toHaveLength(1);
    expect(s.expenses.lines[0]!.totalMinor).toBe(300);
  });

  it('orders lines biggest first', () => {
    const s = buildStatement(
      [
        spend(at(2026, 5, 1), 100, 'a', 'Aaa'),
        spend(at(2026, 5, 1), 900, 'b', 'Bbb'),
        spend(at(2026, 5, 1), 500, 'c', 'Ccc'),
      ],
      YEAR,
    );
    expect(s.expenses.lines.map((l) => l.label)).toEqual(['Bbb', 'Ccc', 'Aaa']);
  });

  it('breaks ties by label so the order does not change between runs', () => {
    const s = buildStatement(
      [spend(at(2026, 5, 1), 100, 'z', 'Zzz'), spend(at(2026, 5, 1), 100, 'a', 'Aaa')],
      YEAR,
    );
    expect(s.expenses.lines.map((l) => l.label)).toEqual(['Aaa', 'Zzz']);
  });

  it('gives fractions that sum to one', () => {
    const s = buildStatement(
      [
        spend(at(2026, 5, 1), 250, 'a', 'Aaa'),
        spend(at(2026, 6, 1), 750, 'b', 'Bbb'),
      ],
      YEAR,
    );
    const sum = s.expenses.lines.reduce((acc, l) => acc + l.fraction, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(s.expenses.lines[0]!.fraction).toBeCloseTo(0.75, 10);
  });
});

describe('highlightsOf', () => {
  const rows = [
    spend(at(2026, 4, 5), 1000, 'food', 'Food'),
    spend(at(2026, 5, 5), 9000, 'rent', 'Rent'),
    spend(at(2026, 6, 5), 2000, 'food', 'Food'),
  ];

  it('averages over months elapsed, not over twelve', () => {
    const s = buildStatement(rows, YEAR);
    // Three months in: 12000 over 3 is 4000. Dividing by 12 would report 1000,
    // which is both wrong and flattering.
    expect(highlightsOf(s, 3).averageMonthlySpendMinor).toBe(4000);
    expect(highlightsOf(s, 12).averageMonthlySpendMinor).toBe(1000);
  });

  it('never divides by zero', () => {
    const s = buildStatement(rows, YEAR);
    expect(highlightsOf(s, 0).averageMonthlySpendMinor).toBe(12000);
  });

  it('finds the busiest month and the biggest category', () => {
    const s = buildStatement(rows, YEAR);
    const h = highlightsOf(s, 3);
    expect(h.busiestMonth).toBe(1); // May, the second bucket of an April year
    expect(h.busiestMonthAmountMinor).toBe(9000);
    expect(h.biggestCategory?.label).toBe('Rent');
  });

  it('reports no busiest month when nothing was spent', () => {
    const h = highlightsOf(buildStatement([], YEAR), 6);
    expect(h.busiestMonth).toBeNull();
    expect(h.biggestCategory).toBeNull();
  });
});

describe('statementToGrid', () => {
  const labels = {
    category: 'Category',
    total: 'Total',
    expenses: 'Expenses',
    income: 'Income',
    net: 'Net',
  };
  const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const toDecimal = (minor: number) => (minor / 100).toFixed(2);

  it('has a header of the right width', () => {
    const grid = statementToGrid(buildStatement([], YEAR), months, labels, toDecimal);
    expect(grid[0]).toHaveLength(14); // label + 12 months + total
  });

  it('writes money as decimals, not minor units', () => {
    const s = buildStatement([spend(at(2026, 4, 1), 45000, 'food', 'Food')], YEAR);
    const grid = statementToGrid(s, months, labels, toDecimal);
    const food = grid.find((r) => r[0] === 'Food');
    expect(food?.[1]).toBe('450.00');
    expect(food?.[13]).toBe('450.00');
  });

  it('omits the income section when there is no income', () => {
    const s = buildStatement([spend(at(2026, 4, 1), 100, 'food', 'Food')], YEAR);
    const grid = statementToGrid(s, months, labels, toDecimal);
    expect(grid.some((r) => r[0] === 'Income')).toBe(false);
    expect(grid.some((r) => r[0] === 'Net')).toBe(true);
  });

  it('includes an income section when there is income', () => {
    const s = buildStatement(
      [spend(at(2026, 4, 1), 100, 'food', 'Food'), earn(at(2026, 4, 1), 5000)],
      YEAR,
    );
    const grid = statementToGrid(s, months, labels, toDecimal);
    expect(grid.filter((r) => r[0] === 'Income')).toHaveLength(2); // heading + total
  });

  it('keeps every row the same width, so the sheet is rectangular apart from headings', () => {
    const s = buildStatement(
      [spend(at(2026, 4, 1), 100, 'food', 'Food'), earn(at(2026, 4, 1), 5000)],
      YEAR,
    );
    const grid = statementToGrid(s, months, labels, toDecimal);
    for (const row of grid) {
      expect(row.length === 14 || row.length === 1).toBe(true);
    }
  });
});
