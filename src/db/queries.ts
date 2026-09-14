import { and, desc, eq, gte, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'expo-crypto';

import { normalizeMerchant } from '@/domain/merchant';
import { nextOccurrence, occurrencesBetween, parseRRule } from '@/domain/recurrence';
import { rescaleMinor, sameScale } from '@/domain/rebase';
import { applyRules } from '@/domain/rules';

import { db } from './client';
import {
  accounts,
  budgets,
  categories,
  loyaltyCards,
  merchantMemory,
  outbox,
  recurring,
  rules,
  settings,
  transactions,
  warranties,
  type Account,
  type Budget,
  type Category,
  type Recurring,
  type Rule,
  type Warranty,
  type LoyaltyCard,
  type Transaction,
} from './schema';

/* ------------------------------------------------------------------- outbox */

/**
 * Record a local change so the sync layer can replay it later.
 * Sync itself lands in v1.1 — writing the outbox now costs nothing and means
 * switching sync on is additive rather than a migration.
 */
async function trackChange(table: string, rowId: string, op: 'insert' | 'update' | 'delete') {
  await db.insert(outbox).values({ tableName: table, rowId, op, at: Date.now() });
}

/* ----------------------------------------------------------------- settings */

/**
 * The flag that says the welcome screen is done with.
 *
 * Written by `Welcome` and by nothing else. That sentence is the whole design,
 * and it took three broken builds to arrive at, so the wreckage is worth
 * keeping:
 *
 *   `onboarded`    — set on first launch by a check that counted every row in
 *                    the database. `seedIfEmpty` had just written two dozen
 *                    categories, so the count was never zero.
 *   `onboarded_v2` — set on first launch by a check that counted transactions.
 *                    Any phone that had ever recorded an expense stamped
 *                    itself done. Reinstalling did not help, because Android
 *                    Auto Backup restores the database, and the flag rides
 *                    back in with it.
 *
 * A key that a previous build could have set automatically can never be
 * trusted to mean "this person answered the questions", and no amount of
 * reinstalling separates the two. A fresh key can: nothing has ever written
 * `_v3` except the screen itself.
 */
export const ONBOARDED_KEY = 'onboarded_v3';

export async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: Date.now() },
    });
}

export async function getBaseCurrency(): Promise<string> {
  return (await getSetting('base_currency')) ?? 'INR';
}

/** Every distinct currency the ledger actually contains. */
export async function ledgerCurrencies(): Promise<string[]> {
  const rows = await db.selectDistinct({ currency: transactions.currency }).from(transactions);
  const fromAccounts = await db.selectDistinct({ currency: accounts.currency }).from(accounts);
  return [...new Set([...rows, ...fromAccounts].map((r) => r.currency))];
}

/**
 * Change the currency every report is labelled in.
 *
 * The setting is the easy half. The hard half is `base_amount_minor`, which
 * holds integer minor units whose meaning depends on the currency naming them:
 * 123456 is ₹1,234.56 but ¥123,456 and 123.456 KWD. Move the label without
 * moving the integers and every historical total changes by a factor of ten or
 * a hundred, with nothing on screen to suggest anything happened.
 *
 * So when the precision changes, the column is rewritten. No exchange rate is
 * applied — this app holds none — the amounts are re-denominated and keep their
 * value, which is what someone means when they correct a currency the app
 * guessed wrong on first launch.
 */
export async function setBaseCurrency(next: string): Promise<void> {
  const from = await getBaseCurrency();
  const to = next.toUpperCase();
  if (from === to) return;

  await setSetting('base_currency', to);
  if (sameScale(from, to)) return;

  // Rewritten row by row rather than with one arithmetic UPDATE, because the
  // rounding rule (half away from zero, so an expense never shrinks) is in
  // TypeScript where it is tested, not duplicated in SQL where it is not.
  const rows = await db
    .select({ id: transactions.id, base: transactions.baseAmountMinor })
    .from(transactions);

  for (const row of rows) {
    await db
      .update(transactions)
      .set({ baseAmountMinor: rescaleMinor(row.base, from, to) })
      .where(eq(transactions.id, row.id));
  }
}

/**
 * Keep the reporting currency in step with the account people actually use.
 *
 * There is no currency setting to manage any more, and that is the point: the
 * phone says which country you are in, the first account is created in that
 * country's currency, and reports are labelled to match. Nobody has to be shown
 * a list of a hundred and eighty codes to confirm something the device already
 * knew.
 *
 * The one case that needs handling is the person the automatic guess does not
 * fit — an Indian in Dallas whose phone says USD but who keeps his budget in
 * rupees. He changes his account to INR on the Accounts screen, and the reports
 * have to follow, or they would be rupee amounts under a dollar heading.
 *
 * **Only while the ledger is empty.** That window is exactly the "I have just
 * installed this and I am fixing the setup" moment, and closing it once real
 * transactions exist means this can never silently re-denominate a history
 * somebody has been building for months.
 */
