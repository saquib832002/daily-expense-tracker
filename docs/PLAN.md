# Daily Expense Tracker — Build Plan

**Version 2.2 · 3 September 2026 · Najmus — solo developer, Android, no server**

Decisions locked in this revision: **no server at all** — the app is entirely local, and data survives via Android Auto Backup and backup files you control · automatic backups behind a switch, off by default · two backup formats, JSON and the SQLite `.db` · receipt images never leave the phone · bill scanning with on-device OCR, and a ZIP backup that carries the photos · Expo SDK 52 · multi-currency and English + Hindi from day one · Indus Appstore first, Play in parallel.

> **What changed from 2.0.** Version 2.0 put a NestJS API and a Postgres database on your VPS. Once backup and restore worked from files, the server had nothing left to do, so it is gone — along with its auth system, its deployment, its account-deletion page and its nightly `pg_dump`. §4.2 is what replaces it and §5.2 is the honest accounting of what that costs.

---

## 1. What we're building

A simple, free Android app that helps an ordinary person see where their money goes and stop overshooting their budget. Not a fintech product. No bank logins, no money movement, no ads, no subscriptions, no investing.

**The one number that decides whether anyone keeps using it:** seconds to record a spend. Target is **under five seconds and three taps**, from lock screen to done. Every abandoned expense tracker dies the same way — typing gets tedious around day nine. Everything else in this plan is secondary to that.

### 1.1 Your constraints, and what each one settles

| Constraint | What it rules out | What it settles |
|---|---|---|
| Solo developer, no company | Apple App Store — it requires a legal entity for finance apps | Android only |
| **No server at all** (decided 3 Sep 2026) | Accounts, sync, an auth system, an account-deletion page, a deployment to keep alive | Everything lives on the phone. Data survives via Android Auto Backup and backup files you control — §4.2 |
| No recurring cost | Bank aggregators, cloud OCR, LLM APIs, paid monitoring | On-device processing for everything intelligent |
| No licensing obligations | AGPL / SSPL / BUSL components | Every dependency below is MIT, Apache-2.0, BSD, or the PostgreSQL licence — verified package by package |
| Built for a common man | Learning curves, envelope methodology, jargon | Keypad first, one screen that answers *"am I okay this month?"* |

**Running cost: ₹0, and nothing to keep running.** No server, no database, no certificate to renew, no backup job to test. The only money that could ever appear is a **one-time US$25** if you decide to publish on Google Play — and §2 shows a route that skips even that.

---

## 2. Distribution — and how to avoid the 12-tester gate

You asked whether the closed-testing requirement can be avoided entirely. **Yes.** Here is exactly what it applies to and what it doesn't.

### 2.1 What the rule actually says

Google's help page is titled *"App testing requirements for **new personal developer accounts**"*, and states the requirement applies to **personal accounts created after 13 November 2023**, which must run a closed test with **12 testers opted in continuously for 14 days** before applying for production access.

Two things follow from the wording:

- **Organization accounts are not covered.** Google never affirmatively says "organizations are exempt" — the exemption exists by scope and omission. There is no Google page requiring 12/14 of an organization account.
- **Personal accounts created before 13 Nov 2023 are grandfathered.** ⚠️ But do not go looking for one: Play Console **account ownership cannot be transferred**, and the April 2026 policy update added an explicit Account Transfer policy. Borrowing or buying an aged account is a termination risk. Rule it out.

### 2.2 Four legitimate routes around it, ranked for you

**① Indus Appstore — publish this week, no gate at all. ✅ Do this.**

PhonePe's Indian app store, and it fits this project almost suspiciously well:

- **Zero listing fees, zero commission.** Signup needs your **PAN** — and GSTIN only *if applicable*, which for a free app it isn't.
- **Review in 24–72 hours.** No closed testing, no tester count, no beta gate of any kind.
- **80 million+ users, 500,000+ apps, 12 Indian languages** — and it ships as the **default app store on Xiaomi and Lava phones**.
- Accepts APK, AAB or APKS.

For a free expense tracker aimed at Indian users, this is a better first launch than Play. You can be live in days rather than five weeks.

**② Xiaomi GetApps — also no gate, also big in India.**

Individual developer accounts accepted, ID photo required, review in 1–2 days, no fee. Large Xiaomi/Redmi/POCO base in India. Worth doing alongside Indus.

**③ Direct APK — GitHub Releases or your own site.**

No registration, no review, no fee, no gate. Pair it with **Obtainium** so early users get real auto-updates. ⚠️ One caveat with a 2027 expiry date: Android Developer Verification began enforcing on 30 September 2026 in Brazil, Indonesia, Singapore and Thailand, and **expands globally in 2027** — India is not in the first wave, but eventually direct distribution will need a **Full Distribution account (US$25 + government ID)**. The free "Limited Distribution" tier caps at **20 devices**, so it's for family, not the public. (A Play publisher who has verified is auto-registered on that side and doesn't pay twice.)

