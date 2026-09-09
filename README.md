# Daily Expense Tracker

A free, offline-first Android expense tracker. All data lives on the phone.

- **Package id:** `com.mma.expensetracker` (permanent once published — do not change it)
- **Platform:** Android only · **Expo SDK 52** (matching your other projects)
- **Plan:** [`docs/PLAN.md`](docs/PLAN.md)
- **Phase:** 6 of 7 — dashboard home, bill scanning with on-device OCR, backup in four layers and three formats, app lock
- **No server.** No accounts, no analytics, no sync. Your data never leaves the phone — see *One honest exception* below

---

## Getting it running on Windows

You need **Node 24**, **JDK 17**, and **Android Studio** (for the SDK and an emulator or ADB).

```powershell
npm install
npx expo install --fix      # aligns every expo-* package to SDK 52
npm test                    # 191 tests, should all pass
npm run typecheck           # should print nothing
npx expo export --platform android --clear   # proves the whole app bundles
npx expo prebuild --platform android
npx expo run:android        # builds and installs on a connected device
```

`npm install`, `npm test` and `npm run typecheck` have been run against this
exact `package.json` and source, so if any of them fails it is your environment
(Node version, npm cache, corporate proxy), not the code — say so and it can be
fixed.

**If you change `babel.config.js`, clear the cache.** Metro caches transforms
aggressively and will keep using the old Babel config, which surfaces as errors
that make no sense against the code in front of you. Any of
`npx expo start --clear`, `npx expo export --clear`, or deleting
`node_modules/.cache` and `.expo` will do it.

**Two things to know about staying on SDK 52.**

1. **Google Play needs target API 36 for new apps** (since 31 Aug 2026), and
   SDK 52 prebuilds at `targetSdkVersion 34`. This is handled: `app.json`
   overrides compile/target to **36** via `expo-build-properties`, and
   `plugins/withSuppressUnsupportedCompileSdk.js` adds the flag that lets
   AGP 8.6 — which RN 0.76 pins, and which only knows about SDK 35 — build
   against a platform it has never heard of.

   The generated `gradle.properties` has been verified to carry all four
   values. What has **not** been verified is that AGP 8.6 compiles cleanly
   against platform 36 on a real machine; if Gradle objects, the fallback is
   moving to a newer Expo SDK. Delete the local plugin the moment you do.
2. **The New Architecture is off** on SDK 52 (`newArchEnabled=false`). Nothing in
   the app needs it today. It matters only if a future dependency requires it —
   FlashList v2 is the one on our roadmap that does.


Once `prebuild` has generated the `android/` folder, later builds can skip it:

```powershell
npm run build:apk           # android\app\build\outputs\apk\release\app-release.apk
npm run build:aab           # the bundle Google Play wants
```

### Four Windows problems worth heading off

These cause most first-build failures on Windows, and none of them are your fault.

1. **Enable long paths.** Gradle and `node_modules` blow past the 260-character limit constantly.
   ```powershell
   # Run as Administrator, then restart:
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
     -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```
2. **Do not move this project into OneDrive.** It breaks Metro and Gradle reliably. `C:\Najmus\` is fine.
3. **Pin JDK 17 explicitly.** Set `JAVA_HOME` yourself rather than relying on whatever Android Studio bundles.
4. **Exclude the project from Windows Defender** (`node_modules` and `android\build` especially), or builds take two to three times longer. The first New Architecture C++ compile can take 15–40 minutes; add this to `android/gradle.properties` after prebuild:
   ```properties
   org.gradle.jvmargs=-Xmx4096m
   org.gradle.daemon=true
   org.gradle.caching=true
   ```

### Signing — do this before you ship anything

```powershell
keytool -genkeypair -v -keystore expense-tracker.keystore -alias expense `
  -keyalg RSA -keysize 2048 -validity 10000
```

Put the passwords in `%USERPROFILE%\.gradle\gradle.properties`, **never in this repo** (`.gitignore` already blocks `*.keystore`).

**Back the keystore up to two places today.** If you lose it, you can never publish an update to the same app again.

---

## Layout