/**
 * Has this person ever entered anything?
 *
 * The question sounds like "is the database empty", and it is emphatically not.
 * A fresh install is never empty: `seedIfEmpty` puts twenty-odd default
 * categories, an account and a handful of settings rows in before the first
 * screen renders. Counting *rows* therefore answers "yes, in use" for someone
 * who has just tapped the icon for the first time — which is exactly the bug
 * that kept the welcome screen from ever appearing.
 *
 * Only a transaction is evidence of a real user. Deleted ones count as gone,
 * because to the person holding the phone they are.
 */
export async function hasAnyTransactions(): Promise<boolean> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(isNull(transactions.deletedAt));
  return n > 0;
}

/**
 * When they last recorded anything, or null if they never have.
 *
 * `createdAt`, not `occurredAt`, and the distinction is the whole point: this
 * answers "have they used the app today", which is what the evening reminder
 * needs to know. Someone entering last Tuesday's lunch has used the app today,
 * and nudging them tonight would be telling them to do the thing they just did.
 */
export async function lastEntryAt(): Promise<number | null> {
  const [row] = await db
    .select({ at: sql<number>`MAX(${transactions.createdAt})` })
    .from(transactions)
    .where(isNull(transactions.deletedAt));
  const at = row?.at;
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
}

export async function alignBaseCurrencyToAccounts(): Promise<void> {
  if (await hasAnyTransactions()) return;

  const first = (await listAccounts())[0];
  if (!first) return;

  await setBaseCurrency(first.currency);
}

export async function getFirstDayOfMonth(): Promise<number> {
  const raw = await getSetting('first_day_of_month');
  const n = Number(raw ?? 1);
  return Number.isFinite(n) ? n : 1;
}

/* ---------------------------------------------------------------- accounts */

export async function listAccounts(includeArchived = false): Promise<Account[]> {
  const where = includeArchived
    ? isNull(accounts.deletedAt)
    : and(isNull(accounts.deletedAt), eq(accounts.isArchived, 0));
  return db.select().from(accounts).where(where).orderBy(accounts.sortOrder);
}

export async function getAccount(id: string): Promise<Account | null> {
  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createAccount(input: {
  name: string;
  type: string;
  currency: string;
  openingBalanceMinor?: number;
  icon?: string;
}): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  const existing = await listAccounts(true);

  await db.insert(accounts).values({
    id,
    name: input.name.trim(),
    type: input.type,
    currency: input.currency,
    openingBalanceMinor: input.openingBalanceMinor ?? 0,
    icon: input.icon ?? '💳',
    sortOrder: existing.length,
    createdAt: now,
    updatedAt: now,
  });
  await trackChange('accounts', id, 'insert');
  return id;
}

/**
 * How many transactions an account holds — which decides whether its currency
 * can still be changed.
 *
 * An account's currency is locked once money is in it, and rightly so: the
 * amounts are integer minor units interpreted by that currency, so switching it
 * later would rewrite the meaning of every row. But locking it from the moment
 * of creation was too strict, and it is the case that actually bites — the app
 * guesses your currency from the phone's region on first launch, and if it
 * guessed wrong the very first thing you want to do is fix it, before you have
 * entered anything at all.
 */
export async function accountTransactionCount(id: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(and(eq(transactions.accountId, id), isNull(transactions.deletedAt)));
  return rows[0]?.n ?? 0;
}

export async function updateAccount(
  id: string,
  patch: Partial<
    Pick<Account, 'name' | 'type' | 'icon' | 'openingBalanceMinor' | 'isArchived' | 'currency'>
  >,
): Promise<void> {
  // Guard in the data layer, not only in the screen. A currency change on an
  // account holding money is the kind of mistake that is invisible until a
  // month-end total is wrong, so it is refused at the place every caller has
  // to go through.
  if (patch.currency && (await accountTransactionCount(id)) > 0) {
    throw new Error('accountHasTransactions');
  }
  await db
    .update(accounts)
    .set({ ...patch, updatedAt: Date.now(), dirty: 1 })
    .where(eq(accounts.id, id));
  await trackChange('accounts', id, 'update');
}

/**
 * Current balance per account: opening balance plus every signed transaction.
 * One query rather than one per account, because this feeds a list.
 */
export async function accountBalances(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      accountId: transactions.accountId,
      total: sql<number>`COALESCE(SUM(${transactions.amountMinor}), 0)`,
    })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'confirmed')))
    .groupBy(transactions.accountId);

  const sums = new Map(rows.map((r) => [r.accountId, r.total]));
  const out: Record<string, number> = {};
  for (const a of await listAccounts(true)) {
    out[a.id] = a.openingBalanceMinor + (sums.get(a.id) ?? 0);
  }
  return out;
}

