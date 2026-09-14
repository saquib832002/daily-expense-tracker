/**
 * Backup, restore and CSV export.
 *
 * This is the escape hatch: the guarantee that the data belongs to the person
 * who typed it, not to this app. It has to keep working even if the app stops
 * being maintained, so the backup is plain JSON with a version number and the
 * export is plain CSV — both readable by anything.
 */
import { encodeCsv, parseCsvObjects } from '@/domain/csv';
import { normalizeMerchant } from '@/domain/merchant';

import { db } from './client';
import { addTransaction } from './queries';
import {
  accounts,
  budgets,
  categories,
  loyaltyCards,
  merchantMemory,
  recurring,
  rules,
  settings,
  transactionSplits,
  transactions,
  warranties,
} from './schema';

/** Bump only when the shape changes incompatibly. Restore refuses anything newer. */
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: 'daily-expense-tracker';
  version: number;
  exportedAt: number;
  appVersion: string;
  tables: Record<string, unknown[]>;
}

/** Every table, in an order that restores cleanly. */
const TABLES = {
  settings,
  accounts,
  categories,
  transactions,
  transaction_splits: transactionSplits,
  budgets,
  rules,
  merchant_memory: merchantMemory,
  recurring,
  warranties,
  loyalty_cards: loyaltyCards,
} as const;

/**
 * The table names a backup contains, in restore order.
 * Exported so the `.db` importer can check a file is actually ours before it
 * replaces anything.
 */
export const TABLE_NAMES: string[] = Object.keys(TABLES);

export async function buildBackup(appVersion = '0.1.0'): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(TABLES)) {
    tables[name] = await db.select().from(table as never);
  }

  const file: BackupFile = {
    format: 'daily-expense-tracker',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion,
    tables,
  };
  return JSON.stringify(file, null, 2);
}

export interface RestoreResult {
  ok: boolean;
  error?: string;
  counts?: Record<string, number>;
}

/**
 * Replace everything with the contents of a backup.
 *
 * Destructive by design — a restore that merged would silently duplicate every
 * row for anyone restoring onto a phone that already has data. The UI warns
 * before calling this.
 */
export async function restoreBackup(json: string): Promise<RestoreResult> {
  let parsed: BackupFile;
  try {
    parsed = JSON.parse(json) as BackupFile;
  } catch {
    return { ok: false, error: 'notJson' };
  }

  if (parsed?.format !== 'daily-expense-tracker') return { ok: false, error: 'notOurs' };
  if (typeof parsed.version !== 'number') return { ok: false, error: 'notOurs' };
  if (parsed.version > BACKUP_VERSION) return { ok: false, error: 'tooNew' };
  if (!parsed.tables || typeof parsed.tables !== 'object') return { ok: false, error: 'notOurs' };

  const counts: Record<string, number> = {};

  // Delete in reverse dependency order, insert in forward order.
  const names = Object.keys(TABLES);
  for (const name of [...names].reverse()) {
    await db.delete(TABLES[name as keyof typeof TABLES] as never);
  }

  for (const name of names) {
    const rows = parsed.tables[name];
    if (!Array.isArray(rows) || rows.length === 0) {
      counts[name] = 0;
      continue;
    }
    const table = TABLES[name as keyof typeof TABLES] as never;
    // Insert in chunks: SQLite has a hard limit on variables per statement.
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db.insert(table).values(rows.slice(i, i + CHUNK) as never);
    }
    counts[name] = rows.length;
  }

  return { ok: true, counts };
}

/* ------------------------------------------------------------------- CSV */

const CSV_HEADER = [
  'date',
  'amount',
  'currency',
  'kind',
  'account',
  'category',
  'merchant',
  'note',
];

function isoDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Every transaction as CSV, newest first.
 * Amounts are written as decimal strings (`-125.50`) rather than minor units,
 * because a spreadsheet is where this is going and a human reads it there.
 */
export async function exportTransactionsCsv(
  translate: (key: string) => string,
): Promise<string> {
  const [txRows, accountRows, categoryRows] = await Promise.all([
    db.select().from(transactions),
    db.select().from(accounts),
    db.select().from(categories),
  ]);

  const accountName = new Map(accountRows.map((a) => [a.id, a.name]));
  const categoryName = new Map(
    categoryRows.map((c) => [c.id, c.customName ?? (c.nameKey ? translate(c.nameKey) : '')]),
  );

  const rows: (string | number | null)[][] = [CSV_HEADER];

  for (const tx of txRows.filter((t) => !t.deletedAt).sort((a, b) => b.occurredAt - a.occurredAt)) {
    const decimals = tx.currency === 'JPY' ? 0 : 2;
    const amount = (tx.amountMinor / Math.pow(10, decimals)).toFixed(decimals);
    rows.push([
      isoDate(tx.occurredAt),
      amount,
      tx.currency,
      tx.kind,
      accountName.get(tx.accountId) ?? '',
      tx.categoryId ? (categoryName.get(tx.categoryId) ?? '') : '',
      tx.merchant ?? '',
      tx.note ?? '',
    ]);
  }

  return encodeCsv(rows);
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/**
 * Import transactions from CSV.
 *
 * Deliberately forgiving: unknown accounts and categories fall back to the
 * defaults rather than failing the row, because a partial import the user can
 * fix beats a rejection they cannot.
 */
export async function importTransactionsCsv(
  text: string,
  translate: (key: string) => string,
): Promise<ImportResult> {
  const rows = parseCsvObjects(text);
  if (rows.length === 0) return { imported: 0, skipped: 0 };

  const [accountRows, categoryRows] = await Promise.all([
    db.select().from(accounts),
    db.select().from(categories),
  ]);

  const fallbackAccount = accountRows[0];
  if (!fallbackAccount) return { imported: 0, skipped: rows.length };

  const accountByName = new Map(accountRows.map((a) => [a.name.trim().toLowerCase(), a]));
  const categoryByName = new Map(
    categoryRows.map((c) => [
      (c.customName ?? (c.nameKey ? translate(c.nameKey) : '')).trim().toLowerCase(),
      c,
    ]),
  );

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const rawAmount = (row.amount ?? '').trim();
    const value = Number(rawAmount.replace(/[^0-9.\-]/g, ''));
    if (!rawAmount || !Number.isFinite(value) || value === 0) {
      skipped++;
      continue;
    }

    const when = Date.parse(row.date ?? '');
    const account = accountByName.get((row.account ?? '').trim().toLowerCase()) ?? fallbackAccount;
    const category = categoryByName.get((row.category ?? '').trim().toLowerCase()) ?? null;
    const decimals = account.currency === 'JPY' ? 0 : 2;

    const kind: 'expense' | 'income' =
      (row.kind ?? '').trim().toLowerCase() === 'income' || value > 0 ? 'income' : 'expense';

    await addTransaction({
      amountMinor: Math.round(Math.abs(value) * Math.pow(10, decimals)),
      accountId: account.id,
      categoryId: category?.id ?? null,
      currency: account.currency,
      merchant: row.merchant || null,
      note: row.note || null,
      occurredAt: Number.isFinite(when) ? when : Date.now(),
      kind,
      fxRate: 1,
      source: 'import',
      categorySource: category ? 'user' : undefined,
    });
    imported++;
  }

  return { imported, skipped };
}

/** Exported for tests and for the "what will this replace?" warning in the UI. */
export async function countAllRows(): Promise<number> {
  let total = 0;
  for (const table of Object.values(TABLES)) {
    total += (await db.select().from(table as never)).length;
  }
  return total;
}

export { normalizeMerchant };
