import { describe, expect, it } from '@jest/globals';

import {
  applyCaps,
  backupReminder,
  dueReminders,
  inboxReminder,
  nextDailyReminder,
  outsideQuietHours,
  PRIORITY,
  parseTimeOfDay,
  reminderTimeChoices,
  warrantyReminders,
  type DueItem,
  type Plan,
} from '../notifications';

const DAY = 24 * 60 * 60 * 1000;

/** Local time, so the tests read the way the user experiences the clock. */
function at(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

function hourOf(ms: number): number {
  return new Date(ms).getHours();
}

function dateOf(ms: number): number {
  return new Date(ms).getDate();
}

describe('parseTimeOfDay', () => {
  it('reads a normal time', () => {
    expect(parseTimeOfDay('21:00')).toEqual({ hour: 21, minute: 0 });
    expect(parseTimeOfDay('07:45')).toEqual({ hour: 7, minute: 45 });
  });

  it('falls back rather than throwing on nonsense', () => {
    expect(parseTimeOfDay('')).toEqual({ hour: 21, minute: 0 });
    expect(parseTimeOfDay('25:00')).toEqual({ hour: 21, minute: 0 });
    expect(parseTimeOfDay('12:99')).toEqual({ hour: 12, minute: 0 });
  });
});

describe('quiet hours', () => {
  it('leaves a daytime moment alone', () => {
    const noon = at(2026, 9, 11, 12, 30);
    expect(outsideQuietHours(noon)).toBe(noon);
  });

  it('pushes a late-night moment to the next morning', () => {
    const late = at(2026, 9, 11, 23, 40);
    const moved = outsideQuietHours(late);
    expect(dateOf(moved)).toBe(12);
    expect(hourOf(moved)).toBe(8);
  });

  it('pushes a small-hours moment to the same morning', () => {
    const small = at(2026, 9, 11, 3, 15);
    const moved = outsideQuietHours(small);
    expect(dateOf(moved)).toBe(11);
    expect(hourOf(moved)).toBe(8);
  });

  it('never moves a moment backwards', () => {
    for (const h of [0, 5, 7, 8, 12, 21, 22, 23]) {
      const t = at(2026, 9, 11, h, 0);
      expect(outsideQuietHours(t)).toBeGreaterThanOrEqual(t);
    }
  });
});

describe('daily reminder', () => {
  const morning = at(2026, 9, 11, 9, 0);

  it('aims at tonight when nothing has been logged', () => {
    const next = nextDailyReminder(morning, '21:00', null);
    expect(next).not.toBeNull();
    expect(dateOf(next!)).toBe(11);
    expect(hourOf(next!)).toBe(21);
  });

  /** The whole reason this function exists. */
  it('skips tonight when something was already logged today', () => {
    const loggedAt = at(2026, 9, 11, 8, 30);
    const next = nextDailyReminder(morning, '21:00', loggedAt);
    expect(dateOf(next!)).toBe(12);
    expect(hourOf(next!)).toBe(21);
  });

  it('does not skip when the last entry was yesterday', () => {
    const yesterday = at(2026, 9, 10, 22, 0);
    const next = nextDailyReminder(morning, '21:00', yesterday);
    expect(dateOf(next!)).toBe(11);
  });

  it('rolls to tomorrow when tonight has already passed', () => {
    const late = at(2026, 9, 11, 21, 30);
    const next = nextDailyReminder(late, '21:00', null);
    expect(dateOf(next!)).toBe(12);
  });

  /**
   * Logging at 23:00 and being reminded at 08:00 the next morning would be the
   * naive result of stacking the skip on top of the quiet-hours shift.
   */
  it('does not produce a morning reminder for a late-night logger', () => {
    const lateNight = at(2026, 9, 11, 23, 10);
    const next = nextDailyReminder(lateNight, '21:00', lateNight);
    expect(dateOf(next!)).toBe(12);
    expect(hourOf(next!)).toBe(21);
  });

  /**
   * A time the user chose themselves is honoured exactly, even inside quiet
   * hours. Moving it would read as a broken setting, not as consideration —
   * the picker is what keeps them out of the small hours.
   */
  it('honours a chosen time exactly', () => {
    const next = nextDailyReminder(morning, '23:00', null);
    expect(hourOf(next!)).toBe(23);
    expect(dateOf(next!)).toBe(11);
  });

  it('only offers deliverable times in the picker', () => {
    const choices = reminderTimeChoices();
    expect(choices[0]).toBe('06:00');
    expect(choices.at(-1)).toBe('21:30');
    expect(choices).toHaveLength(32);
  });
});

describe('due reminders', () => {
  const now = at(2026, 9, 11, 10, 0);

  const rent: DueItem = {
    id: 'r1',
    name: 'Rent',
    amountMinor: 1500000,
    nextAt: at(2026, 9, 15, 0, 0),
    autoPost: false,
  };

  it('warns the morning before a manual item', () => {
    const [plan] = dueReminders([rent], now);
    expect(plan).toBeDefined();
    expect(dateOf(plan!.at)).toBe(14);
    expect(hourOf(plan!.at)).toBe(9);
    expect(plan!.kind).toBe('due');
  });

  it('tells you on the day for an auto-posting item', () => {
    const [plan] = dueReminders([{ ...rent, autoPost: true }], now);
    expect(dateOf(plan!.at)).toBe(15);
    expect(plan!.kind).toBe('posted');
  });

  it('drops anything already in the past rather than firing it late', () => {
    const overdue: DueItem = { ...rent, id: 'r2', nextAt: at(2026, 9, 9, 0, 0) };
    expect(dueReminders([overdue], now)).toEqual([]);
  });

  it('drops the warning when the item is due today', () => {
    // Yesterday 09:00 has passed, so there is nothing useful left to say.
    const today: DueItem = { ...rent, id: 'r3', nextAt: at(2026, 9, 11, 18, 0) };
    expect(dueReminders([today], now)).toEqual([]);
  });

  it('ignores items beyond the horizon', () => {
    const far: DueItem = { ...rent, id: 'r4', nextAt: now + 60 * DAY };
    expect(dueReminders([far], now, 30)).toEqual([]);
  });

  it('keys on the occurrence, so rescheduling cannot double-book', () => {
    const a = dueReminders([rent], now)[0]!;
    const b = dueReminders([rent], now + 2 * 60 * 60 * 1000)[0]!;
    expect(a.key).toBe(b.key);
  });
});

describe('inbox reminder', () => {
  const now = at(2026, 9, 11, 10, 0);

  it('says nothing when the inbox is empty', () => {
    expect(inboxReminder(0, now)).toBeNull();
  });

  it('fires this evening when there is something waiting', () => {
    const plan = inboxReminder(3, now)!;
    expect(dateOf(plan.at)).toBe(11);
    expect(hourOf(plan.at)).toBe(20);
    expect(plan.params).toEqual({ count: 3 });
  });
});

describe('backup reminder', () => {
  const now = at(2026, 9, 11, 10, 0);

  it('stays quiet when a backup ran recently', () => {
    expect(backupReminder(now - 3 * DAY, null, now)).toBeNull();
  });

  it('speaks up after two weeks of silence', () => {
    const plan = backupReminder(now - 20 * DAY, null, now)!;
    expect(plan.kind).toBe('backup');
    expect(plan.params).toEqual({ days: 20 });
    expect(dateOf(plan.at)).toBe(12);
  });

  it('speaks up when a backup has never run', () => {
    const plan = backupReminder(null, null, now)!;
    expect(plan.params).toEqual({});
  });

  /** The second clock: having said it once, it must not say it daily. */
  it('does not repeat itself within the silence window', () => {
    expect(backupReminder(now - 30 * DAY, now - 2 * DAY, now)).toBeNull();
  });

  it('repeats once the silence window has passed', () => {
    expect(backupReminder(now - 40 * DAY, now - 20 * DAY, now)).not.toBeNull();
  });
});

describe('warranty reminders', () => {
  const now = at(2026, 9, 11, 10);
  const tv = { id: 'tv', name: 'Samsung TV', expiresOn: at(2026, 10, 20, 23) };

  it('warns thirty days and seven days out', () => {
    const plans = warrantyReminders([tv], now, 60);
    expect(plans).toHaveLength(2);
    // 20 September and 13 October, both at 10:00.
    expect(plans.map((p) => dateOf(p.at)).sort((a, b) => a - b)).toEqual([13, 20]);
    expect(plans.every((p) => hourOf(p.at) === 10)).toBe(true);
  });

  it('skips a lead time that has already passed', () => {
    // Eight days out: the thirty-day warning is history, the seven-day one is
    // tomorrow.
    const soon = { ...tv, expiresOn: at(2026, 9, 19, 23) };
    const plans = warrantyReminders([soon], now, 60);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.params).toEqual({ name: 'Samsung TV', days: 7 });
  });

  /** By the expiry date the only available action is regret. */
  it('says nothing on or after the expiry day', () => {
    expect(warrantyReminders([{ ...tv, expiresOn: at(2026, 9, 11, 23) }], now, 60)).toEqual([]);
    expect(warrantyReminders([{ ...tv, expiresOn: at(2026, 8, 1, 23) }], now, 60)).toEqual([]);
  });

  it('ignores anything past the scheduling horizon', () => {
    const far = { ...tv, expiresOn: at(2027, 6, 1, 23) };
    expect(warrantyReminders([far], now, 30)).toEqual([]);
  });

  it('keys on the item and the lead time, so rescheduling cannot double-book', () => {
    const a = warrantyReminders([tv], now, 60).map((p) => p.key).sort();
    const b = warrantyReminders([tv], now + 60 * 60 * 1000, 60).map((p) => p.key).sort();
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('outranks the daily nudge when they collide', () => {
    const [warranty] = warrantyReminders([tv], now, 60);
    expect(warranty!.priority).toBeLessThan(PRIORITY.daily);
  });
});

describe('caps', () => {
  const base = at(2026, 9, 11, 9, 0);

  function plan(key: string, day: number, priority: number, hour = 9): Plan {
    return { key, kind: 'daily', at: at(2026, 9, day, hour, 0), priority };
  }

  it('keeps only one per day, preferring the more important one', () => {
    const kept = applyCaps([
      plan('low', 11, 4, 21),
      plan('high', 11, 0, 21),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.key).toBe('high');
  });

  it('keeps the earlier of two on different days', () => {
    const kept = applyCaps([plan('a', 11, 4), plan('b', 12, 4)]);
    expect(kept.map((p) => p.key)).toEqual(['a', 'b']);
  });

  it('stops at four in a rolling week', () => {
    const kept = applyCaps(
      [11, 12, 13, 14, 15, 16].map((d) => plan(`d${d}`, d, 4)),
    );
    expect(kept).toHaveLength(4);
    expect(kept.map((p) => p.key)).toEqual(['d11', 'd12', 'd13', 'd14']);
  });

  it('lets the count recover once the window has moved on', () => {
    const days = [11, 12, 13, 14, 20, 21];
    const kept = applyCaps(days.map((d) => plan(`d${d}`, d, 4)));
    expect(kept.map((p) => p.key)).toContain('d20');
    expect(kept.map((p) => p.key)).toContain('d21');
  });

  it('is stable — capping an already-capped plan changes nothing', () => {
    const once = applyCaps([11, 12, 13, 14, 15].map((d) => plan(`d${d}`, d, 4)));
    expect(applyCaps(once)).toEqual(once);
  });

  it('does nothing to an empty plan', () => {
    expect(applyCaps([])).toEqual([]);
  });

  void base;
});