**④ A Google Play organization account — technically the direct answer, practically a bad trade.**

If you want it, the cheapest legitimate path in India is real and cheaper than you'd expect:

| Step | Cost | Time |
|---|---|---|
| **Udyam / MSME registration** at udyamregistration.gov.in | **₹0**, Aadhaar + PAN | Same day |
| **D-U-N-S number** from D&B India — standard assignment is free | **₹0** | Up to 30 business days |
| Play Console organization account | US$25 once | + verification |

**Google's own India documentation lists the Udyam (MSME) Registration Certificate as an accepted organization document.** You do not need a Private Limited company, and you do not need GST.

⚠️ **But here's the honest problem:** Google has published *nothing* on whether converting an existing personal account to an organization account lifts the gate retroactively. The requirement keys off account type *and* creation date, and the creation date doesn't change. Every confident answer online comes from companies selling tester services, and they contradict each other and Google's own docs. So this route means 4–8 weeks and some paperwork on an **undocumented assumption**. Only worth it if you want a business entity for other reasons anyway.

### 2.3 What I recommend

**Do ① and ③ immediately, and run the Play closed test in parallel rather than instead.**

Indus Appstore and GitHub Releases get the app into real hands in days, at zero cost, with no gate. That means by the time you start the Play closed test you have actual users, actual feedback, and a polished app — which is precisely what makes the production-access application succeed.

**And the closed test is more winnable for this app than for most.** The usual reason family-and-friends testing fails is that testers install a niche app and never open it again. An expense tracker is the rare thing your family will genuinely use every day. Recruit **15–18** so attrition doesn't drop you under 12, ship two or three real updates during the fourteen days, and collect written feedback you can quote in the application form — Google asks specifically how testers engaged and what you changed because of them.

Realistic Play timeline once you start: ~14 days testing (allow 18–21 for margin), then up to 7 days for the production decision and review. **Three to five weeks.** Meanwhile the app is already live on Indus.

### 2.4 The Play checklist, whenever you get there

| Item | Detail |
|---|---|
| Registration | US$25, one time. Real credit card — prepaid is rejected. |
| Identity | Government ID. **No D-U-N-S** for a personal account. |
| Your name goes public | A verified individual's name appears on the listing. That's the cost of publishing as a person. |
| Target API 36 | Android 16, required for new apps since **31 August 2026**. **SDK 52 targets 34**, so a Play submission needs either a newer SDK or an `expo-build-properties` override — untested against RN 0.76, so try it before relying on it. Does not affect Indus or your own phone. |
| Data safety form | Mandatory. Short for us — see §4.3. |
| Privacy policy URL | Required. A static page — GitHub Pages, or the site you already run. |
| Account deletion page | **Not needed in v1** — no accounts. See §4.3. |
| Don't go dormant | Accounts under 1,000 installs with no Console activity for 180 days get closed, and the $25 isn't refunded. Calendar reminder every five months. |

### 2.5 SMS auto-capture — still sequenced, and now easier

Play's policy still permits `READ_SMS` under the **"SMS-based money management"** exception, and the preview policy taking effect January 2027 keeps it. But the declaration needs a video demo, review takes weeks with the app unpublished, and the usual rejection is *"SMS reading isn't your app's primary purpose"* — **Bluecoins, an established expense tracker, was denied on exactly that and removed SMS entirely** rather than risk removal.

The Indus-first route makes this much less painful:

- The **Indus and direct-APK builds can include SMS from day one.** No declaration, no review, no waiting. You get the feature you actually want, immediately, on your own phone and your family's.
- The **Play build ships without the permission** and sails through review.
- You apply for the Play declaration later, with install numbers and a video to point at.
- **The app never depends on SMS.** If the declaration is refused forever, nothing breaks.

⚠️ One line to draw deliberately in code: reading a **bank app's own push notifications** via `NotificationListenerService` is defensible and needs no declaration. Scraping the **Messages app's** notifications to extract SMS bodies is reasonably read as circumventing the SMS policy, which is explicitly prohibited. Don't do the second one.

---

## 3. Feature set

Deliberately small. A common man's tracker fails by having too much, not too little.

### 3.1 v1

**Recording a spend**
- Amount keypad opens first. Category, then done. Under five seconds.
- Home-screen widget: tap → keypad, already open.
- A dismissible ongoing notification with a "+ Add" action, so it's one tap from the lock screen.
- Recent-merchant chips: the six things you buy most, one tap each.
- Receipt scan: point the camera, on-device text recognition fills amount/date/merchant, you confirm.
- **SMS auto-capture** in the Indus and direct-APK builds (§2.5), with every captured item landing in an inbox for one-tap confirmation — never written silently.

