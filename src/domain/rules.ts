/**
 * The rules engine.
 *
 * A rule says "anything from SWIGGY is Food". Together with merchant memory
 * (which learns the same thing from your corrections), this is the whole of
 * the app's "intelligence" — and it costs nothing, runs offline, and never
 * sends a rupee of anyone's data anywhere.
 *
 * Pure functions. No React, no database.
 */

import { normalizeMerchant } from './merchant';

export type MatchType = 'contains' | 'equals' | 'startsWith' | 'regex';

export interface RuleLike {
  id: string;
  priority: number;
  matchType: string;
  matchValue: string;
  setCategoryId: string | null;
  setAccountId: string | null;
  isEnabled: number;
}

export interface DraftTransaction {
  merchant?: string | null;
  note?: string | null;
}

export interface RuleOutcome {
  categoryId: string | null;
  accountId: string | null;
  /** Which rule won, for showing "why this category?" on the detail screen. */
  matchedRuleId: string | null;
}

/** A regex longer than this is refused — a pathological pattern must not hang the app. */
const MAX_PATTERN_LENGTH = 200;

/**
 * Does this rule match this text?
 *
 * Matching is case-insensitive and ignores surrounding space, because nobody
 * types a rule expecting case to matter. An invalid regex never throws — it
 * simply matches nothing, so one bad rule cannot break categorisation for
 * every other transaction.
 */
export function ruleMatches(rule: RuleLike, text: string): boolean {
  const needle = rule.matchValue?.trim();
  if (!needle || !text) return false;

  const haystack = text.trim().toLowerCase();
  const value = needle.toLowerCase();

  switch (rule.matchType as MatchType) {
    case 'equals':
      return haystack === value;
    case 'startsWith':
      return haystack.startsWith(value);
    case 'regex': {
      if (needle.length > MAX_PATTERN_LENGTH) return false;
      try {
        return new RegExp(needle, 'i').test(text);
      } catch {
        return false;
      }
    }
    case 'contains':
    default:
      return haystack.includes(value);
  }
}

/** The strings a rule is tested against, in the order they are tried. */
export function matchTargets(draft: DraftTransaction): string[] {
  const merchant = draft.merchant?.trim() ?? '';
  const targets = [merchant, normalizeMerchant(merchant), draft.note?.trim() ?? ''];
  return targets.filter((t, i) => t !== '' && targets.indexOf(t) === i);
}

/**
 * Apply the first matching rule.
 *
 * First match wins rather than merging several, because a user debugging "why
 * did this end up in Groceries" can follow one rule, not a pile-up. Lower
 * priority numbers run first; ties break on id so the result never depends on
 * the order rows came back from SQLite.
 */
export function applyRules(rules: RuleLike[], draft: DraftTransaction): RuleOutcome {
  const targets = matchTargets(draft);
  if (targets.length === 0) return { categoryId: null, accountId: null, matchedRuleId: null };

  const ordered = [...rules]
    .filter((r) => r.isEnabled !== 0)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const rule of ordered) {
    if (targets.some((text) => ruleMatches(rule, text))) {
      return {
        categoryId: rule.setCategoryId,
        accountId: rule.setAccountId,
        matchedRuleId: rule.id,
      };
    }
  }

  return { categoryId: null, accountId: null, matchedRuleId: null };
}

/**
 * Where a category suggestion came from, cheapest first.
 * `memoryLookup` is a plain function so this stays pure and testable.
 */
export function suggestCategory(
  rules: RuleLike[],
  draft: DraftTransaction,
  memoryLookup: (merchantKey: string) => string | null,
): { categoryId: string | null; source: 'rule' | 'memory' | null; matchedRuleId: string | null } {
  const byRule = applyRules(rules, draft);
  if (byRule.categoryId) {
    return { categoryId: byRule.categoryId, source: 'rule', matchedRuleId: byRule.matchedRuleId };
  }

  const key = normalizeMerchant(draft.merchant);
  if (key) {
    const remembered = memoryLookup(key);
    if (remembered) return { categoryId: remembered, source: 'memory', matchedRuleId: null };
  }

  return { categoryId: null, source: null, matchedRuleId: null };
}

/** Is this a regex the app will actually accept? Used to validate rule input. */
export function isValidPattern(matchType: string, value: string): boolean {
  if (!value.trim()) return false;
  if (matchType !== 'regex') return true;
  if (value.length > MAX_PATTERN_LENGTH) return false;
  try {
    new RegExp(value, 'i');
    return true;
  } catch {
    return false;
  }
}
