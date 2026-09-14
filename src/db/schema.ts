/**
 * Daily Expense Tracker — database schema
 *
 * This one file describes the phone's SQLite database today, and will describe
 * the VPS's Postgres database in v1.1 (the Postgres variant imports the same
 * shapes from `drizzle-orm/pg-core`). Keeping one definition is the reason we
 * chose Drizzle — the two sides cannot drift.
 *
 * FOUR RULES, enforced by the column types below:
 *  1. Money is an INTEGER number of minor units (paise / cents). Never a float.
 *  2. Every row carries id / updatedAt / deletedAt / dirty so sync works later.
 *  3. Nothing is hard-deleted — deletedAt is set instead.
 *  4. ids are UUIDs generated on the phone, never by a server.
 */
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Columns every syncable table carries. Spread into each table definition. */
const syncColumns = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
  deletedAt: integer('deleted_at'),
  /** 1 = changed locally and not yet pushed to the server. Phone only. */
  dirty: integer('dirty').notNull().default(1),
};

/* ------------------------------------------------------------------ settings */

/** Simple key/value store: base_currency, language, first_day_of_month, ... */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
});

/* ------------------------------------------------------------------ accounts */

export const accounts = sqliteTable(
  'accounts',
  {
    ...syncColumns,
    name: text('name').notNull(),
    /** cash | bank | card | upi | wallet */
    type: text('type').notNull().default('cash'),
    openingBalanceMinor: integer('opening_balance_minor').notNull().default(0),
    /** ISO 4217. Per-account, so a rupee wallet and a dollar card coexist. */
    currency: text('currency').notNull(),
    icon: text('icon'),
    color: text('color'),
    isArchived: integer('is_archived').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('accounts_archived_idx').on(t.isArchived, t.sortOrder)],
);

/* ---------------------------------------------------------------- categories */

export const categories = sqliteTable(
  'categories',
  {
    ...syncColumns,
    parentId: text('parent_id'),
    /**
     * Translation key for seeded categories (e.g. "category.food"), so they
     * render in Hindi for a Hindi user. Null for user-created categories.
     */
    nameKey: text('name_key'),
    /** Set for user-created categories; overrides nameKey when present. */
    customName: text('custom_name'),
    icon: text('icon'),
    color: text('color'),
    /** expense | income | transfer */
    kind: text('kind').notNull().default('expense'),
    isSystem: integer('is_system').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('categories_kind_idx').on(t.kind, t.sortOrder)],
);

/* -------------------------------------------------------------- transactions */

export const transactions = sqliteTable(
  'transactions',
  {
    ...syncColumns,
    accountId: text('account_id').notNull(),
    categoryId: text('category_id'),

    /** Signed integer minor units in the ACCOUNT's currency. */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    /** Same amount converted to the user's base currency, at entry time. */
    baseAmountMinor: integer('base_amount_minor').notNull(),
    /** Rate used, stored so historical reports never shift under the user. */
    fxRate: real('fx_rate').notNull().default(1),

    /** expense | income | transfer */
    kind: text('kind').notNull().default('expense'),
    occurredAt: integer('occurred_at').notNull(),

    merchant: text('merchant'),
    /** Normalized + uppercased, for rule and memory matching. */
    merchantKey: text('merchant_key'),

    note: text('note'),
    /** Links the two legs of a transfer. */
    transferPeerId: text('transfer_peer_id'),
    /** Local file path. Receipt images never leave the device. */
    receiptPath: text('receipt_path'),

    /** manual | sms | ocr | recurring | import */
    source: text('source').notNull().default('manual'),
    /** user | rule | memory | suggested */
    categorySource: text('category_source'),
    /** confirmed | inbox  — "inbox" = captured automatically, not yet confirmed */
    status: text('status').notNull().default('confirmed'),

    recurringId: text('recurring_id'),
  },
  (t) => [
    index('tx_occurred_idx').on(t.occurredAt),
    index('tx_category_idx').on(t.categoryId, t.occurredAt),
    index('tx_account_idx').on(t.accountId, t.occurredAt),
    index('tx_merchant_idx').on(t.merchantKey),
    index('tx_status_idx').on(t.status),
  ],
);

