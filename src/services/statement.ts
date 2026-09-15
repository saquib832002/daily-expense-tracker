/**
 * Turning a financial year into a document somebody can file.
 *
 * Three formats, one set of numbers. The grid is built once, in
 * `domain/statement`, and each writer renders the same grid — because the day
 * the PDF and the spreadsheet disagree about a total is the day both become
 * worthless, and nobody finds out until an accountant does.
 *
 * - **PDF** — what people actually want. Rendered from HTML by `expo-print`,
 *   which uses Android's own print pipeline, so there is no PDF library in the
 *   bundle and no font to ship.
 * - **XLSX** — a real spreadsheet with real numbers, written by hand into the
 *   JSZip that was already here for backups.
 * - **CSV** — the format that will still open in 2040.
 *
 * Everything happens on the device. Nothing is uploaded, and the file goes to
 * the share sheet, where the user decides who sees their year.
 */
import * as Print from 'expo-print';
import JSZip from 'jszip';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getBaseCurrency, getYearStartMonth, listCategories, listTransactions } from '@/db/queries';
import {
  fiscalYearOf,
  fiscalYearLabel,
  fiscalYearsBetween,
  isCurrentFiscalYear,
  monthsElapsed,
  type FiscalYear,
} from '@/domain/fiscalYear';
import { minorToDecimalString, formatMinor } from '@/domain/money';
import {
  buildStatement,
  highlightsOf,
  statementToGrid,
  type Statement,
  type StatementRow,
} from '@/domain/statement';
import { toCsv, xlsxParts, safeSheetName } from '@/domain/xlsx';
import { t } from '@/i18n';
import { suggestedName } from './files';

export type StatementFormat = 'pdf' | 'xlsx' | 'csv';

export interface StatementResult {
  ok: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ gather */

/**
 * Which financial years this ledger has data in.
 *
 * Offered instead of a free year picker so nobody generates a beautiful,
 * empty statement for 2019 and concludes the feature is broken.
 */
export async function availableYears(): Promise<FiscalYear[]> {
  const startMonth = await getYearStartMonth();
  // A wide net rather than a MIN/MAX query: this runs once, when a picker
  // opens, and correctness here matters more than one fewer table scan.
  const all = await listTransactions(0, Date.now() + 1);
  if (all.length === 0) return [fiscalYearOf(Date.now(), startMonth)];

  let earliest = Number.POSITIVE_INFINITY;
  let latest = 0;
  for (const row of all) {
    if (row.occurredAt < earliest) earliest = row.occurredAt;
    if (row.occurredAt > latest) latest = row.occurredAt;
  }
  // Include the year in progress even when nothing has been recorded in it
  // yet — it is the one most people open first.
  return fiscalYearsBetween(earliest, Math.max(latest, Date.now()), startMonth).reverse();
}

/**
 * Read a year out of the database and aggregate it.
 *
 * Amounts come from `baseAmountMinor`, not `amountMinor`: an account in
 * dirhams and an account in rupees cannot be added together, and the base
 * figure was converted at entry time so historical totals never shift when a
 * rate moves.
 *
 * Transfers are dropped. Moving money from a bank account to a wallet is not
 * spending, and counting both legs would inflate the year by the size of a
 * person's own housekeeping.
 */
export async function statementFor(year: FiscalYear): Promise<Statement> {
  const [rows, expenseCategories, incomeCategories] = await Promise.all([
    listTransactions(year.start, year.end),
    listCategories('expense'),
    listCategories('income'),
  ]);

  // A category is either one the user typed (`customName`) or one this app
  // seeded, which is stored as a translation key so that a Hindi user sees a
  // Hindi statement. Resolving it here rather than in the domain keeps
  // `buildStatement` free of `t()` and therefore testable.
  const names = new Map<string, string>();
  for (const c of [...expenseCategories, ...incomeCategories]) {
    names.set(c.id, c.customName ?? (c.nameKey ? t(c.nameKey) : t('statement.uncategorised')));
  }

  const statementRows: StatementRow[] = rows
    .filter((r) => r.kind === 'expense' || r.kind === 'income')
    .map((r) => ({
      occurredAt: r.occurredAt,
      amountMinor: r.baseAmountMinor,
      categoryId: r.categoryId,
      categoryName: r.categoryId
        ? (names.get(r.categoryId) ?? t('statement.uncategorised'))
        : t('statement.uncategorised'),
      isIncome: r.kind === 'income',
    }));

  return buildStatement(statementRows, year);
}

/* ------------------------------------------------------------------ labels */

/** Short month names in the year's own order, in the user's language. */
function monthLabels(statement: Statement): string[] {
  return statement.months.map((ms) => {
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(ms));
    } catch {
      return String(new Date(ms).getMonth() + 1);
    }
  });
}