/* -------------------------------------------------------------- categories */

export async function listCategories(kind: 'expense' | 'income' = 'expense'): Promise<Category[]> {
  return db
    .select()
    .from(categories)
    .where(and(isNull(categories.deletedAt), eq(categories.kind, kind)))
    .orderBy(categories.sortOrder);
}

export async function getCategory(id: string | null): Promise<Category | null> {
  if (!id) return null;
  const rows = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createCategory(input: {
  name: string;
  kind: 'expense' | 'income';
  icon?: string;
  color?: string;
}): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  const siblings = await listCategories(input.kind);

  await db.insert(categories).values({
    id,
    customName: input.name.trim(),
    nameKey: null,
    icon: input.icon ?? '🏷️',
    color: input.color ?? '#8A8F98',
    kind: input.kind,
    isSystem: 0,
    sortOrder: siblings.length,
    createdAt: now,
    updatedAt: now,
  });
  await trackChange('categories', id, 'insert');
  return id;
}

export async function updateCategory(
  id: string,
  patch: Partial<Pick<Category, 'customName' | 'icon' | 'color'>>,
): Promise<void> {
  await db
    .update(categories)
    .set({ ...patch, updatedAt: Date.now(), dirty: 1 })
    .where(eq(categories.id, id));
  await trackChange('categories', id, 'update');
}

/**
 * Hide a category. Transactions already filed under it keep pointing at it, so
 * history never develops holes — this only removes it from the pickers.
 */
export async function hideCategory(id: string): Promise<void> {
  const now = Date.now();
  await db
    .update(categories)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(eq(categories.id, id));
  await trackChange('categories', id, 'delete');
}

/* ------------------------------------------------------------- transactions */

export interface NewExpenseInput {
  amountMinor: number;
  accountId: string;
  categoryId?: string | null;
  merchant?: string | null;
  note?: string | null;
  occurredAt?: number;
  kind?: 'expense' | 'income';
  currency: string;
  /** Rate from the account's currency to the base currency. 1 when the same. */
  fxRate?: number;
  source?: string;
  categorySource?: string;
  /** 'inbox' parks it for one-tap confirmation instead of the ledger. */
  status?: 'confirmed' | 'inbox';
  recurringId?: string | null;
  /** File NAME of a receipt image in the receipts folder — never a full path. */
  receiptPath?: string | null;
}

/**
 * Record a transaction.
 *
 * Amounts are stored SIGNED: expenses negative, income positive. Reports then
 * never have to know which way round a `kind` string points, and a sum is just
 * a sum.
 */
