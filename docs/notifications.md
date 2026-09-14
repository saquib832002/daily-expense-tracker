# Notifications — what to send, and what never to send

**Phase 1 is built.** The daily reminder, bill due dates, the inbox nudge and
the backup warning all ship, along with the permission flow, the four Android
channels and the settings screen at More → Reminders. Phases 2 and 3 below are
still plans.

Where the code lives:

| File | What it owns |
|---|---|
| `src/domain/notifications.ts` | Every decision, as pure functions over `now`. 32 tests. |
| `src/services/notifications.ts` | Permission, channels, composing the text, scheduling. Deliberately dull. |
| `app/notifications.tsx` | The settings screen, including the battery-manager help |
| `src/db/queries.ts` → `lastEntryAt()` | The "have they logged today?" question |

---

## The one decision everything else follows from

**There is no push. There are only local notifications.**

"Push" means a server somewhere decides to wake your app. That needs Firebase
Cloud Messaging plus something to call it — a cron job, a function, a machine —
and it needs your users' data, or at least their behaviour, to live on that
machine so it knows what to say. Both of those break the two rules this project
has had since day one: no monthly cost, and the data stays on the phone.

The good news is that it costs you nothing, because **every notification worth
sending here can be computed on the phone**:

| What it needs to know | Where that already lives |
|---|---|
| Did they log anything today? | `transactions.createdAt` |
| Is rent due on Friday? | `recurring.nextAt` |
| Are they past 80% of the food budget? | `budgets` + this month's totals |
| Has a backup run lately? | `auto_backup_drive_last` |
| Did last week cost more than the one before? | the ledger |

Not one of those facts needs to leave the device, and not one needs a server to
notice it. `expo-notifications` schedules them locally, the OS delivers them
while the app is closed, and the whole feature runs on ₹0/month forever.

The only thing a real push server would add is announcements from you — "version
2 is out", "Diwali offer". That is marketing, it is the kind of notification
people mute apps over, and it can wait until there is a paid tier to announce.

---

## What the market actually sends

Feature lists from the apps you are competing with, plus the ones everyone
copies:

| App | What it notifies about |
|---|---|
| **Wallet** (BudgetBakers) | Bill and subscription due dates — *"Never miss a due date"*; *"Avoid overspending with predictive alerts"*; upcoming payments and their effect on cash flow |
| **Money Manager** (KTW) | Budget threshold alerts — *"receive alerts when you reach the threshold"*; debt reminders |
| **Spendee** | Budget limit alerts, bill reminders, shared-wallet activity (needs their server) |
| **Monefy** | Daily reminder to record expenses — the simplest one, and the one with the biggest effect on whether an expense tracker survives week two |
| **YNAB / Emma / Goodbudget** | Overspending alerts, recurring-bill warnings, weekly and monthly summaries, "unusual transaction" flags |

Strip out everything that needs bank feeds or a server and the surviving set is
small, obvious, and entirely buildable here: **log reminder, bill due, budget
threshold, periodic summary, backup health.**

The published best-practice research is blunt about the cost of getting the
volume wrong: **46% of users opt out after 2–5 messages in a week** that do not
feel relevant to them, and per-category channels are what stop a single annoying
message from taking the useful ones down with it. For personal finance the
recommended window is the evening, when people are actually thinking about what
they spent, rather than the working day.

---

## The catalogue

Nine notifications, in the order they earn their keep. Each one says what fires
it, when, and what it costs you to build.

### A. Daily log reminder — *build first*

> **Add today's spending** · Takes about twenty seconds.

The single highest-value notification an expense tracker has. The reason people
abandon these apps is not that they dislike them, it is that they forget for
four days and then feel behind. One evening nudge is the whole retention
strategy.

- **Fires:** daily, at a time the user picks. Default 21:00.
- **Clever bit:** if they have already recorded something today, **cancel
  tonight's reminder**. Every write reschedules it. A reminder to do a thing you
  already did is how an app teaches you to ignore it.
- **Cost:** small. One scheduled notification, cancelled and rescheduled on each
  transaction write and each app open.

### B. Recurring item due — *build first*

> **Rent ₹15,000 is due tomorrow** · Tap to record it.

You already have the `recurring` table and `nextAt`. This is the feature Wallet
leads its store listing with, and yours is a schedule lookup.

- **Fires:** 09:00 on the day before, for each upcoming item. Reschedule the
  next 30 days' worth on every app open.
- **Nuance:** for items that auto-post, the message is *"Rent ₹15,000 was
  recorded"* instead — a confirmation, not a task.