function gridLabels() {
  return {
    category: t('statement.category'),
    total: t('statement.total'),
    expenses: t('statement.expenses'),
    income: t('statement.income'),
    net: t('statement.net'),
  };
}

/* --------------------------------------------------------------------- PDF */

/** Minimal escaping for values interpolated into the report HTML. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The statement as a printable page.
 *
 * Deliberately plain: black on white, one accent, no images. It is a document
 * that may be printed, emailed to an accountant, or read on a phone, and the
 * only thing that matters is that the numbers are legible and the columns line
 * up. `@page` gives it landscape and a margin, because thirteen columns do not
 * fit on a portrait page and a table that wraps is a table nobody can read.
 */
export function statementHtml(
  statement: Statement,
  currency: string,
  now: number,
  appName: string,
): string {
  const months = monthLabels(statement);
  const label = fiscalYearLabel(statement.year);
  const elapsed = monthsElapsed(statement.year, now);
  const high = highlightsOf(statement, elapsed);
  const money = (minor: number) => esc(formatMinor(minor, currency));
  const provisional = isCurrentFiscalYear(statement.year, now);

  const cell = (minor: number) =>
    `<td class="n${minor === 0 ? ' zero' : ''}">${minor === 0 ? '—' : money(minor)}</td>`;

  const section = (title: string, s: Statement['expenses']) =>
    s.lines.length === 0
      ? ''
      : `<tr class="head"><th colspan="${months.length + 2}">${esc(title)}</th></tr>` +
        s.lines
          .map(
            (line) =>
              `<tr><th class="cat">${esc(line.label)}</th>` +
              line.monthly.map(cell).join('') +
              `<td class="n total">${money(line.totalMinor)}</td></tr>`,
          )
          .join('') +
        `<tr class="sum"><th class="cat">${esc(title)}</th>` +
        s.monthly.map(cell).join('') +
        `<td class="n total">${money(s.totalMinor)}</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; color: #111; font-size: 9pt; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  .sub { color: #555; margin: 0 0 5mm; font-size: 9pt; }
  .note { background: #FFF6E0; border-left: 3px solid #C98A00; padding: 2mm 3mm; margin: 0 0 5mm; }
  .cards { display: flex; gap: 4mm; margin: 0 0 6mm; }
  .card { flex: 1; border: 1px solid #DDD; border-radius: 2mm; padding: 3mm; }
  .card .k { color: #666; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em; }
  .card .v { font-size: 13pt; font-weight: 700; margin-top: 1mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 1.4mm 1.6mm; border-bottom: 1px solid #EEE; }
  thead th { border-bottom: 1.5px solid #333; font-size: 8pt; text-transform: uppercase;
             letter-spacing: .03em; color: #444; }
  .cat { text-align: left; font-weight: 400; }
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .zero { color: #BBB; }
  .total { font-weight: 600; }
  tr.head th { background: #F3F3F3; text-align: left; font-weight: 700; padding-top: 3mm; }
  tr.sum th, tr.sum td { border-top: 1px solid #333; font-weight: 700; }
  tr.net th, tr.net td { border-top: 2px solid #111; border-bottom: none; font-weight: 700;
                         font-size: 10pt; padding-top: 2.5mm; }
  footer { margin-top: 6mm; color: #777; font-size: 7.5pt; }
</style></head><body>
<h1>${esc(t('statement.title'))} ${esc(label)}</h1>
<p class="sub">${esc(appName)} · ${esc(t('statement.generatedOn', { date: new Date(now).toLocaleDateString() }))}</p>
${provisional ? `<p class="note">${esc(t('statement.provisional'))}</p>` : ''}
<div class="cards">
  <div class="card"><div class="k">${esc(t('statement.totalSpent'))}</div><div class="v">${money(high.totalSpentMinor)}</div></div>
  <div class="card"><div class="k">${esc(t('statement.totalEarned'))}</div><div class="v">${money(high.totalEarnedMinor)}</div></div>
  <div class="card"><div class="k">${esc(t('statement.net'))}</div><div class="v">${money(high.netMinor)}</div></div>
  <div class="card"><div class="k">${esc(t('statement.monthlyAverage'))}</div><div class="v">${money(high.averageMonthlySpendMinor)}</div></div>
</div>
<table>
  <thead><tr><th class="cat">${esc(t('statement.category'))}</th>
  ${months.map((m) => `<th class="n">${esc(m)}</th>`).join('')}
  <th class="n">${esc(t('statement.total'))}</th></tr></thead>
  <tbody>
    ${section(t('statement.expenses'), statement.expenses)}
    ${section(t('statement.income'), statement.income)}
    <tr class="net"><th class="cat">${esc(t('statement.net'))}</th>
    ${statement.netMonthly.map(cell).join('')}
    <td class="n total">${money(statement.netTotalMinor)}</td></tr>
  </tbody>
</table>
<footer>${esc(t('statement.footer'))}</footer>
</body></html>`;
}