export async function addTransaction(input: NewExpenseInput): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  const kind = input.kind ?? 'expense';
  const magnitude = Math.abs(input.amountMinor);
  const signed = kind === 'income' ? magnitude : -magnitude;
  const fxRate = input.fxRate ?? 1;
  const merchantKey = normalizeMerchant(input.merchant) || null;

  await db.insert(transactions).values({
    id,
    accountId: input.accountId,
    categoryId: input.categoryId ?? null,
    amountMinor: signed,
    currency: input.currency,
    baseAmountMinor: Math.round(signed * fxRate),
    fxRate,
    kind,
    occurredAt: input.occurredAt ?? now,
    merchant: input.merchant?.trim() || null,
    merchantKey,
    note: input.note?.trim() || null,
    source: input.source ?? 'manual',
    categorySource: input.categorySource ?? 'user',
    status: input.status ?? 'confirmed',
    recurringId: input.recurringId ?? null,
    receiptPath: input.receiptPath ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await trackChange('transactions', id, 'insert');

  // Teach the app: this merchant means this category. Free, instant, and the
  // reason we need no AI to categorize.
  //
  // Only from a PERSON, though. This used to learn from anything with a
  // category attached, including the scanner's own guess — so one bill filed
  // under the wrong heading became a permanent memory, and that memory then
  // outranked the lexicon on every future scan of the same shop. A guess that
  // teaches itself is not learning, it is a feedback loop, and the wrong answer
  // was the one that stuck.
  if (merchantKey && input.categoryId && (input.categorySource ?? 'user') === 'user') {
    await rememberMerchant(merchantKey, input.categoryId);
  }

  return id;
}

export async function getTransaction(id: string): Promise<Transaction | null> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface TransactionPatch {
  amountMinor?: number;
  accountId?: string;
  categoryId?: string | null;
  merchant?: string | null;
  note?: string | null;
  occurredAt?: number;
  kind?: 'expense' | 'income';
  currency?: string;
  fxRate?: number;
  /** File name, or null to detach. Undefined leaves whatever is there. */
  receiptPath?: string | null;
}

/**
 * Edit a transaction. The sign, the base amount and the merchant key are all
 * derived here rather than by the caller, so an edit can never leave a row in
 * a state that `addTransaction` would not have produced.
 */
export async function updateTransaction(id: string, patch: TransactionPatch): Promise<void> {
  const current = await getTransaction(id);
  if (!current) return;

  const kind = patch.kind ?? (current.kind as 'expense' | 'income');
  const magnitude = Math.abs(patch.amountMinor ?? current.amountMinor);
  const signed = kind === 'income' ? magnitude : -magnitude;
  const fxRate = patch.fxRate ?? current.fxRate;
  const merchant =
    patch.merchant !== undefined ? patch.merchant?.trim() || null : current.merchant;
  const merchantKey = normalizeMerchant(merchant) || null;
  const categoryId = patch.categoryId !== undefined ? patch.categoryId : current.categoryId;

  await db
    .update(transactions)
    .set({
      amountMinor: signed,
      accountId: patch.accountId ?? current.accountId,
      categoryId,
      merchant,
      merchantKey,
      note: patch.note !== undefined ? patch.note?.trim() || null : current.note,
      occurredAt: patch.occurredAt ?? current.occurredAt,
      kind,
      currency: patch.currency ?? current.currency,
      receiptPath: patch.receiptPath !== undefined ? patch.receiptPath : current.receiptPath,
      baseAmountMinor: Math.round(signed * fxRate),
      fxRate,
      categorySource: patch.categoryId !== undefined ? 'user' : current.categorySource,
      updatedAt: Date.now(),
      dirty: 1,
    })
    .where(eq(transactions.id, id));

  await trackChange('transactions', id, 'update');

  if (merchantKey && categoryId) {
    await rememberMerchant(merchantKey, categoryId);
  }
}

export async function softDeleteTransaction(id: string): Promise<void> {
  const now = Date.now();
  await db
    .update(transactions)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(eq(transactions.id, id));
  await trackChange('transactions', id, 'delete');
}

/** Undo a delete. Nothing is ever hard-deleted, so this is always possible. */
export async function restoreTransaction(id: string): Promise<void> {
  await db
    .update(transactions)
    .set({ deletedAt: null, updatedAt: Date.now(), dirty: 1 })
    .where(eq(transactions.id, id));
  await trackChange('transactions', id, 'update');
}

export async function listTransactions(fromMs: number, toMs: number): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, 'confirmed'),
        gte(transactions.occurredAt, fromMs),
        lt(transactions.occurredAt, toMs),
      ),
    )
    .orderBy(desc(transactions.occurredAt));
}

export async function listRecent(limit = 5): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'confirmed')))
    .orderBy(desc(transactions.occurredAt))
    .limit(limit);
}

/** Total spent (a positive number) in the base currency for a period. */
export async function spentInPeriod(fromMs: number, toMs: number): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${transactions.baseAmountMinor}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, 'confirmed'),
        eq(transactions.kind, 'expense'),
        gte(transactions.occurredAt, fromMs),
        lt(transactions.occurredAt, toMs),
      ),
    );
  return Math.abs(rows[0]?.total ?? 0);
}

/* ---------------------------------------------------------- merchant memory */

export interface RecentMerchant {
  merchant: string;
  merchantKey: string;
  categoryId: string | null;
  amountMinor: number;
  accountId: string;
}

/**
 * The handful of things you buy most often, newest first, one per merchant.
 *
 * This powers the one-tap chips on the add screen — the single biggest
 * reduction in typing available, because most people's spending is the same
 * six or seven places over and over.
 */