- **Cost:** small. One notification per due item, capped.

### C. Unconfirmed inbox — *build first*

> **3 recurring entries are waiting** · Confirm or edit them.

Things that fell due while the app was closed land in the inbox. An inbox nobody
is told about is a bug with a nice name.

- **Fires:** at most once a day, evening, and only when the inbox is non-empty.

### D. Backup health — *build first*

> **Your last backup was 12 days ago** · Open Backup & export.

This one is unusual: it protects the user from losing everything, and it
protects *you* from the support message that starts "I got a new phone and…".

- **Fires:** weekly check; notify at 14 days without a successful Drive backup,
  then stay quiet for another 14. Never more than monthly.
- **Also fires on:** a sign-in that has gone stale. While the Cloud project is
  in **Testing**, Drive tokens expire after seven days — so during your own
  testing this will fire constantly, and that is the notification telling you to
  press *Publish app*.

### E. Budget threshold — *v1.1*

> **80% of your Food budget is gone** · ₹1,600 of ₹2,000, 11 days left.

- **Fires:** computed when a transaction is written, at 80% and again at 100%.
- **Important:** if the app is in the foreground when the threshold is crossed,
  show it **in the app** and do not send a notification. Being notified about a
  thing you are looking at is the most irritating bug in this category.
- **Cap:** once per budget per threshold per month. Crossing 80% four times
  because you edited an amount is not four pieces of news.

### F. Weekly summary — *v1.1*

> **Last week: ₹4,320 across 18 entries** · Groceries was your biggest at ₹1,890.

- **Fires:** Sunday 20:00.
- **Honest limitation, and it shapes the copy:** the text has to be composed
  while the app is open and then scheduled, because nothing of yours is running
  on Sunday evening to compute it. So the numbers are as of their last visit. If
  the gap could be material, say *"as of Friday"* in the message rather than
  implying freshness the app cannot have.

### G. Monthly wrap — *v1.2*

> **September: ₹42,180 spent, ₹3,000 under budget** · See the breakdown.

Same mechanism as the weekly. Fires on the 1st at 10:00. This is the one people
screenshot, so it is worth making the number the headline.

### H. Unusual spend — *v1.2, optional*

> **₹3,400 at Reliance Smart** · That's your biggest Groceries entry this month.

Computed at write time. Genuinely useful for catching a typo — a missed decimal
point turns ₹340 into ₹3,400 and nothing else in the app will ever tell them.

### I. Re-engagement — *probably never*

> *"We miss you! Come back and track your expenses."*

Every growth blog recommends it. It is also the message that gets apps muted and
uninstalled, and yours has no server to measure whether it worked. If you ever
do it: **once**, at 14 days of silence, worded as an offer of help rather than a
guilt trip, and never again for that user.

---

## Rules that keep this from becoming spam

1. **One notification per day, maximum four per week**, across all categories
   combined. If two want to fire, the more urgent one wins and the other is
   dropped, not queued.
2. **Quiet hours 22:00–08:00.** Nothing schedules into that window, ever.
3. **Every category is its own Android channel**, so a user who hates the weekly
   summary can mute exactly that and keep the bill reminders. This is also what
   keeps one bad idea from costing you the whole notification permission.
4. **Never notify about something the user is currently looking at.**
5. **Every message carries a number.** "Check your budget" is noise; "₹1,600 of
   ₹2,000 gone, 11 days left" is information. The personalised version is the
   one people keep switched on.
6. **Nothing is ever urgent.** Inexact alarms can slip by minutes, Doze can
   delay delivery by longer, and some phones will drop them entirely (see
   below). Never write copy that implies a deadline the delivery cannot honour.

---

## Technical design

### Library

`expo-notifications`, already compatible with SDK 52. No native code to write —
it ships an Expo config plugin, so `npx expo prebuild` wires the manifest.
Scheduling API: `Notifications.scheduleNotificationAsync` with
`SchedulableTriggerInputTypes.DAILY`, `.WEEKLY` or `.DATE`, channels via
`setNotificationChannelAsync`.

### Permission — and *when* to ask

Android 13+ (your `targetSdkVersion` is 36, so this is you) requires the
`POST_NOTIFICATIONS` runtime permission. The prompt is one-shot: a denial is
close to permanent, because re-asking sends the user into system settings.

So **do not ask on first launch.** The welcome screen is already asking for a
Google account; adding a second system dialog to that moment is how you get a
denial from someone who had not yet seen anything worth being notified about.
Ask at the first moment the answer is obviously yes:

