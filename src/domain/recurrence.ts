/**
 * Recurring transactions.
 *
 * Rent, EMI, the phone bill — the things that happen every month whether you
 * record them or not. Getting these in automatically is the difference between
 * a tracker that reflects your life and one that only knows about the coffee.
 *
 * We use a deliberately small subset of RFC 5545's RRULE:
 *
 *     FREQ=DAILY|WEEKLY|MONTHLY|YEARLY   (required)
 *     INTERVAL=n                          (default 1)
 *     BYMONTHDAY=d                        (MONTHLY / YEARLY)
 *     BYDAY=MO|TU|WE|TH|FR|SA|SU          (WEEKLY)
 *     BYMONTH=m                           (YEARLY)
 *
 * Anything more is a calendar app's problem, not a budget app's. Storing the
 * standard string rather than our own format means a future export is a real
 * iCalendar rule rather than something only this app understands.
 *
 * Pure functions. No React, no database.
 */

import { addDays, addMonths, daysInMonth, startOfDay } from './dates';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Recurrence {
  freq: Freq;
  interval: number;
  /** 1–31 for MONTHLY / YEARLY. Clamped to the month's length when applied. */
  byMonthDay?: number;
  /** 0 = Sunday … 6 = Saturday, for WEEKLY. */
  byDay?: number;
  /** 1–12 for YEARLY. */
  byMonth?: number;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Parse the subset above. Returns null for anything we do not understand. */
export function parseRRule(input: string | null | undefined): Recurrence | null {
  if (!input) return null;

  const parts = new Map<string, string>();
  for (const chunk of input.split(';')) {
    const [rawKey, rawValue] = chunk.split('=');
    if (!rawKey || rawValue === undefined) continue;
    parts.set(rawKey.trim().toUpperCase(), rawValue.trim().toUpperCase());
  }

  const freq = parts.get('FREQ') as Freq | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;

  const intervalRaw = Number(parts.get('INTERVAL') ?? 1);
  const interval = Number.isFinite(intervalRaw) && intervalRaw >= 1 ? Math.trunc(intervalRaw) : 1;

  const out: Recurrence = { freq, interval };

  const monthDay = Number(parts.get('BYMONTHDAY'));
  if (Number.isFinite(monthDay) && monthDay >= 1 && monthDay <= 31) {
    out.byMonthDay = Math.trunc(monthDay);
  }

  const day = parts.get('BYDAY');
  if (day) {
    const index = WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);
    if (index >= 0) out.byDay = index;
  }

  const month = Number(parts.get('BYMONTH'));
  if (Number.isFinite(month) && month >= 1 && month <= 12) {
    out.byMonth = Math.trunc(month);
  }

  return out;
}

/** Back to the standard string, for storage. */
export function formatRRule(r: Recurrence): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byMonth) parts.push(`BYMONTH=${r.byMonth}`);
  if (r.byMonthDay) parts.push(`BYMONTHDAY=${r.byMonthDay}`);
  if (r.byDay !== undefined) parts.push(`BYDAY=${WEEKDAYS[r.byDay]}`);
  return parts.join(';');
}

