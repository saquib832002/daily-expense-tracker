/**
 * What to notify about, and when — as arithmetic.
 *
 * Everything in this file is a pure function over numbers. Nothing here touches
 * `expo-notifications`, the database, or the clock: `now` is always an argument.
 * That is deliberate, because the interesting bugs in a reminder system are all
 * decisions rather than plumbing — "did it skip tonight because I already
 * logged?", "what happens to a bill due at 23:40?", "does the weekly cap count
 * the ones that were dropped?" — and none of those can be tested through an OS
 * that delivers its answer tomorrow evening.
 *
 * The service layer that calls this owns the side effects and is deliberately
 * dull. This file owns the judgement.
 */

/** A notification the app intends to post, before any capping. */
export interface Plan {
  /** Stable across reschedules, so the same event never double-books. */
  key: string;
  kind: NotificationKind;
  /** When it should fire, epoch ms. Already moved out of quiet hours. */
  at: number;
  /** Lower sorts first when two want the same day. */
  priority: number;
  /** Filled in by the service from the translation files. */
  params?: Record<string, string | number>;
}

export type NotificationKind = 'daily' | 'due' | 'posted' | 'inbox' | 'backup' | 'warranty';

/**
 * Priority when two notifications want the same day.
 *
 * A bill you are about to miss beats a nudge to open the app. The daily
 * reminder loses every contest it enters, which is correct: it is the one that
 * repeats tomorrow anyway.
 */
export const PRIORITY: Record<NotificationKind, number> = {
  due: 0,
  // A warranty you are about to lose ranks just under a bill you are about to
  // miss, and above everything else: it is the only one of these where being
  // told a week late costs real money.
  warranty: 1,
  posted: 2,
  backup: 3,
  inbox: 4,
  daily: 5,
};

/* ------------------------------------------------------------ quiet hours */

export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;

/**
 * Move a moment out of the 22:00–08:00 window.
 *
 * Late evening moves forward to 08:00 the next morning; small hours move
 * forward to 08:00 the same morning. Never backwards — a reminder that arrives
 * before the thing it is reminding you about has become relevant is fine, but
 * one that arrives after you have gone to sleep is a notification you wake up
 * to and resent.
 */
export function outsideQuietHours(at: number): number {
  const d = new Date(at);
  const hour = d.getHours();

  if (hour >= QUIET_START_HOUR) {
    d.setDate(d.getDate() + 1);
    d.setHours(QUIET_END_HOUR, 0, 0, 0);
    return d.getTime();
  }
  if (hour < QUIET_END_HOUR) {
    d.setHours(QUIET_END_HOUR, 0, 0, 0);
    return d.getTime();
  }
  return at;
}

/** Local midnight for the day containing `at`. The unit of "today". */
export function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function sameDay(a: number, b: number): boolean {
  return dayStart(a) === dayStart(b);
}

/** `"21:00"` → `{ hour: 21, minute: 0 }`. Falls back rather than throwing. */
export function parseTimeOfDay(text: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  const hour = m ? Number(m[1]) : 21;
  const minute = m ? Number(m[2]) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return { hour: 21, minute: 0 };
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return { hour, minute: 0 };
  return { hour, minute };
}

/* --------------------------------------------------------- daily reminder */

/**
 * When the next "add today's spending" reminder should fire — or null when it
 * should not fire at all.
 *
 * The rule that makes this better than everyone else's: **if they have already
 * recorded something today, tonight is skipped.** Being told to do a thing you
 * have just done is how an app trains someone to swipe its notifications away
 * without reading them, and once that habit exists the useful ones are gone
 * too.
 *
 * Note it returns one moment rather than a repeating rule. The service
 * re-schedules on every app open and every time the app is backgrounded, so
 * "tonight" is always recomputed against what the ledger actually contains.
 */
