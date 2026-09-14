/**
 * Reminders, delivered by Android while the app is closed.
 *
 * **Local only. There is no push server and there never needs to be.** Every
 * question these notifications answer — did they log today, is rent due on
 * Friday, has a backup run this fortnight — is already answerable from the
 * database on the phone. A push server would add a monthly bill, a Firebase
 * project, and a copy of the user's behaviour on somebody else's machine, in
 * exchange for nothing this app wants to say.
 *
 * **The scheduling model is: throw it all away and redo it.** Nothing of ours
 * runs in the background, so there is no incremental state to maintain and no
 * chance to react to anything. Instead, every time the app opens and every time
 * it is backgrounded, this cancels the lot and re-schedules the next thirty
 * days from what the database now says. That makes the whole feature stateless
 * and idempotent — the same inputs always produce the same schedule — and it is
 * why `domain/notifications.ts` can be pure functions with `now` as a
 * parameter.
 *
 * Backgrounding is the important half of that. It is the moment the ledger is
 * freshest, so it is the moment "have they logged today?" has its truest
 * answer.
 *
 * Three things deliberately NOT done here:
 *
 *   - **No exact alarms.** Play restricts `USE_EXACT_ALARM` to alarm, timer and
 *     calendar apps, and an expense tracker is none of them. A 21:00 reminder
 *     that arrives at 21:06 is a 21:00 reminder.
 *   - **No permission request on first launch.** Android gives one prompt and a
 *     denial is close to permanent. This module only ever asks when the user
 *     turns a reminder on, or just after their first expense — a moment where
 *     the answer is obviously yes.
 *   - **No notification while the app is in the foreground.** Being told about
 *     the screen you are looking at is the most irritating thing in this whole
 *     category.
 */
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import {
  countInbox,
  getBaseCurrency,
  getSetting,
  lastEntryAt,
  listRecurring,
  listWarranties,
  setSetting,
  type RecurringTemplate,
} from '@/db/queries';
import { formatMinor } from '@/domain/money';
import {
  applyCaps,
  backupReminder,
  dueReminders,
  inboxReminder,
  nextDailyReminder,
  warrantyReminders,
  PRIORITY,
  type DueItem,
  type NotificationKind,
  type Plan,
} from '@/domain/notifications';
import { t } from '@/i18n';

/* --------------------------------------------------------------- settings */

const ON_KEY: Record<NotificationKind, string> = {
  daily: 'notify_daily',
  due: 'notify_due',
  posted: 'notify_due',
  inbox: 'notify_inbox',
  backup: 'notify_backup',
  warranty: 'notify_warranty',
};

const TIME_KEY = 'notify_daily_time';
const BACKUP_NUDGE_KEY = 'notify_backup_last';
const DEFAULT_TIME = '21:00';

export interface NotificationSettings {
  daily: boolean;
  due: boolean;
  inbox: boolean;
  backup: boolean;
  warranty: boolean;
  /** "HH:MM", local. */
  time: string;
}