export async function recentMerchants(limit = 6): Promise<RecentMerchant[]> {
  const rows = await db
    .select({
      merchant: transactions.merchant,
      merchantKey: transactions.merchantKey,
      categoryId: transactions.categoryId,
      amountMinor: transactions.amountMinor,
      accountId: transactions.accountId,
      occurredAt: transactions.occurredAt,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, 'confirmed'),
        eq(transactions.kind, 'expense'),
        ne(transactions.merchantKey, ''),
      ),
    )
    .orderBy(desc(transactions.occurredAt))
    .limit(200);

  const seen = new Set<string>();
  const out: RecentMerchant[] = [];
  for (const r of rows) {
    if (!r.merchantKey || !r.merchant || seen.has(r.merchantKey)) continue;
    seen.add(r.merchantKey);
    out.push({
      merchant: r.merchant,
      merchantKey: r.merchantKey,
      categoryId: r.categoryId,
      amountMinor: Math.abs(r.amountMinor),
      accountId: r.accountId,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function rememberMerchant(merchantKey: string, categoryId: string): Promise<void> {
  await db
    .insert(merchantMemory)
    .values({ merchantKey, categoryId, hitCount: 1, lastUsedAt: Date.now() })
    .onConflictDoUpdate({
      target: merchantMemory.merchantKey,
      set: {
        categoryId,
        hitCount: sql`${merchantMemory.hitCount} + 1`,
        lastUsedAt: Date.now(),
      },
    });
}

/** The category this merchant usually belongs to, if we have seen it before. */
export async function recallMerchant(merchantRaw: string): Promise<string | null> {
  const key = normalizeMerchant(merchantRaw);
  if (!key) return null;
  const rows = await db
    .select()
    .from(merchantMemory)
    .where(eq(merchantMemory.merchantKey, key))
    .limit(1);
  return rows[0]?.categoryId ?? null;
}

/* ------------------------------------------------------------------ budgets */

/** The overall monthly budget, or null when none is set. */
export async function getMonthlyBudget(): Promise<number | null> {
  const rows = await db
    .select()
    .from(budgets)
    .where(and(isNull(budgets.deletedAt), isNull(budgets.categoryId), eq(budgets.period, 'monthly')))
    .limit(1);
  return rows[0]?.amountMinor ?? null;
}

export async function setMonthlyBudget(amountMinor: number, currency: string): Promise<void> {
  const now = Date.now();
  const existing = await db
    .select()
    .from(budgets)
    .where(and(isNull(budgets.deletedAt), isNull(budgets.categoryId), eq(budgets.period, 'monthly')))
    .limit(1);

  const row = existing[0];
  if (row) {
    await db
      .update(budgets)
      .set({ amountMinor, currency, updatedAt: now, dirty: 1 })
      .where(eq(budgets.id, row.id));
    await trackChange('budgets', row.id, 'update');
    return;
  }

  const id = randomUUID();
  await db.insert(budgets).values({
    id,
    categoryId: null,
    period: 'monthly',
    amountMinor,
    currency,
    startsOn: now,
    createdAt: now,
    updatedAt: now,
  });
  await trackChange('budgets', id, 'insert');
}

/* ------------------------------------------------------------------ reports */

export interface CategorySpend {
  categoryId: string | null;
  amountMinor: number;
}

/**
 * Spend per category for a period, in the base currency.
 * Grouped in SQL rather than in JS — this is the one query that runs over the
 * whole month's rows, and it feeds every chart on the reports screen.
 */
export async function spendByCategory(fromMs: number, toMs: number): Promise<CategorySpend[]> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      total: sql<number>`COALESCE(SUM(${transactions.baseAmountMinor}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, 'confirmed'),
        eq(transactions.kind, 'expense'),
        gte(transactions.occurredAt, fromMs),
        lt(transactions.occurredAt, toMs),
      ),
    )
    .groupBy(transactions.categoryId);

  return rows.map((r) => ({ categoryId: r.categoryId, amountMinor: Math.abs(r.total) }));
}

/** Just the date and base amount of each expense — what the series charts need. */
export async function expensePoints(
  fromMs: number,
  toMs: number,
): Promise<{ occurredAt: number; amountMinor: number }[]> {
  return db
    .select({
      occurredAt: transactions.occurredAt,
      amountMinor: transactions.baseAmountMinor,
    })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, 'confirmed'),
        eq(transactions.kind, 'expense'),
        gte(transactions.occurredAt, fromMs),
        lt(transactions.occurredAt, toMs),
      ),
    );
}

/** Income total for a period, positive. */
export async function incomeInPeriod(fromMs: number, toMs: number): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${transactions.baseAmountMinor}), 0)` })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        eq(transactions.status, 'confirmed'),
        eq(transactions.kind, 'income'),
        gte(transactions.occurredAt, fromMs),
        lt(transactions.occurredAt, toMs),
      ),
    );
  return Math.abs(rows[0]?.total ?? 0);
}

/* --------------------------------------------------- per-category budgets */

export async function listCategoryBudgets(): Promise<Budget[]> {
  return db
    .select()
    .from(budgets)
    .where(
      and(isNull(budgets.deletedAt), isNotNull(budgets.categoryId), eq(budgets.period, 'monthly')),
    );
}

