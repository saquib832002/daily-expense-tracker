# Splitting bills with friends — is it possible from here?

A feasibility study, not a plan to build. Nothing here is implemented.

**Short answer: yes, and there are three ways to do it. They are not equally
good, and the one that looks most natural for this app — sharing through Google
Drive — is the one I would not build.**

---

## 1. How your data is stored and shared today

Worth being precise, because the whole question turns on it.

| Where | What is there | Who can read it |
|---|---|---|
| **The phone** | `expense.db`, a SQLite file in the app's private folder, plus bill photos in `receipts/` | Only this app, on this phone |
| **Android Auto Backup** | A copy of the database, taken by the OS | Only the same app on the same user's account, at restore time |
| **Google Drive** | A ZIP the app writes into an *Expense Tracker Backups* folder it created | The account that owns it. The app sees only what it created |

There is **no server anywhere**. Nothing of yours runs between two users, and
two installs of this app have never exchanged a byte.

The critical detail is the OAuth scope. The app holds exactly one:

```
https://www.googleapis.com/auth/drive.file
```

Google defines it as access to *"files that you open with an app or that the
user shares with an app while using the Google Picker API"*. So the app can see
what it made, and nothing else — and that is the property that keeps this app
free to publish. The scopes that would let it roam someone's Drive (`drive`,
`drive.readonly`, `drive.metadata`) are **restricted**: they need a verification
review, and a third-party security assessment if the data touches a server.
That assessment is the thousands-of-dollars item this project has been designed
around from day one.

---

## 2. What Splitwise actually requires

Strip the feature to its mechanics and it needs four things this app has never
needed:

1. **Shared mutable state.** One ledger that several phones write to.
2. **Identity.** "Najmus owes Ali ₹450" requires a stable idea of who Ali is.
3. **Invitation.** A way for Ali to join a group he did not create.
4. **Convergence.** Two people adding expenses on a train with no signal must
   not overwrite each other.

Numbers 1 and 4 are the hard ones. Everything else follows from where you put
the shared state.

---

## 3. Option A — share a file in Drive (no server)

### Is it technically possible?

**Yes**, and more so than I expected before checking. Two facts make it work:

- `permissions.create` — the Drive call that shares a file with another
  person's email — **accepts the `drive.file` scope**. The app can share a file
  it created without any new permission.
- The `drive.file` scope covers files *"the user shares with an app while using
  the Google Picker"*. So the friend's copy of the app can be granted access to
  one specific file, by that friend, without any broad scope either.

### How it would work

```
Najmus creates "Goa Trip"
   → app writes goa-trip.json into his Drive (drive.file: it created it)
   → app calls permissions.create, sharing it with ali@gmail.com
   → Ali gets Google's "Najmus shared a file with you" email

Ali opens the app → Join a group
   → app opens the Google Picker in the system browser
   → Ali picks goa-trip.json
   → Ali's app now has drive.file access to that one file, forever
   → both apps read and write it on open
```

### The concurrency problem, and its fix

Two phones writing one JSON file will clobber each other. The standard fix is
to never share a writable file at all: give **each member their own file**, which
only they write and everyone reads. The group's ledger is the union of them.
Expenses are immutable facts with ids, so the union needs no merge logic and no
clock — it is an append-only event log per person, which is as close to a CRDT
as this problem needs.

### Why I would not build it anyway

Not because it cannot work, but because of the **invite flow**, and the maths of
it are brutal. If every member writes their own file and everyone must read
everyone's, then in a group of five people each member has to pick four files
through a browser-based picker, one at a time. That is twenty separate picker
journeys for one trip to Goa. And every new member added later means another
round for everybody.

Four more things rank as real, in descending order of how much they would hurt:

- **No push, no realtime.** Nothing of yours runs in the background, so a
  friend's expense appears when you next open the app. Splitwise's whole feel
  is that it is there before you mention it.
- **The Picker on Android is a browser round trip.** Google's documentation is
  explicit that mobile apps use the browser flow and that embedded webviews are
  no longer supported. So joining a group means leaving the app, signing in,
  picking a file, coming back.
- **The data is visible and editable outside the app.** The group file sits in
  each member's Drive. Anyone can open it in a text editor and change what they
  owe. For friends splitting a holiday this is probably fine; it is worth
  knowing it is true.
- **One unverified assumption.** Whether picking a *folder* grants access to the
  files inside it — which would cut the N×N problem down — I could not confirm,
  and it would need a real experiment before anyone relied on it.

**Verdict: possible, free, and clever. But the joining experience is bad enough
that people would not get past it, and a sharing feature nobody completes the
setup for is worse than no sharing feature.**

---

## 4. Option B — Firebase Firestore (a real backend, still free)