**Understanding your money**
- Home screen answers one question at a glance: **"How much can I still spend this month?"** — a number, a ring, and days remaining.
- Monthly budgets overall and per category, with a pace indicator (*"you're 60% through the month and 78% through your food budget"*).
- Category donut, spend-over-time bars, month-on-month comparison.
- Full transaction list with search and filters.

**Keeping it accurate without work**
- Rule-based auto-categorization that learns: correct a merchant once, remembered forever.
- Recurring entries (rent, EMI, subscriptions) that post themselves.
- Multiple accounts/wallets — cash, bank, card, UPI — with running balances.
- Split one purchase across categories.

**Not losing it**
- CSV export, and a one-file backup you can restore from.
- Fingerprint app lock.
- Reminders: a daily nudge if nothing was logged; an alert when a budget is nearly gone.

**In v1 because you asked for them from the start** (both are painful to retrofit):
- **Multi-currency.** Every account has its own currency; every transaction stores its own amount and currency plus a converted base amount. Reports roll up in your chosen base currency.
- **English and Hindi**, with the string layer built so adding Tamil, Telugu, Bengali or Marathi later is a translation file, not a code change.

**Deliberately not in v1:** bank connections, investments, net worth, shared/group expenses, AI chat, web dashboard, iOS, and cloud sync (see §4.3).

### 3.2 v2 and later

Cloud sync with accounts · SMS on the Play build once the declaration lands · split-with-friends · savings goals · richer reports · more languages.

### 3.3 What "AI" means here — and why it costs nothing

You don't need an LLM, and using one would create both a cost line and a Play policy problem. Categorizing `SWIGGY*ORDER` as Food is a lookup, not reasoning.

```
1. Does a rule you wrote match?           → use it       (instant, free)
2. Have you categorized this merchant?    → reuse it     (instant, free)
3. Does the built-in merchant list match? → suggest it   (instant, free)
4. Otherwise                              → ask once, then remember
```

After a few weeks this is right most of the time, and it improves the more you use it. Offline, free, and nothing leaves the phone.

⚠️ Why the free LLM tiers are off the table: Google's Gemini API terms for the **unpaid** tier state that submitted content is used to improve Google products and that **human reviewers may read it**, and explicitly say not to submit personal or confidential information. Sending someone's bank SMS there would violate both those terms and Play's User Data policy.

---

## 4. Architecture

### 4.1 Local-first, and now for a better reason

**The phone's SQLite database is the source of truth.** The app is completely functional with the server switched off.

This began as a defence against free-tier cold starts, survived the move to your own VPS, and on 3 September 2026 finished the journey: once the phone is the source of truth and backup files already move data between phones, the server has nothing left to do. So there isn't one.

**Your data never makes a network call.** No analytics, no crash reporting, no update check, no account, and no bill photo ever leaves the phone. One caveat, stated plainly because a privacy claim with a hidden exception is worse than no claim: the bill scanner uses Google's **ML Kit**, which reads the photo entirely on the device but reports its own usage diagnostics to Google. That cannot be switched off, it must be disclosed in the privacy policy, and it is the only thing in the app that touches the network. Drop the scanner and the absolute claim comes back.

```
┌────────────────────── ANDROID APP (the whole product) ─────────────────────┐
│                                                                            │
│   Screens (Expo Router) · i18n (en, hi)                                    │
│        │                                                                   │
│   Feature hooks ── read/write ──►  SQLite (expo-sqlite)  ◄── SOURCE OF     │
│        │                              │                       TRUTH        │
│   Native:  Camera + ML Kit OCR        │                                    │
│            Biometric lock             │                                    │
│            Widget · Notifications     │                                    │
│            SMS reader (non-Play build)│                                    │
│                                       ▼                                    │
│              files/backups/   auto-YYYYMMDD-HHMM.json  (last 5)            │
│              files/receipts/  images — these never leave the phone         │
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │  no network · no account · no server
                    ┌──────────────────┴───────────────────┐
                    ▼                                      ▼
      ┌───────────────────────────────┐   ┌───────────────────────────────┐
      │  ANDROID AUTO BACKUP          │   │  YOU: "Save a backup"         │
      │  automatic, to your Drive     │   │  .json or .db, via the share  │
      │  no user action needed        │   │  sheet — wherever you choose  │
      │  restores on a new phone      │   │  survives even an uninstall   │
      └───────────────────────────────┘   └───────────────────────────────┘
```

### 4.2 Backup and restore, which is what replaces sync

Four layers, deliberately overlapping, because a backup story with one layer is a backup story with one point of failure.

| Layer | What it saves you from | Does it need you to remember anything? |
|---|---|---|
| **Android Auto Backup** — on | New phone, factory reset, accidental uninstall | **No.** Google copies the app's folder to your Drive on its own |
| **Automatic snapshots** — a switch, off by default | Corruption, a bad import, "I deleted a month by mistake" | Turn it on once. A backup every 7 days, the last 5 kept |
| **Save a backup file** — `.zip`, `.json` or the SQLite `.db` | Everything, including uninstalling the app | Yes, and that is the point. It goes wherever you choose |
| **CSV export** | Nothing — it is for reading in a spreadsheet | — |