/**
 * Defaults are **on** for everything except nothing — all four earn their
 * place, and a reminder app whose reminders start switched off is a silent
 * app that nobody ever discovers. The permission prompt is what gates them in
 * practice, and that is asked for honestly.
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  const on = async (key: string) => (await getSetting(key)) !== '0';
  return {
    daily: await on(ON_KEY.daily),
    due: await on(ON_KEY.due),
    inbox: await on(ON_KEY.inbox),
    backup: await on(ON_KEY.backup),
    warranty: await on(ON_KEY.warranty),
    time: (await getSetting(TIME_KEY)) || DEFAULT_TIME,
  };
}

export async function setNotificationSetting(
  key: keyof Omit<NotificationSettings, 'time'>,
  value: boolean,
): Promise<void> {
  await setSetting(ON_KEY[key], value ? '1' : '0');
  await rescheduleAll();
}

export async function setReminderTime(time: string): Promise<void> {
  await setSetting(TIME_KEY, time);
  await rescheduleAll();
}

/* ------------------------------------------------------------- permission */

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export async function permissionState(): Promise<PermissionState> {
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    return canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Ask, once, at a moment the user will say yes to.
 *
 * Returns whether we ended up with permission. Never re-prompts after a
 * refusal: Android answers a second request by doing nothing at all, which
 * would leave a switch that appears to be broken.
 */
export async function ensurePermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') return true;
    if (!current.canAskAgain) return false;

    const asked = await Notifications.requestPermissionsAsync();
    return asked.status === 'granted';
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- channels */

/**
 * One channel per kind of message.
 *
 * This is what stops a single unwanted notification from costing the app all
 * of them: someone who does not want the weekly nudge can silence exactly that
 * from the system settings and keep the bill reminders. Without channels their
 * only lever is muting the app entirely, and there is no coming back from
 * that.
 */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const channels: { id: string; nameKey: string; importance: Notifications.AndroidImportance }[] = [
    { id: 'reminders', nameKey: 'notify.channelReminders', importance: Notifications.AndroidImportance.DEFAULT },
    { id: 'bills', nameKey: 'notify.channelBills', importance: Notifications.AndroidImportance.HIGH },
    { id: 'inbox', nameKey: 'notify.channelInbox', importance: Notifications.AndroidImportance.LOW },
    { id: 'backup', nameKey: 'notify.channelBackup', importance: Notifications.AndroidImportance.DEFAULT },
    { id: 'warranty', nameKey: 'notify.channelWarranty', importance: Notifications.AndroidImportance.HIGH },
  ];

  for (const channel of channels) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: t(channel.nameKey),
      importance: channel.importance,
      // No custom sound or vibration pattern: money reminders that buzz like a
      // message from a person are money reminders people turn off.
      vibrationPattern: [0, 200],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

const CHANNEL_FOR: Record<NotificationKind, string> = {
  daily: 'reminders',
  due: 'bills',
  posted: 'bills',
  inbox: 'inbox',
  backup: 'backup',
  warranty: 'warranty',
};

/* ------------------------------------------------------------------ copy */

/**
 * Turn a plan into words.
 *
 * Composed here, at schedule time, and then frozen — Android holds the text,
 * not a callback. Two consequences worth knowing: amounts are formatted in the
 * base currency as it stands today, and **changing the app's language has to
 * re-schedule everything**, or a user who switches to Urdu keeps getting
 * English reminders for a month. `rescheduleAll` is called from the language
 * switch for exactly that reason.
 */
function compose(plan: Plan, currency: string): { title: string; body: string } {
  const p = plan.params ?? {};
  const money = (raw: unknown) =>
    formatMinor(Number(raw ?? 0), currency, { compact: true });

  switch (plan.kind) {
    case 'daily':
      return { title: t('notify.dailyTitle'), body: t('notify.dailyBody') };
    case 'due':
      return {
        title: t('notify.dueTitle', { name: String(p.name ?? '') }),
        body: t('notify.dueBody', { amount: money(p.amount) }),
      };
    case 'posted':
      return {
        title: t('notify.postedTitle', { name: String(p.name ?? '') }),
        body: t('notify.postedBody', { amount: money(p.amount) }),
      };
    case 'inbox':
      return {
        title: t('notify.inboxTitle', { count: Number(p.count ?? 0) }),
        body: t('notify.inboxBody'),
      };
    case 'warranty':
      return {
        title: t('notify.warrantyTitle', { name: String(p.name ?? '') }),
        body: t('notify.warrantyBody', { days: Number(p.days ?? 0) }),
      };
    case 'backup':
      return {
        title: t('notify.backupTitle'),
        body:
          p.days === undefined
            ? t('notify.backupBodyNever')
            : t('notify.backupBody', { days: Number(p.days) }),
      };
  }
}

/* ------------------------------------------------------------- scheduling */

const HORIZON_DAYS = 30;

/**
 * Cancel everything and re-schedule the next thirty days.
 *
 * Safe to call as often as you like — that is the entire design. It swallows
 * its own errors on purpose: a reminder that could not be scheduled is a
 * disappointment, while an exception thrown out of an app-state handler is a
 * crash on the way into the app.
 */
export async function rescheduleAll(now: number = Date.now()): Promise<void> {
  try {
    if ((await permissionState()) !== 'granted') {
      await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
      return;
    }

    await ensureChannels();

    const settings = await getNotificationSettings();
    const plans: Plan[] = [];

    if (settings.daily) {
      const last = await lastEntryAt();
      const at = nextDailyReminder(now, settings.time, last);
      if (at !== null) {
        plans.push({ key: `daily:${at}`, kind: 'daily', at, priority: PRIORITY.daily });
      }
    }

    if (settings.due) {
      plans.push(...dueReminders(await upcomingItems(), now, HORIZON_DAYS));
    }

    if (settings.warranty) {
      const expiring = (await listWarranties()).map((w) => ({
        id: w.id,
        name: w.productName,
        expiresOn: w.expiresOn,
      }));
      plans.push(...warrantyReminders(expiring, now, HORIZON_DAYS));
    }

    if (settings.inbox) {
      const plan = inboxReminder(await countInbox(), now);
      if (plan) plans.push(plan);
    }

    if (settings.backup) {
      const lastBackup = Number(await getSetting('auto_backup_drive_last')) || null;
      const lastNudge = Number(await getSetting(BACKUP_NUDGE_KEY)) || null;
      const plan = backupReminder(lastBackup, lastNudge, now);
      if (plan) {
        plans.push(plan);
        // Recorded when scheduled rather than when delivered, because nothing
        // of ours runs at delivery time. It errs towards silence, which for a
        // repeat warning is the right way to err.
        await setSetting(BACKUP_NUDGE_KEY, String(now));
      }
    }

    const final = applyCaps(plans);
    const currency = await getBaseCurrency();

    await Notifications.cancelAllScheduledNotificationsAsync();

    for (const plan of final) {
      const { title, body } = compose(plan, currency);
      await Notifications.scheduleNotificationAsync({
        identifier: plan.key,
        content: {
          title,
          body,
          data: { kind: plan.kind },
          ...(Platform.OS === 'android' ? { channelId: CHANNEL_FOR[plan.kind] } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(plan.at),
          ...(Platform.OS === 'android' ? { channelId: CHANNEL_FOR[plan.kind] } : {}),
        },
      });
    }
  } catch {
    // Never a reason to break the app around it.
  }
}

/** Recurring entries that are switched on, shaped for the planner. */
async function upcomingItems(): Promise<DueItem[]> {
  const rows = await listRecurring();
  const items: DueItem[] = [];

  for (const row of rows) {
    if (!row.isEnabled) continue;
    let template: RecurringTemplate;
    try {
      template = JSON.parse(row.templateJson) as RecurringTemplate;
    } catch {
      continue;
    }
    items.push({
      id: row.id,
      name: template.merchant || template.note || t('notify.dueFallbackName'),
      amountMinor: template.amountMinor,
      nextAt: row.nextDueOn,
      autoPost: row.autoPost === 1,
    });
  }
  return items;
}

/* ------------------------------------------------------------- app wiring */

let subscription: { remove: () => void } | null = null;

/**
 * Start keeping the schedule up to date. Called once, from the root layout.
 *
 * The background transition is the one that matters: it is the last moment the
 * app knows the true state of the ledger before going quiet, so it is when
 * "have they logged today?" is most worth asking.
 */
export function startNotificationSync(): () => void {
  void rescheduleAll();

  subscription?.remove();
  subscription = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'active') void rescheduleAll();
  });

  return () => {
    subscription?.remove();
    subscription = null;
  };
}
