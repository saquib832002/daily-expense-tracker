import { describe, expect, it } from '@jest/globals';
import {
  applyRules,
  isValidPattern,
  matchTargets,
  ruleMatches,
  suggestCategory,
  type RuleLike,
} from '../rules';

const rule = (over: Partial<RuleLike> = {}): RuleLike => ({
  id: 'r1',
  priority: 100,
  matchType: 'contains',
  matchValue: 'swiggy',
  setCategoryId: 'food',
  setAccountId: null,
  isEnabled: 1,
  ...over,
});

describe('ruleMatches', () => {
  it('matches case-insensitively', () => {
    expect(ruleMatches(rule(), 'SWIGGY ORDER')).toBe(true);
    expect(ruleMatches(rule({ matchValue: 'SWIGGY' }), 'swiggy order')).toBe(true);
  });

  it('honours each match type', () => {
    expect(ruleMatches(rule({ matchType: 'equals', matchValue: 'swiggy' }), 'Swiggy')).toBe(true);
    expect(ruleMatches(rule({ matchType: 'equals', matchValue: 'swiggy' }), 'Swiggy Order')).toBe(false);
    expect(ruleMatches(rule({ matchType: 'startsWith', matchValue: 'swi' }), 'Swiggy')).toBe(true);
    expect(ruleMatches(rule({ matchType: 'startsWith', matchValue: 'ggy' }), 'Swiggy')).toBe(false);
    expect(ruleMatches(rule({ matchType: 'regex', matchValue: '^swi.*y$' }), 'Swiggy')).toBe(true);
  });

  it('never throws on a broken regex — one bad rule must not break the rest', () => {
    expect(ruleMatches(rule({ matchType: 'regex', matchValue: '([unclosed' }), 'anything')).toBe(false);
  });

  it('refuses an absurdly long pattern', () => {
    const long = 'a'.repeat(500);
    expect(ruleMatches(rule({ matchType: 'regex', matchValue: long }), 'a')).toBe(false);
  });

  it('ignores empty values on either side', () => {
    expect(ruleMatches(rule({ matchValue: '   ' }), 'Swiggy')).toBe(false);
    expect(ruleMatches(rule(), '')).toBe(false);
  });
});

describe('matchTargets', () => {
  it('tries the raw merchant, its normalized key, and the note', () => {
    const targets = matchTargets({ merchant: 'POS 4321 SWIGGY BANGALORE IN', note: 'lunch' });
    expect(targets).toContain('POS 4321 SWIGGY BANGALORE IN');
    expect(targets).toContain('SWIGGY');
    expect(targets).toContain('lunch');
  });

  it('deduplicates and drops blanks', () => {
    expect(matchTargets({ merchant: '', note: null })).toEqual([]);
    expect(matchTargets({ merchant: 'SWIGGY' })).toEqual(['SWIGGY']);
  });
});

describe('applyRules', () => {
  it('matches against the normalized merchant, not just the raw string', () => {
    const out = applyRules([rule()], { merchant: 'UPI/DR/412345678901/SWIGGY/YESB/swiggy@ybl' });
    expect(out.categoryId).toBe('food');
  });

  it('runs lower priority numbers first', () => {
    const out = applyRules(
      [
        rule({ id: 'b', priority: 200, setCategoryId: 'groceries' }),
        rule({ id: 'a', priority: 10, setCategoryId: 'food' }),
      ],
      { merchant: 'Swiggy' },
    );
    expect(out.categoryId).toBe('food');
    expect(out.matchedRuleId).toBe('a');
  });

  it('breaks priority ties deterministically', () => {
    const out = applyRules(
      [
        rule({ id: 'zzz', setCategoryId: 'z' }),
        rule({ id: 'aaa', setCategoryId: 'a' }),
      ],
      { merchant: 'Swiggy' },
    );
    expect(out.matchedRuleId).toBe('aaa');
  });

  it('skips disabled rules', () => {
    const out = applyRules([rule({ isEnabled: 0 })], { merchant: 'Swiggy' });
    expect(out.categoryId).toBeNull();
  });

  it('returns nothing when there is nothing to match on', () => {
    expect(applyRules([rule()], {})).toEqual({
      categoryId: null,
      accountId: null,
      matchedRuleId: null,
    });
  });

  it('can set the account as well as the category', () => {
    const out = applyRules([rule({ setAccountId: 'card' })], { merchant: 'Swiggy' });
    expect(out.accountId).toBe('card');
  });
});

describe('suggestCategory', () => {
  const never = () => null;

  it('prefers a rule over memory', () => {
    const out = suggestCategory([rule()], { merchant: 'Swiggy' }, () => 'groceries');
    expect(out).toMatchObject({ categoryId: 'food', source: 'rule' });
  });

  it('falls back to what it learned from your corrections', () => {
    const out = suggestCategory([], { merchant: 'Blue Bottle' }, (key) =>
      key === 'BLUE BOTTLE' ? 'food' : null,
    );
    expect(out).toMatchObject({ categoryId: 'food', source: 'memory' });
  });

  it('admits when it does not know', () => {
    const out = suggestCategory([], { merchant: 'Somewhere New' }, never);
    expect(out).toEqual({ categoryId: null, source: null, matchedRuleId: null });
  });
});

describe('isValidPattern', () => {
  it('accepts plain text for non-regex types', () => {
    expect(isValidPattern('contains', 'swiggy')).toBe(true);
    expect(isValidPattern('contains', '  ')).toBe(false);
  });

  it('rejects a regex that will not compile', () => {
    expect(isValidPattern('regex', '([unclosed')).toBe(false);
    expect(isValidPattern('regex', '^ok$')).toBe(true);
  });
});