export function nextDailyReminder(
  now: number,
  timeOfDay: string,
  lastEntryAt: number | null,
): number | null {
  const { hour, minute } = parseTimeOfDay(timeOfDay);

  const today = new Date(now);
  today.setHours(hour, minute, 0, 0);
  let at = today.getTime();

  // Already past tonight's slot — aim at tomorrow.
  if (at <= now) at += 24 * 60 * 60 * 1000;

  // Recorded something today? Then tonight's slot is not wanted. If `at` is
  // already tomorrow this changes nothing, which is the point: the skip applies
  // to the reminder for the day they logged, not to the next one.
  if (lastEntryAt !== null && sameDay(lastEntryAt, now) && sameDay(at, now)) {
    at += 24 * 60 * 60 * 1000;
  }

  // Deliberately NOT passed through `outsideQuietHours`. Quiet hours protect
  // people from times the app chose; this time the person chose themselves, and
  // silently moving a 22:30 reminder to 08:00 would look like a broken setting
  // rather than a kindness. The picker offers only deliverable times instead.
  return at;
}

/** The times the reminder picker may offer: every half hour, 06:00 to 21:30. */
export function reminderTimeChoices(): string[] {
  const out: string[] = [];
  for (let h = 6; h < QUIET_START_HOUR; h += 1) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
}

/* ------------------------------------------------------------------- bills */

export interface DueItem {
  id: string;
  name: string;
  /** Minor units, for the message. */
  amountMinor: number;
  /** When it next falls due, epoch ms. */
  nextAt: number;
  /** Auto-posting items get a confirmation instead of a warning. */
  autoPost: boolean;
}

/**
 * Reminders for bills and recurring entries inside the horizon.
 *
 * Manual items are warned about the day before at 09:00, because the useful
 * moment for "rent is due tomorrow" is the evening before or the morning of,
 * not the instant it becomes overdue. Auto-posting items are told about on the
 * day, as a statement of fact rather than a task.
 *
 * Anything already in the past is dropped rather than fired late: a
 * notification about a bill that was due on Tuesday, delivered on Thursday, is
 * worse than silence.
 */
export function dueReminders(items: DueItem[], now: number, horizonDays = 30): Plan[] {
  const horizon = now + horizonDays * 24 * 60 * 60 * 1000;
  const plans: Plan[] = [];

  for (const item of items) {
    if (item.nextAt > horizon) continue;

    const day = new Date(item.nextAt);
    let at: number;

    if (item.autoPost) {
      // On the day, mid-morning: it has happened, they just need to know.
      day.setHours(9, 0, 0, 0);
      at = day.getTime();
    } else {
      day.setDate(day.getDate() - 1);
      day.setHours(9, 0, 0, 0);
      at = day.getTime();
    }

    at = outsideQuietHours(at);
    if (at <= now) continue;

    plans.push({
      key: `${item.autoPost ? 'posted' : 'due'}:${item.id}:${dayStart(item.nextAt)}`,
      kind: item.autoPost ? 'posted' : 'due',
      at,
      priority: PRIORITY[item.autoPost ? 'posted' : 'due'],
      params: { name: item.name, amount: String(item.amountMinor) },
    });
  }

  return plans;
}

/* ------------------------------------------------------------------ inbox */

/**
 * A nudge about entries waiting to be confirmed.
 *
 * Only when there is something in there, only once, and in the evening — an
 * inbox is not urgent, it is housekeeping.
 */
export function inboxReminder(count: number, now: number, timeOfDay = '20:00'): Plan | null {
  if (count <= 0) return null;

  const { hour, minute } = parseTimeOfDay(timeOfDay);
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  let at = d.getTime();
  if (at <= now) at += 24 * 60 * 60 * 1000;

  at = outsideQuietHours(at);
  return {
    key: `inbox:${dayStart(at)}`,
    kind: 'inbox',
    at,
    priority: PRIORITY.inbox,
    params: { count },
  };
}

/* ----------------------------------------------------------------- backup */

export const BACKUP_SILENCE_DAYS = 14;

/**
 * Should we mention that backups have stopped?
 *
 * Two clocks, not one. The first is how long since a backup actually
 * succeeded; the second is how long since we last said so. Without the second,
 * a user who cannot fix it right now gets told every single day, which is how a
 * safety warning turns into noise and then into a muted channel — at which
 * point the app has lost the ability to warn them about the thing that
 * genuinely loses their data.
 */
