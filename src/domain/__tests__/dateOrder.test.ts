/**
 * The bug this replaces: a receipt from a US shop reading 9/3 was entered as
 * 9 March. The scanner asked "day first?" and was answered from the interface
 * LANGUAGE — English, hardcoded to `en-IN` — while the phone had been set to
 * the United States all along.
 *
 * These cases pin the countries the app is actually shipping into, plus the
 * three orderings the world uses, so nobody has to reason about ICU again.
 */
import { describe, expect, it } from '@jest/globals';

import { dateOrderExample, dateOrderFor, prefersDayFirstIn } from '../dateOrder';

describe('dateOrderFor', () => {
  it('reads month-first for the United States', () => {
    // The whole reason this module exists.
    expect(dateOrderFor('en-US')).toBe('mdy');
    expect(prefersDayFirstIn('en-US')).toBe(false);
  });

  it('reads day-first for India, the UK and the Gulf', () => {
    expect(dateOrderFor('en-IN')).toBe('dmy');
    expect(dateOrderFor('en-GB')).toBe('dmy');
    expect(dateOrderFor('ar-AE')).toBe('dmy');
    expect(dateOrderFor('ur-PK')).toBe('dmy');
    expect(dateOrderFor('hi-IN')).toBe('dmy');
  });

  it('reads year-first where that is the convention', () => {
    expect(dateOrderFor('ja-JP')).toBe('ymd');
    expect(dateOrderFor('zh-CN')).toBe('ymd');
  });

  it('does NOT infer a region from a locale ICU has no data for', () => {
    // Pinned deliberately, because it is the trap this whole module walked
    // into. `hi-US` looks like "Hindi, American conventions" and is not: ICU
    // has no such locale, falls back to plain `hi`, and answers day-first for
    // a phone sitting in Ohio. `en-DE` fails the same way in reverse, falling
    // back to `en` and claiming month-first for Germany.
    //
    // ICU does carry many language-region pairs — `en-DE` is real data and
    // correctly says day-first for English spoken in Germany. The problem is
    // that you cannot tell from the outside which pairs exist, and the ones
    // that do not fail silently by inheriting the language's home country.
    //
    // So date order is never asked of an assembled tag. It is asked of the
    // device's own locale, which the OS is already formatting with and which
    // ICU therefore certainly knows. If the Hindi case below ever starts
    // returning 'mdy', that is a change in ICU worth noticing rather than a
    // test to quietly update.
    expect(dateOrderFor('hi-US')).toBe('dmy'); // no hi-US data — falls back to India
    expect(dateOrderFor('en-DE')).toBe('dmy'); // real data — correctly German
  });

  it('is right for the real device tags people actually have', () => {
    // These are what `getLocales()[0].languageTag` returns, and they are what
    // the app asks. Every one has genuine ICU data behind it.
    expect(dateOrderFor('en-US')).toBe('mdy');
    expect(dateOrderFor('de-DE')).toBe('dmy');
    expect(dateOrderFor('pt-BR')).toBe('dmy');
    expect(dateOrderFor('ja-JP')).toBe('ymd');
    expect(dateOrderFor('ar-AE')).toBe('dmy');
  });

  it('is unaffected by the digit and calendar extensions the app pins', () => {
    expect(dateOrderFor('en-US-u-ca-gregory-nu-latn')).toBe('mdy');
    expect(dateOrderFor('ar-AE-u-ca-gregory-nu-latn')).toBe('dmy');
    expect(dateOrderFor('hi-IN-u-ca-gregory-nu-latn')).toBe('dmy');
  });

  it('covers a spread of countries the author never thought about', () => {
    // The point of asking ICU instead of writing a table: these are right
    // without anyone having listed them.
    expect(dateOrderFor('pt-BR')).toBe('dmy');
    expect(dateOrderFor('es-MX')).toBe('dmy');
    expect(dateOrderFor('fr-FR')).toBe('dmy');
    expect(dateOrderFor('ru-RU')).toBe('dmy');
    expect(dateOrderFor('ko-KR')).toBe('ymd');
  });

  it('falls back to day-first for a locale it cannot parse', () => {
    // Most of the world is day-first, and it is what the app assumed before
    // any of this existed — so a broken locale changes nothing.
    expect(dateOrderFor('not-a-locale-!!')).toBe('dmy');
  });

  it('caches without confusing one locale for another', () => {
    expect(dateOrderFor('en-US')).toBe('mdy');
    expect(dateOrderFor('en-IN')).toBe('dmy');
    expect(dateOrderFor('en-US')).toBe('mdy');
  });
});

describe('dateOrderExample', () => {
  it('shows the user what was decided on their behalf', () => {
    expect(dateOrderExample('dmy')).toBe('31/12/2026');
    expect(dateOrderExample('mdy')).toBe('12/31/2026');
    expect(dateOrderExample('ymd')).toBe('2026/12/31');
  });
});