**Three backup formats, each for a different fear.** The **ZIP** is the complete one and the one to keep, because it is the only one carrying your bill photos. The **JSON** is readable in any text editor in ten years, for when the thing you distrust is this app. The **`.db`** is a byte-for-byte copy of the database itself, for when the thing you distrust is the JSON writer. Formats that fail in different ways is the entire reason to carry more than one.

**Restoring is destructive, and says so before it runs.** It deletes what is on the phone and puts the backup in its place. A restore that merged would silently duplicate every row for anyone restoring onto a phone that already has data — a much worse failure, because it looks like it worked.

**Three details that decide whether any of this actually works:**

- The `.db` export **checkpoints the write-ahead log first**. Without that the copy is missing everything written since the last checkpoint, which on a phone usually means today. A backup that quietly loses the most recent day is worse than no backup, because it is trusted.
- The `.db` import **never overwrites the live database file underneath a running app** — that leaves every open handle pointing at freed pages. The chosen file is opened as a second database and its rows are copied across with `ATTACH`, so nothing has to be restarted and a bad file is rejected *before* anything is deleted.
- Automatic snapshots only ever delete files matching their own `auto-YYYYMMDD-HHMM.json` pattern, so a file you put in that folder yourself is never touched. That rule is a unit test, not a promise.

**Why snapshots are JSON rather than copies of the database.** Android Auto Backup copies the app's folder while the app may be mid-write, and a live SQLite file plus its WAL can be captured in an inconsistent state. A JSON snapshot written at a known-good moment cannot be.

**Receipt images stay on the phone, forever.** They are never uploaded anywhere, and the ZIP backup — `backup.json` plus a `receipts/` folder — is what carries them to a new phone. Scanning and the ZIP shipped in the same release, deliberately: a backup that restores transactions and loses their receipts is a bug, not a phase.

Each photo is shrunk to 1600px wide at 70% JPEG before it is kept, which turns a 4 MB camera file into roughly 200 KB. That is the difference between a backup you can send yourself over WhatsApp and one you cannot, and it is why the resize is not an optimisation to do later.

The weekly automatic snapshots stay JSON, **without** the images. The photos are already sitting in the same folder Android backs up; a second copy inside every snapshot would fill the phone to protect against nothing.

**The sync columns stay.** `id`, `updated_at`, `deleted_at`, `dirty` and the `outbox` table remain in the schema. They cost nothing now and they mean that if two devices in sync ever becomes worth building, it is additive rather than a migration.

### 4.3 No accounts — and how much that buys

You chose local-only, and it turned out to be right for more reasons than sync convenience:

- **No account-deletion page required.** Google only mandates it when the app offers account creation.
- **The Data safety form becomes nearly empty** — no data leaves the device at all. That is the fastest possible review, and it's a true claim you can put in the store listing.
- **The privacy policy becomes short and honest.** "Your data stays on your phone" is a real differentiator against every competitor.
- **Backup still works:** a single encrypted export file the user saves wherever they like — Drive, WhatsApp to themselves, a PC. Restore reads it back.

**And this is no longer a v1 shortcut — it is the product.** What it costs is real and worth naming rather than glossing: two phones cannot stay in sync, and a lost phone with no saved file and no Google backup is a lost history. §4.2 is the answer to that, and §5.2 is the accounting.

---

## 5. Technology choices

Versions verified on npm on 28 August 2026. Licences verified package by package.

### 5.1 The app