- when they switch **on** the daily reminder in Settings, or
- right after they save their **first** expense, framed by a sentence in the app
  explaining what the reminder is, *then* the system dialog.

If it is denied, the Settings screen shows the switches as off with a line
saying notifications are blocked for the app and where to turn them back on.
Never re-prompt.

### Do **not** use exact alarms

Android 12+ gates precise timing behind `SCHEDULE_EXACT_ALARM` /
`USE_EXACT_ALARM`, and Play's policy restricts the auto-granted one to apps
whose *"core, user facing functionality requires precisely-timed actions, such
as: the app is an alarm or timer app… a calendar app that shows event
notifications."* An expense tracker is neither. Declaring it invites a policy
rejection and buys nothing — a 21:00 reminder that arrives at 21:06 is a 21:00
reminder.

### Scheduling model

Nothing of yours runs in the background, so the model is simple and stateless:

> **On every app open, and after every write that changes the answer, cancel
> everything and re-schedule the next 30 days.**

- Keeps at most ~30 pending notifications — well inside any platform limit.
- Survives reboot: `expo-notifications` takes `RECEIVE_BOOT_COMPLETED` and
  restores the schedule. **Verify this on a real device before release**;
  reboot behaviour is the thing most likely to differ on an OEM ROM.
- A user who never opens the app for six weeks stops being notified after
  thirty days. That is the correct behaviour anyway — see §I.

### The India problem: OEM battery managers

Xiaomi, Oppo, Vivo, Realme and Samsung ship aggressive "battery optimisation"
that silently kills scheduled work for apps the user has not whitelisted. This
is not a bug you can fix in code, and on those brands it is the single most
common cause of "the reminder never came" — which matters, because those brands
are most of the Indian market.

Plan for it rather than fighting it: a short **"Reminders not arriving?"** entry
under the notification settings, naming the exact setting on the common brands
("Settings → Apps → Expense Tracker → Battery → Unrestricted"). One screen of
honest text beats a one-star review that says the reminders do not work.

### Localisation

Scheduled text is composed *now* and delivered *later*, so the string is frozen
at schedule time. That means **changing the app language must re-schedule
everything**, or a user who switches to Urdu keeps getting English reminders for
a month. Fold it into the existing language-change path, and use the same
`formatMoney` and date helpers the screens use so an Arabic user's amounts are
not suddenly Latin-formatted.

### Settings

A new section in More, or its own screen reached from there:

```
Reminders
  Daily reminder to log            [ on ]   at 21:00  ▸
  Bills and recurring              [ on ]
  Budget alerts                    [ on ]
  Weekly summary                   [ off ]
  Backup reminders                 [ on ]

  Reminders not arriving?                            ▸
```

Defaults: daily reminder **on** at 21:00, bills **on**, backup **on**, budget
alerts **on** in v1.1, weekly summary **off** until it has proved itself.

### Testing

The part everyone skips and then ships broken:

- Unit-test the *decisions*, not the OS: "given last entry at 14:00 today, is
  tonight's reminder cancelled?", "given 82% of budget used, which threshold
  fires?", "given quiet hours, what time does a 23:30 due item schedule to?"
  These are pure functions and belong beside the existing domain tests.
- On-device checklist: permission denied path, reboot, language change, time
  zone change, app killed from recents, and one Xiaomi or Samsung handset.

---

## Suggested order of work

| Phase | Contents | Why here |
|---|---|---|
| **1** | Permission plumbing, channels, settings screen, **daily reminder**, **recurring due**, **inbox**, **backup health** | All four are schedule-and-forget, need no new maths, and cover the cases that lose users |
| **2** | **Budget threshold**, **weekly summary** | Needs the pre-computation pattern and the frequency cap to already exist |
| **3** | **Monthly wrap**, **unusual spend** | Nice to have; neither changes whether someone keeps the app |
| **never** | Marketing pushes, streaks, guilt-trip re-engagement | No server, no upside, real downside |

Phase 1 is roughly a day's work: one new service, one settings screen, four
message templates in four languages, and the test suite above.

---

## What this does to the Play listing

Adding notifications changes two things you have already written down:

- **Permissions:** `POST_NOTIFICATIONS` appears in the manifest. It is not a
  sensitive permission and needs no declaration form.
- **Data safety:** unchanged. Local notifications collect nothing, transmit
  nothing, and involve no third party. Worth stating in the listing, because
  "reminders that work without an account" is a genuine differentiator against
  every competitor in the table above.