/** One purchase split across several categories. */
export const transactionSplits = sqliteTable(
  'transaction_splits',
  {
    ...syncColumns,
    transactionId: text('transaction_id').notNull(),
    categoryId: text('category_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    note: text('note'),
  },
  (t) => [index('splits_tx_idx').on(t.transactionId)],
);

/* ------------------------------------------------------------------- budgets */

export const budgets = sqliteTable(
  'budgets',
  {
    ...syncColumns,
    /** Null = the overall monthly budget. */
    categoryId: text('category_id'),
    /** monthly | weekly */
    period: text('period').notNull().default('monthly'),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    startsOn: integer('starts_on').notNull(),
    rollover: integer('rollover').notNull().default(0),
  },
  (t) => [index('budgets_category_idx').on(t.categoryId)],
);

/* ------------------------------------------------- rules & merchant learning */

export const rules = sqliteTable(
  'rules',
  {
    ...syncColumns,
    priority: integer('priority').notNull().default(100),
    /** contains | equals | startsWith | regex */
    matchType: text('match_type').notNull().default('contains'),
    matchValue: text('match_value').notNull(),
    setCategoryId: text('set_category_id'),
    setAccountId: text('set_account_id'),
    isEnabled: integer('is_enabled').notNull().default(1),
  },
  (t) => [index('rules_priority_idx').on(t.isEnabled, t.priority)],
);

/**
 * The entire "it learns from you" feature, in one table.
 * Every category correction writes here; lookups are instant and free.
 */
export const merchantMemory = sqliteTable('merchant_memory', {
  merchantKey: text('merchant_key').primaryKey(),
  categoryId: text('category_id').notNull(),
  hitCount: integer('hit_count').notNull().default(1),
  lastUsedAt: integer('last_used_at').notNull().default(sql`(unixepoch() * 1000)`),
});

/* ----------------------------------------------------------------- recurring */

export const recurring = sqliteTable(
  'recurring',
  {
    ...syncColumns,
    /** JSON transaction template: amount, account, category, merchant, note. */
    templateJson: text('template_json').notNull(),
    /** RFC 5545 RRULE subset, e.g. FREQ=MONTHLY;BYMONTHDAY=1 */
    rrule: text('rrule').notNull(),
    nextDueOn: integer('next_due_on').notNull(),
    autoPost: integer('auto_post').notNull().default(0),
    isEnabled: integer('is_enabled').notNull().default(1),
  },
  (t) => [index('recurring_due_idx').on(t.isEnabled, t.nextDueOn)],
);

/* ---------------------------------------------------------------- warranties */

/**
 * Warranties, guarantees and AMCs.
 *
 * A deliberately separate table rather than a flag on `transactions`, because
 * the two have almost nothing in common. A warranty outlives the expense that
 * created it by years; it is edited long after the purchase is history; most
 * people want to record one for a thing they bought before they installed this
 * app; and plenty of the useful fields — serial number, retailer, the photo of
 * the card in the box — mean nothing to a ledger entry. `transactionId` links
 * the two when there is a link, and is null the rest of the time.
 *
 * `expiresOn` is stored rather than derived from `purchasedOn + months`. The
 * arithmetic is trivial, but this column is what the list sorts on, what the
 * reminder scheduler scans, and what an index can actually serve — and it
 * leaves room for the cases the arithmetic cannot express, such as an extended
 * warranty bought later that moves the date without changing the purchase.
 */
export const warranties = sqliteTable(
  'warranties',
  {
    ...syncColumns,
    productName: text('product_name').notNull(),
    brand: text('brand'),
    /** Where it was bought. The shop is who you go back to for a claim. */
    retailer: text('retailer'),
    /** Serial or model number — the thing every claim form asks for first. */
    serial: text('serial'),
    purchasedOn: integer('purchased_on').notNull(),
    /** Length of cover in months. Kept so the form can show what was chosen. */
    months: integer('months').notNull().default(12),
    expiresOn: integer('expires_on').notNull(),
    priceMinor: integer('price_minor'),
    currency: text('currency'),
    /**
     * Photos of the receipt, the warranty card, the serial plate. Stored as
     * file names in the app's receipts folder, comma separated — the same
     * device-only storage as bill photos, and excluded from cloud backup for
     * the same reason.
     */
    photos: text('photos'),
    notes: text('notes'),
    /** The expense this came from, when it came from one. */
    transactionId: text('transaction_id'),
  },
  (t) => [index('warranty_expiry_idx').on(t.expiresOn)],
);

/* ------------------------------------------------------------- loyalty cards */

/**
 * Loyalty and membership cards.
 *
 * The point of this table is the wallet in somebody's back pocket: eight plastic
 * cards they never carry, so the points never get collected. What the till
 * actually needs is the number, in a form the scanner can read off a screen —
 * so `code` is the payload exactly as scanned, and `symbology` is what it was
 * scanned as, because the same digits drawn as EAN-13 and as Code 128 are two
 * different barcodes and only one of them will beep.
 *
 * Photos of the card front and back are kept for the cases a barcode cannot
 * cover: a card with no barcode, a handwritten number, the terms printed on the
 * back. Same device-only folder as bill photos.
 */
export const loyaltyCards = sqliteTable(
  'loyalty_cards',
  {
    ...syncColumns,
    /** The shop. This is what people search by. */
    name: text('name').notNull(),
    /** The scanned payload, or a number typed in by hand. */
    code: text('code').notNull(),
    /** code128 | ean13 | qr | unknown — what the scanner said it was. */
    symbology: text('symbology').notNull().default('unknown'),
    /** Free text: the membership tier, the phone number the account is under. */
    notes: text('notes'),
    /** Hex, for the card's colour in the list. */
    colour: text('colour'),
    /** Photos of the card itself, comma separated file names. */
    photos: text('photos'),
    /** Bumped on every use, so the cards you actually use float to the top. */
    usedCount: integer('used_count').notNull().default(0),
    lastUsedAt: integer('last_used_at'),
  },
  (t) => [index('loyalty_name_idx').on(t.name)],
);

/* ---------------------------------------------------------------- fx & capture */

/** Cached rates, so multi-currency works offline from the last known values. */
export const fxRates = sqliteTable('fx_rates', {
  pair: text('pair').primaryKey(), // "USD:INR"
  rate: real('rate').notNull(),
  fetchedAt: integer('fetched_at').notNull(),
});

/**
 * SMS parsing templates. Shipped as DATA, not code, so a new bank format is a
 * JSON edit rather than an app release. Used only in non-Play builds (§2.5).
 */
export const smsTemplates = sqliteTable(
  'sms_templates',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    /** Regex with named groups: amount, merchant, account, date. */
    pattern: text('pattern').notNull(),
    fieldMapJson: text('field_map_json').notNull(),
    version: integer('version').notNull().default(1),
    isActive: integer('is_active').notNull().default(1),
  },
  (t) => [index('sms_templates_active_idx').on(t.isActive)],
);

/* -------------------------------------------------------------------- outbox */

/** Pending local changes, drained by the sync layer in v1.1. */
export const outbox = sqliteTable('outbox', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  tableName: text('table_name').notNull(),
  rowId: text('row_id').notNull(),
  /** insert | update | delete */
  op: text('op').notNull(),
  at: integer('at').notNull().default(sql`(unixepoch() * 1000)`),
});

/* --------------------------------------------------------------------- types */

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type Rule = typeof rules.$inferSelect;
export type Recurring = typeof recurring.$inferSelect;
export type Warranty = typeof warranties.$inferSelect;
export type LoyaltyCard = typeof loyaltyCards.$inferSelect;
export type NewWarranty = typeof warranties.$inferInsert;