```
app/                    Screens. expo-router turns this folder into navigation.
  (tabs)/
    index.tsx           Home — the dashboard: left to spend, in vs out,
                        budgets at risk, where it went, day by day
    add.tsx             The keypad. The most important screen in the app.
    history.tsx         The month's ledger, grouped by day, searchable
    budget.tsx          Monthly budget, overall and per category, with pace
    more.tsx            Settings, and the way into everything below
  txn/[id].tsx          Edit or delete one transaction
  accounts.tsx          Cash, bank, cards, UPI — each with its own currency
  categories.tsx        Add your own, hide the ones you don't use
  reports.tsx           Where it went, day by day, month on month
  rules.tsx             "Anything from SWIGGY is Food"
  recurring.tsx         Rent, EMIs, subscriptions
  inbox.tsx             Captured automatically, waiting for one tap
  backup.tsx            CSV, ZIP, JSON and .db backup, restore, auto-backup switch
  scan.tsx              Photograph a bill → OCR → check → save

src/
  db/
    schema.ts           ONE definition of every table
    backupZip.ts        The ZIP backup — data plus the receipt photos
    client.ts           Opens the database
    seed.ts             Default categories and account on first run
    queries.ts          Every read and write the screens use
  domain/               PURE functions — no React, no database. This is where the tests are.
    money.ts            Integer minor units. Never a float.
    budget.ts           Month bounds and budget pace
    merchant.ts         Turns bank descriptors into a stable merchant key
    dates.ts            Calendar maths — month grids, relative days, DST-safe
    report.ts           Ranking, folding the tail, series buckets, change %
    rules.ts            Rule matching, first-match-wins, safe regex
    recurrence.ts       An RRULE subset — parse, next occurrence, catch-up
    csv.ts              RFC 4180 encode/parse, with a BOM so Excel reads Hindi
    backupSchedule.ts   When a backup is due, and which old ones to delete
    receipt.ts          Reading a total, a date and a shop name off OCR text
  i18n/                 English and Hindi, no library
  theme/                Colours, spacing, type scale
  services/             Thin wrappers over native modules
    files.ts            Write, share and pick files
    lock.ts             Fingerprint / screen-lock gate
    autoBackup.ts       Weekly snapshots into the app's own folder, pruned to 5
    dbFile.ts           Export and import the SQLite file itself
    ocr.ts              On-device text recognition (ML Kit), loaded defensively
    receipts.ts         Taking, shrinking and storing bill photos
  ui/                   Shared components — Screen, Card, ListRow, Chip, Sheet
    charts.tsx          Ranked bars, columns, meters, summary tiles — plain Views

plugins/                Local Expo config plugins — one, for the SDK 36 override
drizzle/                Generated SQL migrations — commit these
docs/PLAN.md            The full product and technical plan
```

### Five rules the code enforces

1. **Money is an integer number of paise.** Never a float, never a `REAL` column. `0.1 + 0.2` is exactly how expense trackers end up a rupee off.
2. **Every row carries `id`, `updated_at`, `deleted_at`, `dirty`.** There is no server, and the columns cost nothing — if sync ever becomes worth building it is additive rather than a migration.
3. **Nothing is hard-deleted.** `deleted_at` is set instead.
4. **IDs are UUIDs generated on the phone.** No server round-trip to save a row.
5. **Nothing the app records for you is written silently.** Anything captured automatically lands in the inbox for one tap. That rule is the whole basis for trusting an app that types on your behalf.

---

## Changing the database

```powershell
# 1. edit src/db/schema.ts
npm run db:generate      # writes a new migration into drizzle/
# 2. commit both the schema change and the generated files
```

Migrations run automatically on app start (`app/_layout.tsx`).

---

## Tests

```powershell
npm test
```

Covers the domain layer only — money arithmetic, budget pacing, merchant normalization, calendar maths, report aggregation, rule matching, recurrence and CSV. That is deliberate: these are the places where a bug costs a user real trust, and they are pure functions, so the tests are fast and there is no transform pipeline to break. Screen tests can come later; they are worth far less than these.

---

## Two deliberate deviations from the plan

Both exist to keep the Windows build simple. Both are easy to change later, and neither affects the data model.

- **Plain `StyleSheet` instead of NativeWind.** Every colour and size is already a token in `src/theme`, so moving to NativeWind is mechanical rather than a rewrite.
- **Charts drawn with plain Views, not a charting library.** Both questions the app answers are about magnitude, which reads best from a common baseline — so ranked bars and columns, single-series, every row labelled. No SVG, no categorical palette, and therefore no colour-blindness problem to mitigate.
- **A 40-line `t()` instead of i18next.** Two languages with simple interpolation is all this needs, and it removes a dependency whose version has to stay aligned with the Expo SDK. If pluralization gets complicated, i18next can replace it without touching a single call site.

---

## How your data survives a new phone

There is no server and no account, so this is worth understanding rather than assuming.

| Layer | Saves you from | Needs you to remember anything? |
|---|---|---|
| **Android Auto Backup** (on) | New phone, factory reset, accidental uninstall | No — Google copies the app's folder to your Drive |
| **Automatic snapshots** (a switch, **off** by default) | Corruption, a bad import, deleting a month by mistake | Turn it on once. Weekly, last 5 kept, inside the app's folder |
| **Save a backup file** — `.zip`, `.json` or `.db` | Everything, including uninstalling | Yes — and that's the point. It goes where you choose |
| **CSV export** | Nothing; it's for a spreadsheet | — |