export async function setCategoryBudget(
  categoryId: string,
  amountMinor: number,
  currency: string,
): Promise<void> {
  const now = Date.now();
  const existing = await db
    .select()
    .from(budgets)
    .where(
      and(
        isNull(budgets.deletedAt),
        eq(budgets.categoryId, categoryId),
        eq(budgets.period, 'monthly'),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (row) {
    await db
      .update(budgets)
      .set({ amountMinor, currency, updatedAt: now, dirty: 1 })
      .where(eq(budgets.id, row.id));
    await trackChange('budgets', row.id, 'update');
    return;
  }

  const id = randomUUID();
  await db.insert(budgets).values({
    id,
    categoryId,
    period: 'monthly',
    amountMinor,
    currency,
    startsOn: now,
    createdAt: now,
    updatedAt: now,
  });
  await trackChange('budgets', id, 'insert');
}

/** Remove a category budget. Soft, like everything else. */
export async function clearCategoryBudget(categoryId: string): Promise<void> {
  const now = Date.now();
  const rows = await db
    .select()
    .from(budgets)
    .where(and(isNull(budgets.deletedAt), eq(budgets.categoryId, categoryId)))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  await db
    .update(budgets)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(eq(budgets.id, row.id));
  await trackChange('budgets', row.id, 'delete');
}

/* -------------------------------------------------------------------- rules */

export async function listRules(): Promise<Rule[]> {
  return db
    .select()
    .from(rules)
    .where(isNull(rules.deletedAt))
    .orderBy(rules.priority);
}

export async function createRule(input: {
  matchType: string;
  matchValue: string;
  setCategoryId?: string | null;
  setAccountId?: string | null;
  priority?: number;
}): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  const existing = await listRules();

  await db.insert(rules).values({
    id,
    matchType: input.matchType,
    matchValue: input.matchValue.trim(),
    setCategoryId: input.setCategoryId ?? null,
    setAccountId: input.setAccountId ?? null,
    priority: input.priority ?? (existing.length + 1) * 10,
    isEnabled: 1,
    createdAt: now,
    updatedAt: now,
  });
  await trackChange('rules', id, 'insert');
  return id;
}

export async function updateRule(
  id: string,
  patch: Partial<Pick<Rule, 'matchType' | 'matchValue' | 'setCategoryId' | 'setAccountId' | 'priority' | 'isEnabled'>>,
): Promise<void> {
  await db
    .update(rules)
    .set({ ...patch, updatedAt: Date.now(), dirty: 1 })
    .where(eq(rules.id, id));
  await trackChange('rules', id, 'update');
}

export async function deleteRule(id: string): Promise<void> {
  const now = Date.now();
  await db
    .update(rules)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(eq(rules.id, id));
  await trackChange('rules', id, 'delete');
}

/**
 * What category should this transaction get?
 *
 * A rule you wrote beats what the app learned from your corrections, and both
 * beat guessing. The decision itself lives in `domain/rules.ts` as a pure
 * function; this only fetches what it needs.
 */
export async function suggestForDraft(draft: {
  merchant?: string | null;
  note?: string | null;
}): Promise<{ categoryId: string | null; source: 'rule' | 'memory' | null; accountId: string | null }> {
  const all = await listRules();
  const byRule = applyRules(all, draft);
  if (byRule.categoryId || byRule.accountId) {
    return { categoryId: byRule.categoryId, source: byRule.categoryId ? 'rule' : null, accountId: byRule.accountId };
  }

  const remembered = draft.merchant ? await recallMerchant(draft.merchant) : null;
  return { categoryId: remembered, source: remembered ? 'memory' : null, accountId: null };
}

/* ---------------------------------------------------------------- recurring */

export interface RecurringTemplate {
  amountMinor: number;
  accountId: string;
  categoryId: string | null;
  merchant: string | null;
  note: string | null;
  kind: 'expense' | 'income';
  currency: string;
}

export async function listRecurring(): Promise<Recurring[]> {
  return db
    .select()
    .from(recurring)
    .where(isNull(recurring.deletedAt))
    .orderBy(recurring.nextDueOn);
}

export async function createRecurring(input: {
  template: RecurringTemplate;
  rrule: string;
  nextDueOn: number;
  autoPost: boolean;
}): Promise<string> {
  const now = Date.now();
  const id = randomUUID();
  await db.insert(recurring).values({
    id,
    templateJson: JSON.stringify(input.template),
    rrule: input.rrule,
    nextDueOn: input.nextDueOn,
    autoPost: input.autoPost ? 1 : 0,
    isEnabled: 1,
    createdAt: now,
    updatedAt: now,
  });
  await trackChange('recurring', id, 'insert');
  return id;
}

export async function updateRecurring(
  id: string,
  patch: Partial<Pick<Recurring, 'templateJson' | 'rrule' | 'nextDueOn' | 'autoPost' | 'isEnabled'>>,
): Promise<void> {
  await db
    .update(recurring)
    .set({ ...patch, updatedAt: Date.now(), dirty: 1 })
    .where(eq(recurring.id, id));
  await trackChange('recurring', id, 'update');
}

export async function deleteRecurring(id: string): Promise<void> {
  const now = Date.now();
  await db
    .update(recurring)
    .set({ deletedAt: now, updatedAt: now, dirty: 1 })
    .where(eq(recurring.id, id));
  await trackChange('recurring', id, 'delete');
}

/**
 * Post everything that has fallen due since the app was last opened.
 *
 * Auto-post rules land straight in the ledger; the rest land in the inbox for
 * one-tap confirmation, because a rent amount that changed should be noticed
 * rather than silently recorded wrong.
 *
 * Returns how many were created, so the caller can show a badge.
 */
export async function materializeDueRecurring(now = Date.now()): Promise<number> {
  const due = await db
    .select()
    .from(recurring)
    .where(and(isNull(recurring.deletedAt), eq(recurring.isEnabled, 1), lt(recurring.nextDueOn, now)));

  let created = 0;

  for (const row of due) {
    const rule = parseRRule(row.rrule);
    if (!rule) continue;

    let template: RecurringTemplate;
    try {
      template = JSON.parse(row.templateJson) as RecurringTemplate;
    } catch {
      continue; // A corrupt template must not stop the others.
    }

    // Cap the catch-up: six months away should not create 180 rows at once.
    const dates = occurrencesBetween(rule, row.nextDueOn, row.nextDueOn, now, 24);
    for (const occurredAt of dates) {
      await addTransaction({
        amountMinor: template.amountMinor,
        accountId: template.accountId,
        categoryId: template.categoryId,
        currency: template.currency,
        merchant: template.merchant,
        note: template.note,
        occurredAt,
        kind: template.kind,
        fxRate: 1,
        source: 'recurring',
        categorySource: 'rule',
        // Auto-post goes straight to the ledger; everything else waits in the
        // inbox, because a rent amount that changed should be noticed rather
        // than silently recorded wrong.
        status: row.autoPost ? 'confirmed' : 'inbox',
        recurringId: row.id,
      });
      created++;
    }

    const nextDue = nextOccurrence(rule, row.nextDueOn, Math.max(now, dates[dates.length - 1] ?? now));
    await updateRecurring(row.id, { nextDueOn: nextDue });
  }

  return created;
}

/* -------------------------------------------------------------------- inbox */

/** Captured but unconfirmed items — from recurring today, from SMS and OCR later. */
export async function listInbox(): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'inbox')))
    .orderBy(desc(transactions.occurredAt));
}