/* ------------------------------------------------------------------ export */

/**
 * Build the file and hand it to the share sheet.
 *
 * Written to the cache directory rather than to documents: once it has been
 * shared, the copy that matters is the user's, and the OS clears the cache
 * rather than letting a year of statements pile up invisibly.
 */
export async function exportStatement(
  year: FiscalYear,
  format: StatementFormat,
  now: number = Date.now(),
  appName = 'Expense Tracker',
): Promise<StatementResult> {
  try {
    const [statement, currency] = await Promise.all([statementFor(year), getBaseCurrency()]);

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, error: 'sharingUnavailable' };
    }

    const label = fiscalYearLabel(year).replace('–', '-');
    const base = `statement-${label}`;

    if (format === 'pdf') {
      const html = statementHtml(statement, currency, now, appName);
      // `printToFileAsync` writes to a temporary name; move it so the share
      // sheet offers something meaningful rather than "a1b2c3.pdf".
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const target = `${FileSystem.cacheDirectory}${base}.pdf`;
      try {
        await FileSystem.deleteAsync(target, { idempotent: true });
        await FileSystem.moveAsync({ from: uri, to: target });
      } catch {
        // A rename failing is not a reason to lose the document.
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
        return { ok: true };
      }
      await Sharing.shareAsync(target, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
      return { ok: true };
    }

    const months = monthLabels(statement);

    if (format === 'csv') {
      const grid = statementToGrid(statement, months, gridLabels(), (minor) =>
        minorToDecimalString(minor, currency),
      );
      const uri = `${FileSystem.cacheDirectory}${base}.csv`;
      await FileSystem.writeAsStringAsync(uri, toCsv(grid), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
      return { ok: true };
    }

    // XLSX. Numbers stay numbers so the columns can be summed in the sheet —
    // which is the entire reason to offer a spreadsheet rather than a second
    // CSV with a different extension.
    const grid = statementToGrid(statement, months, gridLabels(), (minor) =>
      Number(minorToDecimalString(minor, currency)),
    );
    const zip = new JSZip();
    for (const part of xlsxParts(grid, {
      name: safeSheetName(`${t('statement.title')} ${fiscalYearLabel(year)}`),
      boldHeader: true,
      columnWidths: [26, ...months.map(() => 11), 13],
    })) {
      zip.file(part.path, part.content);
    }
    const b64 = await zip.generateAsync({ type: 'base64' });
    const uri = `${FileSystem.cacheDirectory}${base}.xlsx`;
    await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
    await Sharing.shareAsync(uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Exposed so the screen can name the file it is about to produce. */
export function statementFileName(year: FiscalYear, format: StatementFormat): string {
  return suggestedName(`statement-${fiscalYearLabel(year).replace('–', '-')}`, format);
}