| Layer | Choice | Version | Why |
|---|---|---|---|
| Framework | **Expo SDK 52** with `expo prebuild` + local Gradle builds | `expo@52.0.49`, RN 0.76.9 | First-party modules for camera, SQLite, notifications, secure storage, biometrics and localization — six native integrations you don't wire yourself. **Chosen to match your other projects.** It targets API 34, and Play requires 36 for new apps since 31 Aug 2026 — irrelevant for Indus and your own phone, a blocker only when Play submission gets close. |
| Builds | **Local Gradle on your Windows machine** | — | Free and unlimited. `gradlew bundleRelease` gives the AAB for Play; `assembleRelease` gives the APK for Indus, GetApps and GitHub. See §5.4. |
| Navigation | **Expo Router** | `4.0.22` | File-based routes; deep links come free, which the widget and notifications need. |
| Database | **expo-sqlite** | `15.1.4` | First-party, zero config, no vendor. You're storing thousands of rows, not millions — one fewer native dependency is worth more than microseconds. |
| **Localization** | **expo-localization + i18next / react-i18next** | — | Device locale detection plus a manual language switch. All strings in `en.json` / `hi.json` from the first screen. Also gives correct **Indian digit grouping** (₹1,23,456 — not ₹123,456, which looks wrong to every Indian user) via `Intl.NumberFormat('en-IN')`. |
| Styling | **Nativewind 4** | `4.2.6` | Tailwind classes. Fast to build, easy to keep consistent. |
| Charts | **react-native-gifted-charts** | `1.4.78` | No Skia dependency — smaller APK, simpler builds. Donut, bar and line with sane defaults. |
| Lists | **FlashList 2** | `2.3.2` | The transaction list is the one screen that can get slow. |
| Camera + OCR | **react-native-vision-camera** + **@react-native-ml-kit/text-recognition** | `5.2.3` / `2.0.0` | ML Kit text recognition is free, on-device and offline. ~4 MB for the bundled Latin model. |
| Local state | **Zustand** | `5.0.15` | ~2 KB, no providers. Everything durable is in SQLite anyway. |
| Secure storage | **expo-secure-store** + **expo-local-authentication** | `15.0.2` | Keystore for secrets; fingerprint for the app lock. |
| SMS (non-Play builds) | **react-native-get-sms-android** | `2.1.0`, MIT | Behind a build flag, so the Play AAB never contains the permission. |
| Errors | **None — deliberately** | — | Crash reporting is a network call, and "nothing leaves the phone" stops being true the moment one exists. Play Console vitals cover crashes on Play builds without adding anything to the app. |

### 5.2 No server — and what that actually costs

You have a VPS and Postgres, and version 2.0 of this plan used them. On 3 September 2026 you asked the question that ended them: if backup and restore already work from files, what is the server *for*?

Close to nothing. So it is gone.

**What that removes from the build:** a NestJS codebase, a Docker container, a Postgres database and role, a subdomain and a certificate, an auth system with refresh-token rotation, an account-deletion page that Google Play requires the moment accounts exist, a deployment pipeline, and a nightly `pg_dump` that has to be copied off-site and test-restored. Each one is small. Together they are more work than the app.

**What it costs — plainly:**

| You give up | How much it hurts | What stands in for it |
|---|---|---|
| Two devices in sync | Real, if you ever use a tablet | Nothing does. You move a backup file by hand |
| Restore when there is no saved file *and* no Google backup | Real, and it is the sharp edge | Android Auto Backup is on and needs no user action; the automatic snapshots ride along inside it |
| A place to host the privacy policy | Trivial | A GitHub Pages file, or the site you already run |
| Server-side crash reports | Small | Play Console vitals, for Play builds |

**Your VPS is not wasted, it is just not in the critical path.** It can host the privacy policy and the APK downloads, which are static files. And `src/db/schema.ts` is Drizzle, which describes SQLite and Postgres from the same definitions — so if a server ever becomes worth building, the schema is already written and the sync columns are already in every table.

**One thing worth doing anyway:** restore one of your own backups onto a spare device or a fresh install, once, before you tell anyone else to rely on this. An untested backup is a rumour.

### 5.4 Building on Windows — the four things that will waste your evening

You're on `C:\Najmus\ReactApp\…`, so:

1. **Enable long paths** (`LongPathsEnabled` in the registry). Gradle and `node_modules` blow past 260 characters constantly. This is the single most common Windows RN failure.
2. **Never put the project in a OneDrive-synced folder.** It breaks Metro and Gradle reliably. `C:\Najmus\` is fine — keep it there.
3. **Pin JDK 17** and set `JAVA_HOME` explicitly. Don't rely on whatever Android Studio bundles.
4. **Exclude `node_modules` and `android\build` from Windows Defender**, or builds take two to three times longer. Set `org.gradle.jvmargs=-Xmx4096m` — the first New Architecture C++ compile can take 15–40 minutes on Windows and is much worse without headroom.

**Back up your keystore to two places today.** Lose it and you can never update the app again. Enrol in Play App Signing, which mitigates it on Play but not on Indus or direct APKs.

### 5.5 Licensing — clean

Every dependency above is **MIT, Apache-2.0, BSD, Unlicense, or the PostgreSQL licence**. Nothing copyleft ships inside your app.

- **Apache-2.0** components (Drizzle, Nest's deps) want a NOTICE file — trivial.
- **ML Kit** is proprietary but free to use commercially. Two obligations: don't reverse-engineer the models, and **disclose in your privacy policy that Google receives ML Kit performance metrics**.
- Ship a third-party licences screen — `npx license-checker` generates it.
- If you ever extend the stack, avoid: **Redis 8+** (AGPL now — use **Valkey**, BSD), MongoDB (SSPL), Elasticsearch (Elastic/SSPL), Terraform (BUSL — use **OpenTofu**).

---

## 6. Data model

Small on purpose. Drizzle generates the phone's SQLite tables from these definitions — and could generate Postgres tables from the same file if a server ever became worth building.

```sql
-- Every table carries these four columns. They are what makes sync work,
-- and they go in NOW even though there is no server to sync with.
--   id          TEXT/UUID   generated on the phone, never by the server
--   updated_at  INTEGER     epoch ms, set on every write
--   deleted_at  INTEGER     soft delete, so deletions reach other devices
--   dirty       INTEGER     1 = not yet pushed (phone only)