/** Set the day of a month, clamped — 31 in February means the 28th or 29th. */
function withMonthDay(ms: number, day: number): number {
  const d = new Date(ms);
  const clamped = Math.min(day, daysInMonth(d.getFullYear(), d.getMonth()));
  d.setDate(clamped);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The first occurrence strictly after `after`.
 *
 * `from` anchors the series — for a monthly rule with no BYMONTHDAY, the day
 * of the month comes from the anchor, which is how "the 3rd of every month"
 * works without the user having to say so.
 */
export function nextOccurrence(r: Recurrence, from: number, after: number): number {
  const anchor = startOfDay(from);
  const cutoff = startOfDay(after);

  switch (r.freq) {
    case 'DAILY': {
      if (anchor > cutoff) return anchor;
      const gap = Math.floor((cutoff - anchor) / 86400000);
      const steps = Math.floor(gap / r.interval) + 1;
      return startOfDay(addDays(anchor, steps * r.interval));
    }

    case 'WEEKLY': {
      const targetDow = r.byDay ?? new Date(anchor).getDay();
      // Move the anchor forward to the first matching weekday.
      let first = anchor;
      const shift = (targetDow - new Date(anchor).getDay() + 7) % 7;
      first = startOfDay(addDays(anchor, shift));

      if (first > cutoff) return first;
      const weeks = Math.floor((cutoff - first) / (7 * 86400000));
      const steps = Math.floor(weeks / r.interval) + 1;
      return startOfDay(addDays(first, steps * r.interval * 7));
    }

    case 'MONTHLY': {
      const day = r.byMonthDay ?? new Date(anchor).getDate();
      let candidate = withMonthDay(anchor, day);
      if (candidate <= cutoff) {
        const a = new Date(anchor);
        const c = new Date(cutoff);
        const monthsApart = (c.getFullYear() - a.getFullYear()) * 12 + (c.getMonth() - a.getMonth());
        // Jump to just BELOW the cutoff in one step — a rule untouched for six
        // years must not be walked month by month — then step forward until we
        // are past it. Landing short and stepping is safe; overshooting is not,
        // because a clamped month (31 → 28) would skip a due date entirely.
        const steps = Math.max(0, Math.floor(monthsApart / r.interval)) * r.interval;
        candidate = withMonthDay(addMonths(anchor, steps), day);
        while (candidate <= cutoff) {
          candidate = withMonthDay(addMonths(candidate, r.interval), day);
        }
      }
      return candidate;
    }

    case 'YEARLY': {
      const day = r.byMonthDay ?? new Date(anchor).getDate();
      const monthIndex = (r.byMonth ?? new Date(anchor).getMonth() + 1) - 1;
      let year = new Date(anchor).getFullYear();
      let candidate = withMonthDay(new Date(year, monthIndex, 1).getTime(), day);
      while (candidate <= cutoff) {
        year += r.interval;
        candidate = withMonthDay(new Date(year, monthIndex, 1).getTime(), day);
      }
      return candidate;
    }
  }
}

/**
 * Every occurrence in [from, to), capped.
 *
 * The cap matters: if someone opens the app after six months away, a daily
 * rule would otherwise try to create a hundred and eighty transactions in one
 * go. The cap turns that into "the most recent N", which is the honest thing
 * to show and cannot lock up the UI.
 */
export function occurrencesBetween(
  r: Recurrence,
  anchor: number,
  from: number,
  to: number,
  limit = 60,
): number[] {
  const out: number[] = [];
  let cursor = from - 1;

  for (let i = 0; i < limit; i++) {
    const next = nextOccurrence(r, anchor, cursor);
    if (next >= to) break;
    out.push(next);
    if (next <= cursor) break; // paranoia: never loop forever
    cursor = next;
  }

  return out;
}

/** A translation key and params describing a rule in plain language. */
export function describeRecurrence(r: Recurrence): { key: string; params: Record<string, string> } {
  const every = String(r.interval);
  if (r.interval === 1) {
    switch (r.freq) {
      case 'DAILY':
        return { key: 'recurring.everyDay', params: {} };
      case 'WEEKLY':
        return { key: 'recurring.everyWeek', params: {} };
      case 'MONTHLY':
        return { key: 'recurring.everyMonth', params: {} };
      case 'YEARLY':
        return { key: 'recurring.everyYear', params: {} };
    }
  }
  switch (r.freq) {
    case 'DAILY':
      return { key: 'recurring.everyNDays', params: { n: every } };
    case 'WEEKLY':
      return { key: 'recurring.everyNWeeks', params: { n: every } };
    case 'MONTHLY':
      return { key: 'recurring.everyNMonths', params: { n: every } };
    case 'YEARLY':
      return { key: 'recurring.everyNYears', params: { n: every } };
  }
}

/** The presets the UI offers. Anything else can be typed as an RRULE later. */
export const PRESETS: { key: string; rrule: string }[] = [
  { key: 'recurring.everyDay', rrule: 'FREQ=DAILY' },
  { key: 'recurring.everyWeek', rrule: 'FREQ=WEEKLY' },
  { key: 'recurring.everyMonth', rrule: 'FREQ=MONTHLY' },
  { key: 'recurring.everyYear', rrule: 'FREQ=YEARLY' },
];