export function backupReminder(
  lastBackupAt: number | null,
  lastNudgeAt: number | null,
  now: number,
  quietDays = BACKUP_SILENCE_DAYS,
): Plan | null {
  const gap = quietDays * 24 * 60 * 60 * 1000;

  // Never backed up at all is worth saying once, on the same schedule.
  const since = lastBackupAt ?? 0;
  if (lastBackupAt !== null && now - since < gap) return null;
  if (lastNudgeAt !== null && now - lastNudgeAt < gap) return null;

  // Tomorrow morning rather than this instant: this is computed while the app
  // is open, and a notification about the app you are holding is pure noise.
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const at = outsideQuietHours(d.getTime());

  const days = lastBackupAt === null ? null : Math.floor((now - since) / (24 * 60 * 60 * 1000));
  return {
    key: `backup:${dayStart(at)}`,
    kind: 'backup',
    at,
    priority: PRIORITY.backup,
    params: days === null ? {} : { days },
  };
}

/* -------------------------------------------------------------- the caps */

export const MAX_PER_DAY = 1;
export const MAX_PER_WEEK = 4;

/**
 * Thin the plan down to something a person will tolerate.
 *
 * At most one a day and four in any rolling seven, with ties broken by
 * priority. The research behind those numbers is blunt: somewhere around half
 * of users mute an app that sends two to five messages in a week that do not
 * feel relevant, and a muted channel cannot be un-muted by writing better
 * copy later.
 *
 * Dropped plans are **dropped, not deferred**. A bill reminder pushed to the
 * day after the bill was due is not a reminder, and a daily nudge moved to
 * tomorrow collides with tomorrow's. The next reschedule — which happens every
 * time the app is opened or backgrounded — recomputes all of it anyway.
 */
export function applyCaps(plans: Plan[], perDay = MAX_PER_DAY, perWeek = MAX_PER_WEEK): Plan[] {
  const sorted = [...plans].sort((a, b) => a.at - b.at || a.priority - b.priority);

  const perDayCount = new Map<number, number>();
  const kept: Plan[] = [];

  for (const plan of sorted) {
    const day = dayStart(plan.at);
    if ((perDayCount.get(day) ?? 0) >= perDay) continue;

    // Rolling seven days, counted over what has already been kept rather than
    // over calendar weeks: a user does not experience Monday as a reset.
    const weekAgo = plan.at - 7 * 24 * 60 * 60 * 1000;
    const inWindow = kept.filter((k) => k.at > weekAgo && k.at <= plan.at).length;
    if (inWindow >= perWeek) continue;

    perDayCount.set(day, (perDayCount.get(day) ?? 0) + 1);
    kept.push(plan);
  }

  return kept;
}

/* ------------------------------------------------------------- warranties */

/** Days before expiry that a warranty is worth mentioning. */
export const WARRANTY_LEAD_DAYS = [30, 7] as const;

export interface ExpiringItem {
  id: string;
  name: string;
  /** End of the last day of cover, epoch ms. */
  expiresOn: number;
}

/**
 * Reminders that a warranty is about to run out.
 *
 * Two warnings, thirty days and seven days out, and they exist for different
 * reasons. Thirty days is enough time to actually use the cover — book the
 * service visit, find the receipt, get through to a call centre. Seven is the
 * one that catches the person who read the first and meant to deal with it.
 *
 * Nothing fires **on** the expiry day itself. By then the only available action
 * is regret, and a notification whose content is "too late" is not a reminder,
 * it is a reproach.
 */
export function warrantyReminders(
  items: ExpiringItem[],
  now: number,
  horizonDays = 30,
): Plan[] {
  const horizon = now + horizonDays * 24 * 60 * 60 * 1000;
  const plans: Plan[] = [];

  for (const item of items) {
    for (const lead of WARRANTY_LEAD_DAYS) {
      const day = new Date(item.expiresOn);
      day.setDate(day.getDate() - lead);
      day.setHours(10, 0, 0, 0);

      const at = outsideQuietHours(day.getTime());
      if (at <= now || at > horizon) continue;

      plans.push({
        key: `warranty:${item.id}:${lead}`,
        kind: 'warranty',
        at,
        priority: PRIORITY.warranty,
        params: { name: item.name, days: lead },
      });
    }
  }

  return plans;
}
