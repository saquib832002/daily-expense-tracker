import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';

import { detectLanguage } from '@/i18n';

import { db } from './client';
import { accounts, categories, settings } from './schema';

/** Categories every new install starts with. Names come from the translation
 *  files via `nameKey`, so a Hindi user sees them in Hindi. */
const DEFAULT_EXPENSE_CATEGORIES: { key: string; icon: string; color: string }[] = [
  { key: 'category.food', icon: '🍽️', color: '#E8734A' },
  { key: 'category.groceries', icon: '🛒', color: '#3E9B5F' },
  { key: 'category.transport', icon: '🚌', color: '#4A82E8' },
  { key: 'category.fuel', icon: '⛽', color: '#B4801F' },
  { key: 'category.rent', icon: '🏠', color: '#6366F1' },
  { key: 'category.utilities', icon: '💡', color: '#E8B44A' },
  { key: 'category.phone', icon: '📱', color: '#0D9488' },
  { key: 'category.health', icon: '🩺', color: '#D9544D' },
  { key: 'category.education', icon: '📚', color: '#0891B2' },
  { key: 'category.shopping', icon: '🛍️', color: '#D452A0' },
  { key: 'category.entertainment', icon: '🎬', color: '#8E5AD6' },
  { key: 'category.emi', icon: '🏦', color: '#6B7079' },
  { key: 'category.insurance', icon: '🛡️', color: '#4A7A8C' },
  { key: 'category.family', icon: '👨‍👩‍👧', color: '#E86A8A' },
  { key: 'category.gifts', icon: '🎁', color: '#B04A3A' },
  { key: 'category.travel', icon: '✈️', color: '#4D7C0F' },
  { key: 'category.personal', icon: '🧴', color: '#A38B5C' },
  { key: 'category.household', icon: '🧹', color: '#7C8B5C' },
  { key: 'category.other', icon: '📦', color: '#8A8F98' },
];

const DEFAULT_INCOME_CATEGORIES: { key: string; icon: string; color: string }[] = [
  { key: 'category.salary', icon: '💼', color: '#14574B' },
  { key: 'category.business', icon: '🏪', color: '#2A7A5F' },
  { key: 'category.interest', icon: '📈', color: '#3F8A6E' },
  { key: 'category.refund', icon: '↩️', color: '#5C9A85' },
];

/** Currency guess from the device locale. Indian devices get INR. */
function guessCurrency(): string {
  try {
    // expo-localization gives the region; keep the mapping tiny and explicit.
    const region = getLocales()[0]?.regionCode ?? 'IN';
    const map: Record<string, string> = {
      IN: 'INR', US: 'USD', GB: 'GBP', AE: 'AED', SG: 'SGD',
      AU: 'AUD', CA: 'CAD', JP: 'JPY', DE: 'EUR', FR: 'EUR',
    };
    return map[region] ?? 'INR';
  } catch {
    return 'INR';
  }
}

/**
 * Runs once, after migrations, on a fresh install. Safe to call on every
 * launch — it checks whether anything is there before writing.
 */
export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select().from(categories).limit(1);
  if (existing.length > 0) return;

  const currency = guessCurrency();
  const now = Date.now();

  await db.insert(settings).values([
    { key: 'base_currency', value: currency, updatedAt: now },
    { key: 'language', value: detectLanguage(), updatedAt: now },
    { key: 'first_day_of_month', value: '1', updatedAt: now },
    { key: 'schema_seeded_at', value: String(now), updatedAt: now },
  ]);

  await db.insert(accounts).values({
    id: randomUUID(),
    name: 'Cash',
    type: 'cash',
    currency,
    icon: '💵',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  });

  const rows = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({
      id: randomUUID(),
      nameKey: c.key,
      icon: c.icon,
      color: c.color,
      kind: 'expense',
      isSystem: 1,
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
    })),
    ...DEFAULT_INCOME_CATEGORIES.map((c, i) => ({
      id: randomUUID(),
      nameKey: c.key,
      icon: c.icon,
      color: c.color,
      kind: 'income',
      isSystem: 1,
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
    })),
  ];

  await db.insert(categories).values(rows);
}
