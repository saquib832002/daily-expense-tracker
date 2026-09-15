# What this app could do next

Everything here fits the three rules the project has had from the start: no
recurring cost, no server, and nothing leaves the phone except a backup to the
user's own Drive. Anything that breaks one of those is marked **blocked** and
says why, because a roadmap that quietly includes impossible items is worse
than a short one.

Effort is in solo-developer days, assuming the existing architecture. Value is
a judgement, not a measurement.

---

## The order I would build them in

| # | Feature | Why it's first | Effort |
|---|---|---|---|
| 1 | Home-screen widget + quick add | Retention. Nothing else matters if they stop opening it | 4–6 d |
| 2 | Financial-year support (Apr–Mar) | India's year does not start in January. Almost no competitor gets this right | 1–2 d |
| 3 | Year-end statement (PDF + Excel) | Concrete, seasonal, sellable | 2–3 d |
| 4 | Shared household ledger | The one paid feature in this category that needs no server | 8–12 d |
| 5 | Encrypted backup | The privacy promise, finished | 2 d |

The rest is grouped by what it's for.

---

## A. Getting used every day

The failure mode of every manual expense tracker is week two. The user does not
decide to stop; logging just becomes one tap too many. Everything in this group
attacks that, and it is worth more than any feature in any other group.

**Home-screen widget.** Today's spend and a button that opens straight into the
amount field. Expo has no widget API, so this is a native Android AppWidget —
either hand-written in `modules/` alongside `google-drive-auth`, or via
`react-native-android-widget`. The most expensive item here and still the one
I would build first.

**App-icon shortcuts.** Long-press the icon → *Add expense*, *Scan bill*. Two
hours with `expo-quick-actions`, and it removes a whole screen from the path.

**Quick Settings tile.** Pull down the notification shade, tap, log. Native,
small, and beloved by the people who use it.

**Repeat last expense.** One tap to re-enter the same amount, shop and
category. A huge fraction of real spending is the same chai, the same auto
fare, the same lunch.

**Voice entry.** *"Two hundred fifty on groceries."* Android's on-device
`SpeechRecognizer` is free and needs no network. Parsing is the same problem
the receipt parser already solves, on easier input.

## B. Typing less

**Notification capture.** Read the bank and UPI alerts Android already shows,
extract the amount and merchant, and offer them in the inbox for one-tap
confirmation. This is the single biggest reduction in typing available, and it
is how most Indian expense apps actually work.

> **Policy caveat, and it is a real one.** This needs
> `NotificationListenerService`, which Play treats as a sensitive permission
> requiring a declared core use case and review. It is approvable for a
> finance app whose core function is expense capture, but plan for a rejection
> and an appeal. Do NOT reach for `READ_SMS` instead — Play restricts it to
> default SMS handlers, and it will be refused.

**Finish the receipt categoriser.** Tasks 26–30 in the plan — item lexicon,
isolating the item region, confidence scoring, showing the reasoning. The
scanner reads the total today; reading the *lines* is what makes it feel smart.

**Share-sheet capture.** Share a payment screenshot from any app into this one
and have it parsed. No new permission, reuses the OCR that exists.

**Import from other apps.** CSV import mapped from Money Manager, Wallet and
Monefy exports. Removes the main reason someone abandons a switch — losing
three years of history.

## C. Making sense of the money

**Month-end forecast.** *"At this rate you'll finish the month at ₹47,000 —
₹4,000 over."* Arithmetic on data already in the database, and far more
useful than another pie chart.

**Subscription detection.** Scan history for repeating amounts and surface
them: *"₹499 to Netflix every month since March — ₹3,493 so far."* Nobody
asks for this and everybody reacts to it.

**Merchant insights.** Spend by shop, not just by category. *"₹4,200 at
Swiggy this month"* lands harder than *"₹6,800 on Food."*

**Savings goals.** A target, a date, and progress drawn from what is actually
left over each month.

**Net worth.** Manual assets and liabilities — a house, a car, a loan, gold.
Simple, static, and the reason some people open a finance app at all.

**Debt and EMI schedules.** Principal, rate, tenure, and what each payment
actually buys down. Recurring bills already model the payment; this models the
loan behind it.

**Calendar heatmap.** A month grid, darker where more was spent. Cheap to
build, immediately readable, good screenshot material for the store listing.

## D. Built for where the users are

**Financial year (April–March).** Every report, budget and export currently
assumes a calendar year. In India the financial year runs April to March, and
a year-end summary that stops on 31 December is useless for tax. A setting, a
migration of the date maths, and it is done — and it is a genuine competitive
gap, because most international apps never bother.

**Festival and occasion budgets.** A budget scoped to *Diwali*, *Eid*, a
wedding — spanning arbitrary dates rather than a month, with its own total.
This is how a lot of household spending is actually planned, and no mainstream
tracker models it.

**Cash reconciliation.** *"You should have ₹2,300 in your wallet. How much is
actually there?"* — and log the difference. Cash-heavy users lose the thread
within a week without this.

**Split with friends.** The Splitwise-style feature in
`docs/sharing-feasibility.md`. Feasible over Drive, but it is the largest item
on this page and the only one whose complexity is in the sync, not the screens.

## E. Worth paying for

These are the candidates for a one-time unlock. See `docs/monetisation.md`
reasoning if it exists; the short version is that a one-time ₹299–499 fits an
app with no running costs far better than a subscription.

**Shared household ledger.** Two phones, one Drive folder, one set of
expenses. Couples and families. This is what competitors charge ₹2,000 a year
for, and it needs no server because it rides the backup you already built.

**Multi-device for one person.** The same machinery, phone plus tablet.

**Year-end statement.** One button, a formatted PDF and an Excel workbook of
the whole year by category and month. People who would never buy "premium"
buy this in March.

**Encrypted backup.** A passphrase, and the Drive archive becomes unreadable
to anyone — including anyone who gets into the Google account. The app's
privacy claim is strong everywhere except the one place the data leaves the
phone. This closes it.

**The vault, sold properly.** Warranties, receipt photos and loyalty cards are
already built and no mainstream competitor bundles them. This is less a
feature to add than a feature to *stop giving away* — and the sharpest line in
the store listing you are not currently using.

## F. Polish

Cheap, and they are what reviews mention: themes and accent colours, an
alternative app icon, tags alongside categories, attachments beyond receipt
photos, natural-language search (*"food last march"*), per-account hiding, and
a proper empty state for a brand-new install.

---

## Blocked, and why

**Bank account syncing.** Needs an aggregator — Plaid, Salt Edge, an Account
Aggregator licence in India — all of which charge monthly, and a server to
hold the tokens. It is the feature most paid tiers are built on, and it is
the one this app cannot have. Worth saying plainly in the listing rather than
collecting the one-star reviews.

**SMS transaction parsing.** `READ_SMS` is restricted by Play to default SMS
handlers. Notification capture (B) is the supported route to the same result.

**Live investment or crypto prices.** Every free tier of every market data API
either expires or rate-limits into uselessness. The currency converter works
because daily FX rates are genuinely published free; share prices are not.

**Cloud sync of the ledger itself.** Not Drive backup — real-time sync across
users through a server. That is a monthly bill and an operational
responsibility. The shared-ledger design deliberately avoids it.