### The numbers

Firebase's no-cost **Spark** plan, which needs **no payment method at all**:

| | Included free, per day |
|---|---|
| Document reads | 50,000 |
| Document writes | 20,000 |
| Deletes | 20,000 |
| Stored data | 1 GiB total |
| Network egress | 10 GiB/month |
| Authentication | standard sign-in included; 50K monthly active users with Identity Platform |

To put that in proportion: a group expense is one write. Fifty thousand reads a
day is roughly *a thousand people* opening the app five times each and pulling
ten items per open. You would be far past needing a paywall before you were
near the ceiling. Note that Cloud Functions and Cloud Storage are **not** on
Spark — so the design has to be client-only, which for this feature it can be.

### How it would work

- Firebase Auth with Google sign-in — which this app **already has**, and which
  already produces the identity and the account the feature needs.
- One `groups/{id}` document per group, and `groups/{id}/expenses/{id}` beneath
  it. Security rules restrict both to the member list.
- Invitations by **short code or link** — the flow everyone already understands.
  Ali taps the link, signs in with Google, he is in. No Picker, no browser
  detour, no N×N.
- Firestore's offline persistence handles the train-with-no-signal case, and
  real-time listeners give the "it is already there" feel.

### What it would cost you that is not money

This is the part that deserves a straight answer, because it changes what this
app *is*:

- **Data leaves the device.** Today the store listing can say every expense
  stays on the phone. The moment a shared group exists, the expenses inside it
  live on Google's servers under **your** project — and you become the data
  controller for other people's spending.
- **Play data safety and the privacy policy change**, and so does the account
  deletion question a reviewer already had reason to ask once you made sign-in
  mandatory. Shared data means a real deletion path, not a hand-wave.
- **India's DPDP Act and the GDPR now apply to you**, not to Google. A solo
  developer holding other people's financial data has obligations — breach
  notification among them.
- **Abuse becomes your problem.** Invite links get shared; someone will add a
  stranger to a group, or use group names as a message board.

None of that is a reason not to do it. It is a reason to do it deliberately,
with the personal ledger staying exactly where it is: **on the phone**. Only
data explicitly put into a shared group should ever cross the wire.

---

## 5. Option C — split locally, settle socially (no sync at all)

The option that gets skipped, and the one I would ship first.

Record who an expense was split with, and how. Keep it entirely on the phone.
Show a running balance per person. Then let the user **send** the result — a
WhatsApp message, an image, a PDF:

> **Goa Trip — 12 expenses, ₹18,400**
> Najmus paid ₹11,200 · Ali paid ₹4,900 · Zoya paid ₹2,300
> **Ali owes Najmus ₹1,233 · Zoya owes Najmus ₹3,833**

No accounts, no invitations, no server, no policy change, no new scope — and,
in India, the settlement happens over UPI in about nine seconds regardless of
what any app thinks.

**This covers most of what people actually use Splitwise for.** The gap is
real — the other person cannot add their own expenses, and there is no shared
truth — but it is a gap you can ship this month and measure demand against,
rather than guessing.

---

## 6. Side by side

| | A · Drive file | B · Firestore | C · Local + share |
|---|---|---|---|
| Money per month | ₹0 | ₹0 until real scale | ₹0 |
| Friend adds their own expenses | Yes | Yes | No |
| Realtime | No | Yes | n/a |
| Invite friction | Browser picker, per file, per member | Tap a link | None |
| Works offline | Yes | Yes | Yes |
| Data leaves the phone | Into each member's own Drive | Into your Firebase project | Never |
| Play / privacy impact | Small | **Significant** | None |
| Build effort | Large | Medium | Small |
| Can it be undone later | Awkward | Awkward | Trivially |

---

## 7. What I would do

**Phase 1 — now.** Build option C. A `split_participants` table, a per-person
balance, and a Share button. Note that the existing `transaction_splits` table
is for splitting one expense across *categories* — people need their own table,
whichever option you eventually pick, so this work is not wasted by a later
decision.

**Phase 2 — only if people ask for it.** Add option B behind the same screens.
Groups become shared, the local splits migrate into them, and the personal
ledger never moves. By then you will know whether anyone wants it, and the
privacy policy rewrite will be worth doing.

**Not option A.** It is the most interesting of the three and the most in
keeping with how this app is built. It is also the one where a user gives up
halfway through joining their first group, and a feature with a broken front
door is not a feature.

---

## Sources

- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) — the `drive.file` definition and the restricted-scope list
- [Google Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview) — browser-based flow on mobile, no embedded webviews
- [permissions.create reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create) — accepts `drive.file`
- [Firebase pricing](https://firebase.google.com/pricing) — Spark plan quotas, no payment method required