settings(key PRIMARY KEY, value)
   -- base_currency, language, first_day_of_month, lock_enabled, ...

accounts(id, name, type, opening_balance_minor, currency, icon, color,
         is_archived, sort_order, ...)
   -- type: cash | bank | card | upi | wallet
   -- currency is PER ACCOUNT — a rupee wallet and a dollar card coexist

categories(id, parent_id, name_key, custom_name, icon, color, kind,
           is_system, ...)
   -- name_key indexes into the translation files, so the seeded categories
   -- appear in Hindi for a Hindi user. custom_name overrides for user-made ones.

transactions(
  id, account_id, category_id,
  amount_minor       INTEGER NOT NULL,   -- integer minor units, NEVER a float
  currency           TEXT    NOT NULL,   -- the account's currency at entry time
  base_amount_minor  INTEGER NOT NULL,   -- converted to base_currency
  fx_rate            REAL,               -- rate used, stored so history never shifts
  kind               TEXT,               -- expense | income | transfer
  occurred_at        INTEGER NOT NULL,
  merchant           TEXT,
  merchant_key       TEXT,               -- normalized + uppercased, for matching
  note               TEXT,
  transfer_peer_id   TEXT,               -- other leg of a transfer
  receipt_path       TEXT,               -- local file path; images stay on device
  source             TEXT,               -- manual | sms | ocr | recurring | import
  category_source    TEXT,               -- user | rule | memory | suggested
  status             TEXT,               -- confirmed | inbox   (inbox = captured, unconfirmed)
  ...
)
   -- indexes on (occurred_at), (category_id, occurred_at), (merchant_key), (status)

transaction_splits(id, transaction_id, category_id, amount_minor, note, ...)

budgets(id, category_id NULL, period, amount_minor, currency, starts_on,
        rollover, ...)
   -- category_id NULL = the overall monthly budget

rules(id, priority, match_type, match_value, set_category_id, set_account_id, ...)
merchant_memory(merchant_key PRIMARY KEY, category_id, hit_count, last_used_at)
   -- the entire "it learns" feature, in one table

recurring(id, template_json, rrule, next_due_on, auto_post, ...)
fx_rates(base, quote, rate, fetched_at, PRIMARY KEY(base, quote))
   -- cached; refreshed opportunistically, works offline from the last cache
sms_templates(id, issuer, pattern, field_map_json, version, is_active)
   -- non-Play builds; shipped as data, so a new bank format is a JSON edit
outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, table_name, row_id, op, at)
```

**Five rules worth writing on the wall:**

1. **Money is an integer number of minor units — paise, cents. Never a float, never a `REAL` column.** `0.1 + 0.2` is exactly how expense trackers end up a rupee off, and users notice immediately.
2. **Store the FX rate on the transaction.** If you convert on the fly using today's rate, last year's reports change every time someone opens them. Capture the rate at entry time and history stays still.
3. **IDs are UUIDs generated on the phone.** No round-trip to save a row; no collisions when two devices sync later.
4. **Nothing is hard-deleted.** `deleted_at` is what lets a user undo today — and what would let deletions reach a second device if sync ever happened.
5. **Receipt images never leave the phone.** Local file path only. No object storage, no bandwidth, no privacy surface.

---

## 7. App structure

```
apps/mobile/
├─ app/
│  ├─ (tabs)/
│  │  ├─ index.tsx        Home — "₹8,240 left · 11 days" + rings + recent
│  │  ├─ history.tsx      FlashList of everything · search · month filter
│  │  ├─ add.tsx          KEYPAD FIRST. The most important screen in the app.
│  │  ├─ budget.tsx       Set and track monthly limits
│  │  └─ more.tsx         Accounts · categories · rules · backup · settings
│  ├─ inbox.tsx           Captured-but-unconfirmed items (SMS / OCR)
│  ├─ txn/[id].tsx        Edit · split · receipt · delete
│  ├─ scan.tsx            Camera → ML Kit → confirm screen
│  └─ _layout.tsx         Biometric gate · theme · i18n · first-run seed
├─ src/
│  ├─ db/                 schema, migrations, queries          ← Drizzle
│  ├─ i18n/               en.json · hi.json · formatters (₹1,23,456)
│  ├─ features/           one folder per feature; hooks only, no SQL in screens
│  ├─ domain/             money math, FX, budget pace, recurring dates — PURE
│  ├─ capture/            sms parser · ocr parser · rules engine — PURE
│  ├─ services/           files, lock, autoBackup, dbFile — thin native wrappers
│  └─ ui/                 buttons, keypad, rings, charts, list rows
├─ android/               generated by `expo prebuild`; committed
└─ widget/                home-screen widget (native)

