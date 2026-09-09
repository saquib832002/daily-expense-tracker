import { and, desc, eq, gte, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'expo-crypto';

import { normalizeMerchant } from '@/domain/merchant';
import { nextOccurrence, occurrencesBetween, parseRRule } from '@/domain/recurrence';
import { applyRules } from '@/domain/rules';

import { db } from './client';
import {
  accounts,
  budgets,
  categories,
  merchantMemory,
  outbox,
  recurring,
  rules,
  settings,
  transactions,
  type Account,
  type Budget,
  type Category,
  type Recurring,
  type Rule,
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

export async function updateAccount(
  id: string,
  patch: Partial<Pick<Account, 'name' | 'type' | 'icon' | 'openingBalanceMinor' | 'isArchived'>>,
): Promise<void> {
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
  if (merchantKey && input.categoryId) {
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