export async function countInbox(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'inbox')));
  return rows[0]?.n ?? 0;
}

export async function confirmInboxItem(id: string): Promise<void> {
  await db
    .update(transactions)
    .set({ status: 'confirmed', updatedAt: Date.now(), dirty: 1 })
    .where(eq(transactions.id, id));
  await trackChange('transactions', id, 'update');
}

export async function confirmAllInbox(): Promise<number> {
  const items = await listInbox();
  for (const item of items) await confirmInboxItem(item.id);
  return items.length;
}

/** Rejecting is a soft delete, so it can still be recovered. */
export async function rejectInboxItem(id: string): Promise<void> {
  await softDeleteTransaction(id);
}

/* --------------------------------------------------------------- warranties */

/**
 * Everything still on record, expiring soonest first.
 *
 * Deleted rows are excluded but not destroyed, like everywhere else here: a
 * warranty removed by accident is a receipt somebody no longer has.
 */
export async function listWarranties(): Promise<Warranty[]> {
  return db
    .select()
    .from(warranties)
    .where(isNull(warranties.deletedAt))
    .orderBy(warranties.expiresOn);
}

export async function getWarranty(id: string): Promise<Warranty | null> {
  const rows = await db
    .select()
    .from(warranties)
    .where(and(eq(warranties.id, id), isNull(warranties.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export interface WarrantyInput {
  productName: string;
  brand?: string | null;
  retailer?: string | null;
  serial?: string | null;
  purchasedOn: number;
  months: number;
  expiresOn: number;
  priceMinor?: number | null;
  currency?: string | null;
  /** File names in the receipts folder. */
  photos?: string[];
  notes?: string | null;
  transactionId?: string | null;
}

export async function createWarranty(input: WarrantyInput): Promise<string> {
  const id = randomUUID();
  const now = Date.now();

  await db.insert(warranties).values({
    id,
    productName: input.productName.trim(),
    brand: input.brand?.trim() || null,
    retailer: input.retailer?.trim() || null,
    serial: input.serial?.trim() || null,
    purchasedOn: input.purchasedOn,
    months: input.months,
    expiresOn: input.expiresOn,
    priceMinor: input.priceMinor ?? null,
    currency: input.currency ?? null,
    photos: input.photos && input.photos.length > 0 ? input.photos.join(',') : null,
    notes: input.notes?.trim() || null,
    transactionId: input.transactionId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await trackChange('warranties', id, 'insert');
  return id;
}

export async function updateWarranty(id: string, patch: Partial<WarrantyInput>): Promise<void> {
  const values: Record<string, unknown> = { updatedAt: Date.now(), dirty: 1 };

  if (patch.productName !== undefined) values.productName = patch.productName.trim();
  if (patch.brand !== undefined) values.brand = patch.brand?.trim() || null;
  if (patch.retailer !== undefined) values.retailer = patch.retailer?.trim() || null;
  if (patch.serial !== undefined) values.serial = patch.serial?.trim() || null;
  if (patch.purchasedOn !== undefined) values.purchasedOn = patch.purchasedOn;
  if (patch.months !== undefined) values.months = patch.months;
  if (patch.expiresOn !== undefined) values.expiresOn = patch.expiresOn;
  if (patch.priceMinor !== undefined) values.priceMinor = patch.priceMinor;
  if (patch.currency !== undefined) values.currency = patch.currency;
  if (patch.notes !== undefined) values.notes = patch.notes?.trim() || null;
  if (patch.transactionId !== undefined) values.transactionId = patch.transactionId;
  if (patch.photos !== undefined) {
    values.photos = patch.photos.length > 0 ? patch.photos.join(',') : null;
  }

  await db.update(warranties).set(values).where(eq(warranties.id, id));
  await trackChange('warranties', id, 'update');
}

export async function deleteWarranty(id: string): Promise<void> {
  await db
    .update(warranties)
    .set({ deletedAt: Date.now(), updatedAt: Date.now(), dirty: 1 })
    .where(eq(warranties.id, id));
  await trackChange('warranties', id, 'delete');
}

/** The photo file names on a row, as a list. Empty when there are none. */
export function warrantyPhotos(row: Pick<Warranty, 'photos'>): string[] {
  return (row.photos ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------ loyalty cards */

/**
 * The cards, most used first.
 *
 * Ordered by how often they have been opened rather than alphabetically,
 * because the whole feature is "I am standing at the till" and the card you
 * want is almost always the one you used last time.
 */
export async function listLoyaltyCards(): Promise<LoyaltyCard[]> {
  return db
    .select()
    .from(loyaltyCards)
    .where(isNull(loyaltyCards.deletedAt))
    .orderBy(desc(loyaltyCards.usedCount), desc(loyaltyCards.lastUsedAt));
}

export interface LoyaltyCardInput {
  name: string;
  code: string;
  symbology: string;
  notes?: string | null;
  colour?: string | null;
  photos?: string[];
}

export async function createLoyaltyCard(input: LoyaltyCardInput): Promise<string> {
  const id = randomUUID();
  const now = Date.now();

  await db.insert(loyaltyCards).values({
    id,
    name: input.name.trim(),
    code: input.code.trim(),
    symbology: input.symbology,
    notes: input.notes?.trim() || null,
    colour: input.colour ?? null,
    photos: input.photos && input.photos.length > 0 ? input.photos.join(',') : null,
    createdAt: now,
    updatedAt: now,
  });

  await trackChange('loyalty_cards', id, 'insert');
  return id;
}

export async function updateLoyaltyCard(
  id: string,
  patch: Partial<LoyaltyCardInput>,
): Promise<void> {
  const values: Record<string, unknown> = { updatedAt: Date.now(), dirty: 1 };
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.code !== undefined) values.code = patch.code.trim();
  if (patch.symbology !== undefined) values.symbology = patch.symbology;
  if (patch.notes !== undefined) values.notes = patch.notes?.trim() || null;
  if (patch.colour !== undefined) values.colour = patch.colour;
  if (patch.photos !== undefined) {
    values.photos = patch.photos.length > 0 ? patch.photos.join(',') : null;
  }

  await db.update(loyaltyCards).set(values).where(eq(loyaltyCards.id, id));
  await trackChange('loyalty_cards', id, 'update');
}

export async function deleteLoyaltyCard(id: string): Promise<void> {
  await db
    .update(loyaltyCards)
    .set({ deletedAt: Date.now(), updatedAt: Date.now(), dirty: 1 })
    .where(eq(loyaltyCards.id, id));
  await trackChange('loyalty_cards', id, 'delete');
}

/**
 * Record that a card was shown at a till.
 *
 * Deliberately not tracked through the sync outbox: how often somebody opens
 * their Croma card is the app's own housekeeping, not a fact about their money.
 */
export async function markCardUsed(id: string): Promise<void> {
  await db
    .update(loyaltyCards)
    .set({ usedCount: sql`${loyaltyCards.usedCount} + 1`, lastUsedAt: Date.now() })
    .where(eq(loyaltyCards.id, id));
}

export function loyaltyCardPhotos(row: Pick<LoyaltyCard, 'photos'>): string[] {
  return (row.photos ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}