On the phone at runtime:

files/backups/            auto-YYYYMMDD-HHMM.json — the last 5, inside Android's backup
files/receipts/           images — never uploaded, never leave the device
SQLite/expense.db         the source of truth
```

`domain/` and `capture/` are **pure functions with no React and no database**. Money arithmetic, FX conversion, budget pacing, recurring-date math and SMS parsing are exactly where bugs hurt and exactly what's easy to unit-test when nothing else is entangled with them. This is where the tests go.

### 7.1 The add screen, specified

This screen is the product. Everything else is reporting.

1. Opens with a **big numeric keypad**, cursor in the amount field, keyboard already up.
2. Above it, **recent-merchant chips** — one tap fills merchant, category and amount from last time.
3. Below, the **six most-used categories** as icon buttons. Tapping one saves and closes.
4. Date defaults to now, account to your last-used. Both one tap to change; most people never will.
5. Note, receipt, split and currency live behind a "More" disclosure. They exist; they're never in the way.
6. On save: a toast with **Undo**, and the keypad resets so you can log a second thing immediately.

**Measure it on a real device. Under 5 seconds, 3 taps.** If it creeps past that, cut something.

---

## 8. Build plan

One person, evenings and weekends. **Live on Indus in roughly 9–11 weeks**; Play a few weeks after that.

### Phase 1 — Skeleton (Week 1–2)
Expo project, `prebuild`, first signed APK on your own phone. SQLite + Drizzle schema + migrations, **with the four sync columns and the currency columns from the start**. i18n scaffolding with `en.json` and `hi.json` wired before any string is hardcoded. `domain/money` and `domain/fx` with tests. Tab navigation with empty screens.
**Done when:** you install a signed APK on your phone from `gradlew`.

### Phase 2 — The core loop (Week 3–5)
Add screen with the keypad. Categories (seeded, translated). Accounts with per-account currency. Transaction list on FlashList. Edit and delete. Home screen with the "left this month" number.
**Done when:** you've used it yourself for a full week and stopped reaching for anything else.

### Phase 3 — Budgets and understanding (Week 6–7)
Budgets per category with pace. The three charts. Month navigation. Search and filters. Indian digit grouping everywhere.
**Done when:** the home screen answers "am I okay this month?" without you thinking.

### Phase 4 — Less typing (Week 8–9)
Rules engine and merchant memory. Recurring transactions. Receipt scan with ML Kit and the confirm screen. The inbox. Home-screen widget. Quick-add notification. Local reminders.
**Done when:** most entries are one or two taps, not six.

### Phase 5 — SMS + ship it (Week 10–11)
`sms_templates` engine and the on-device parser, tested against your own real inbox, behind the build flag. Backup and restore in all four layers of §4.2, plus CSV export. Biometric lock. Icon, screenshots, store listing, and the privacy policy on a static page.
**→ Publish to Indus Appstore (24–72h review) and GitHub Releases. You are live.**

### Phase 6 — Play, in parallel (Week 10 onward)
Recruit 15–18 testers while Phase 5 is finishing. Play build without SMS. Data safety form, content rating. Internal test, then the 14-day closed test, shipping two or three real updates during it. Apply for production access with substantive answers about what testers said and what you changed.
**Done when:** it's live on Play too.

### Phase 7 — Receipts, and the backup they travel in ✅ done
Camera and gallery capture, on-device ML Kit OCR, and a parser that pulls the total, the date and the shop name off the text. Images shrunk and stored under `documentDirectory/receipts/`, never uploaded. The backup upgraded to a ZIP containing `backup.json` plus those images, and the restore taught to unpack it. **Shipped in one release**, because a backup that restores transactions and drops their receipts is worse than one that never had them.

**Nothing a scan finds is written without you seeing it.** The confirm screen also says *where* each number came from — "the line marked TOTAL" is a different level of confidence from "the largest number on the bill", and the user is told which one they are looking at.

**Open:** the OCR library bundles five script models (Latin, Devanagari, Chinese, Japanese, Korean) and only two are any use in India. Measure the release APK; if the growth is unacceptable, patch the four unused scripts out of the library with `patch-package` — one Gradle file and one Java file.

---

## 9. Risks

| Risk | Likelihood | What to do |
|---|---|---|
| **Scope creep kills momentum** | The most likely failure of all | §3.1 is the whole of v1. Every new idea goes on the v2 list, not into the build. |
| **Closed testing stalls** | Moderate — but you're no longer blocked by it | Indus and GitHub carry the launch. Recruit 15–18 for Play so attrition doesn't drop you under 12. |
| **SMS declaration denied on Play** | Likely first time | Already assumed. The non-Play builds have SMS regardless; the app never depends on it. |
| **A phone is lost with no backup** | Low, total for that user | Android Auto Backup is on and needs no action. The Backup screen makes saving a file one tap, and offers two formats. **Restore one of your own backups once, now** — an untested backup is a rumour. |
| **You lose the keystore** | Low, catastrophic | Two backups today. Play App Signing for the Play build. |
| **Windows build pain** | Moderate | §5.4 covers the four common ones. Budget a frustrating day in Phase 1 and don't take it personally. |
| **A scan reads the wrong number** | Certain, occasionally | Nothing is saved without confirmation, and the screen says how confident the guess is. The parser's rules are unit-tested against real receipt shapes. |
| **Hindi translation quality** | Moderate | Financial words are where machine translation goes wrong ("balance", "credit", "due"). Get a native speaker to read the 60 strings that matter before launch. |
| **Play account closed for inactivity** | Real, and the $25 isn't refunded | Calendar reminder every five months. |

---

## 10. Open items

Everything you've decided is now in the plan: no server, local-only, backups in four layers with two file formats, receipts kept on the device forever, multi-currency and Hindi from the start, Expo SDK 52, and Indus-first distribution. Four small things left, none of which block anything:

1. **Base currency default** — INR, or detect from the device locale? *(I'd detect, and default to INR when the locale is Indian.)*
2. **FX rates** — I plan to fetch them from a free public endpoint occasionally and cache them, so the app works offline and history never shifts. If you'd rather have no network calls at all in v1, users can enter rates manually and it still works.
3. **App name and package id.** The package id is permanent once published — `com.najmus.expensetracker` or whatever you prefer, but decide it in Phase 1, not Phase 5.
4. **Automatic backups start switched off.** You asked for a switch rather than something that just happens, so off is the default. If you would rather every user got the protection without having to find the setting, say so — it is one constant in `src/services/autoBackup.ts`.

Phases 1 through 5a are built and running on your phone. What remains is §8 Phase 5 (SMS, reminders), Phase 6 (Play), and Phase 7 (receipts + the ZIP backup).

---

## Sources

**Google Play and distribution:** [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) · [Choose a developer account type](https://support.google.com/googleplay/android-developer/answer/13634885?hl=en) · [Required information to create an account](https://support.google.com/googleplay/android-developer/answer/13628312?hl=en) · [Keeping developer account information up to date](https://support.google.com/googleplay/android-developer/answer/13634888?hl=en) · [Developer verification: required documents — India](https://support.google.com/googleplay/android-developer/answer/15633622?hl=en&co=GENIE.CountryCode%3DIN) · [Policy announcement, April 2026](https://support.google.com/googleplay/android-developer/answer/16926792?hl=en) · [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en) · [Use of SMS or Call Log permission groups](https://support.google.com/googleplay/android-developer/answer/10208820?hl=en) · [Preview: SMS/Call Log policy effective Jan 2027](https://support.google.com/googleplay/android-developer/answer/17225965?hl=en) · [Declare permissions for your app](https://support.google.com/googleplay/android-developer/answer/9214102?hl=en) · [App account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) · [Understanding Android developer verification](https://support.google.com/android-developer-console/answer/16561738?hl=en) · [Register for limited distribution](https://developer.android.com/developer-verification/guides/limited-distribution) · [Bluecoins on losing SMS permissions](https://www.bluecoinsapp.com/google-policy-removing-sms-permissions/)

**Alternative stores:** [Indus Appstore — how to publish](https://developer.indusappstore.com/docs/how-to-publish-app-on-indusappstore) · [Indus developer signup](https://developer.indusappstore.com/signup) · [PhonePe — Indus developer platform launch](https://www.phonepe.com/press/phonepe-announces-the-launch-of-the-indus-appstore-developer-platform/) · [Xiaomi Mi Developer registration](https://global.developer.mi.com/document?doc=accountRegistration.becomeADeveloper) · [F-Droid Inclusion Policy](https://f-droid.org/en/docs/Inclusion_Policy/) · [Samsung Galaxy Store — get started](https://developer.samsung.com/galaxy-store/prepare.html)

**India business registration:** [D&B India — get a D-U-N-S number](https://www.dnb.co.in/duns/get-a-duns) · [Udyam Registration portal](https://udyamregistration.gov.in/)

**Technical:** [Expo SDK 52](https://expo.dev/changelog/sdk-52) · [React Native releases](https://reactnative.dev/releases/overview) · [ML Kit text recognition (Android)](https://developers.google.com/ml-kit/vision/text-recognition/v2/android) · [ML Kit terms](https://developers.google.com/ml-kit/terms) · [Gemini API additional terms — unpaid tier data use](https://ai.google.dev/gemini-api/terms) · [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

*Package licences were verified individually against the npm registry on 28 August 2026, and version numbers checked live the same day. Items marked ⚠️ are genuinely uncertain — re-confirm before relying on them, since platform terms move.*