**Three formats, each for a different fear.** The **ZIP** is the complete one — `backup.json` plus a `receipts/` folder — and it is the one to keep, because it is the only one that carries your bill photos. The **JSON** is readable in a text editor in ten years, for when the thing you distrust is this app. The **.db** is a byte-for-byte copy of the database, for when the thing you distrust is the JSON writer. Formats that fail in different ways is the whole reason to carry more than one.

**Automatic snapshots stay JSON, without the photos.** The photos are already on the phone in the same folder Android backs up, so putting a second copy of every image inside every weekly snapshot would fill the phone to protect against nothing.

Three things the code does that are easy to get wrong:

- The `.db` export **checkpoints the WAL first**, so the copy isn't missing everything written today.
- The `.db` import **doesn't overwrite the live database file** underneath a running app. It opens the chosen file as a second database and copies rows across with `ATTACH` — so nothing needs restarting, and a bad file is rejected *before* anything is deleted.
- Automatic snapshots only ever delete files matching their own `auto-YYYYMMDD-HHMM.json` pattern. Your own file in that folder is never touched. That's a unit test, not a promise.

**Restoring replaces everything.** It warns first. A restore that merged would silently duplicate every row for anyone restoring onto a phone that already has data.

**Restore one of your own backups once, before you rely on it.** An untested backup is a rumour.

---

## Scanning a bill

Add tab → **Scan**, or open any transaction and attach a photo there.

Photograph the bill; the amount, the date and the shop name are read on the
device and put in front of you to **check before saving**. Nothing a scan finds
is ever written to your ledger without you seeing it — OCR is a guess, and an
app that quietly records guesses is an app whose numbers you stop believing.

The screen says where each number came from. "Taken from the line marked TOTAL"
is a different level of confidence from "nothing said TOTAL, so this is the
largest number on the bill", and you should be told which one you are looking
at.

**What it does with the photo.** Shrinks it to 1600px wide as a 70% JPEG —
around 150–250 KB instead of 4 MB — and keeps it in the app's own private
folder. Only the file name goes in the database, so a restore that moves the
app's folder does not break every image.

**The category is guessed too**, from three sources in order of how much they
deserve to be trusted: a rule you wrote, then what the app learned the last time
you corrected that shop, and only then the words on the bill (`PHARMACY` → Health,
`INDIAN OIL` → Fuel, `SUPERMARKET` → Groceries). The weakest source never
overwrites a stronger one, and when nothing matches the category is simply left
unchosen — one tap — rather than filing a chemist's bill under Entertainment.

**The parsing rules are in `src/domain/receipt.ts` and they are all tested.**
It prefers a line saying GRAND TOTAL over one saying TOTAL over one saying
AMOUNT; it throws away SUB TOTAL, CASH, CHANGE, GST and TAX lines; it ignores
invoice numbers, phone numbers and times when hunting for figures; it reads
dates day-first, the way an Indian till prints them, and refuses any date in
the future or more than three years old. If it cannot find something it returns
nothing rather than a guess.

**It needs a real rebuild**, not a Metro reload — ML Kit and the image picker
are native. `npx expo prebuild --platform android && npx expo run:android`.

**Watch the APK size on your first release build.** The OCR library bundles
five script models — Latin, Devanagari, Chinese, Japanese and Korean — and only
the first two are any use to you. Run `npm run build:apk` and look at the file.
If it has grown more than you want to ship, say so and the four unused scripts
can be patched out; it is a change to one Gradle file and one Java file in the
library, applied with `patch-package`.

---

## What is not here yet

**Still to come**

- SMS auto-capture — the non-Play builds only (see `docs/PLAN.md` §2.5)
- Reminders — a daily nudge, and an alert when a budget is nearly gone
- Home-screen widget and a quick-add notification
- Store listing, privacy policy, and the Indus Appstore submission

**On the app lock:** it hides the app behind a fingerprint. It does *not*
encrypt the database on disk. Anyone with physical access and developer tools
could still read it. Saying so plainly is deliberate — a lock that implies more
than it delivers is worse than none.

**Privacy:** no accounts, no analytics, no sync, and your data — including every bill photo — never leaves the phone.

**One honest exception.** The bill scanner uses Google's ML Kit. The photo is read entirely on the device and is never uploaded, but the ML Kit library itself reports usage diagnostics to Google. That is a condition of using it, it cannot be turned off, and **it has to be disclosed in the privacy policy** before you publish. It is the only thing in the app that touches the network. If you would rather have nothing at all, the scanner is the one feature to drop — everything else stays true.
