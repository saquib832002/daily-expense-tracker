# Office expenses: staff record, the owner sees — is it possible from here?

A different question from `docs/sharing-feasibility.md`, and it gets a
different answer. That study looked at splitting a holiday between friends and
concluded *technically yes, practically no*. This one is about a small
business: several staff spend money, the owner needs to see all of it, and some
people should be able to look without being able to change anything.

**Short version: yes, and without a server.** The thing that killed the
friends-and-holidays version — the invite maths — does not apply here, because
an office is a **star** and a group of friends is a **mesh**. And read-only is
not something the app has to police; Google Drive enforces it.

---

## 1. What the business case actually needs

Strip the wording back and there are five requirements, of very different
difficulty:

| | Requirement | Difficulty |
|---|---|---|
| A | Staff record expenses on their own phone, offline | **Already built** |
| B | Everything they record reaches the owner | Moderate |
| C | Staff cannot see or change each other's entries | Easy, if the shape is right |
| D | Some people can look but not change | **Needs an authority** |
| E | Staff cannot quietly rewrite what they already submitted | Needs a server to *prevent*; can be *detected* without one |

D is the one that usually forces a backend, because "read-only" enforced by the
app is not read-only at all — anyone can install a modified build, or open the
file in Drive on a laptop. A rule only means something if something other than
the app is enforcing it.

The insight that makes this work is that **Drive is already that authority.**
Sharing a file as Viewer is enforced by Google's servers, not by this app.

---

## 2. The shape: a star, not a mesh

```
  Priya's phone ──► priya.jsonl   (she writes; shared → owner as Viewer)
  Arun's phone  ──► arun.jsonl    (he writes;  shared → owner as Viewer)
  Sana's phone  ──► sana.jsonl    (she writes; shared → owner as Viewer)
                                        │
                                        ▼
                                  Owner's phone
                                  reads all three, merges,
                                  writes company-summary.json
                                        │
                                        ▼
                          shared → accountant, partner (Viewer)
```

Every staff member writes exactly one file, in **their own** Drive, which the
app created and therefore has `drive.file` access to. They share it with the
owner's email as a **reader**. Nobody writes to anybody else's file, so there
is nothing to merge and no conflict to resolve — expenses are immutable facts
with ids, and the company ledger is simply their union.

### Why the invite maths works here and not for friends

The earlier study's objection was the Google Picker: on Android it is a
browser journey, and the receiving side has to do one per file. In a group of
five friends where everyone reads everyone, that is 5 × 4 = **twenty** picker
journeys.

In an office, only the owner reads. Five staff means the owner does **five**
pickers, once each, ever. Staff do **none** — they only write their own file
and press share. Adding a sixth member costs one picker, not eleven.

That is the whole difference, and it is the reason this is worth building when
the other one was not.

---

## 3. What is enforced, and by whom

| Rule | Enforced by | Real? |
|---|---|---|
| Owner can read every staff file | Drive permission | **Yes** |
| Staff cannot read each other's files | Drive — never shared | **Yes** |
| Owner cannot edit a staff member's entries | Drive — Viewer role | **Yes** |
| Accountant can see the summary, not change it | Drive — Viewer role | **Yes** |
| Staff cannot rewrite their own submitted history | *Nothing* | **No — see below** |

The first four are genuine. They hold if a staff member sideloads a modified
app, opens Drive on a laptop, or uses the API directly, because Google is
checking, not us.

The fifth does not hold, and pretending otherwise would be the worst thing this
document could do. A staff member owns their file. They can edit yesterday's
₹5,000 into ₹500, or delete it.

### Tamper-evidence, which is most of the value

What the owner's app *can* do is keep its own copy of everything it has ever
read. Then a changed or vanished entry is not invisible — it is a discrepancy
the app can show:

> **3 entries changed after submission**
> Arun · 14 Mar · Fuel · was ₹5,000, now ₹500
> Arun · 2 Mar · Client lunch · deleted

For a small office that is arguably *better* than prevention: nothing is
silently rewritten, and the conversation happens with a person rather than with
a permissions dialog. It is not an audit trail a court would accept. It is
enough for a business with eight staff who know each other.

This also means the owner's app **must** persist the merged ledger locally
rather than re-reading Drive as the source of truth — which it should do
anyway, so that revoking a staff member's sharing does not erase their history.

---

## 4. What it costs

Nothing, in money or infrastructure.

- No server, no database, no hosting bill, no domain
- No new OAuth scope — `permissions.create` explicitly accepts `drive.file`,
  which the app already has and which Google classifies as non-sensitive, so
  there is no security assessment and no annual review
- Nothing new in the privacy policy or the Play data-safety form: the data
  still lives only in the users' own Google Drives. The app still cannot see it

That last point is worth saying out loud in the store listing. A business
expense tool whose vendor genuinely cannot read the expenses is unusual.

---

## 5. What it does not do

**It is not real-time.** Sync happens when the app opens and when someone pulls
to refresh. The owner sees this morning's petrol receipt this afternoon.
For expenses that is fine; if the requirement is a live dashboard, it is not.

**There is no approval workflow.** Submit → approve → mark reimbursed is a
different feature, and it is the one a business actually asks for next. It can
be built on this — the owner writes an `approvals.json` the staff read — but it
is not free, and an approval a staff member could edit is not an approval, so
it inherits the same tamper-evidence caveat.

**Every staff member needs a Google account** and must grant Drive access on
first run. In a small Indian office that is usually already true. In one where
staff share a phone, it is not.

**The picker is a browser journey.** One per staff member for the owner, and it
looks like leaving the app. It needs a screen that explains what is about to
happen, or it reads as a bug.

**It does not scale past about twenty staff.** Twenty pickers is twenty
minutes; a hundred is a different product.

---

## 6. When a server becomes the right answer

Past roughly twenty people, or the moment any of these appear:

- **Enforced immutability** — a submitted claim that genuinely cannot be edited
- **An approval workflow** with a real authority behind it
- **A web dashboard**, because the owner wants this on a laptop
- **Multiple companies** in one app
- **Departments and per-department budgets** with different visibility

Then the answer is the one the earlier study reached: **Firebase Firestore on
the free Spark plan** — 50,000 reads and 20,000 writes a day, no payment method
required. Firestore **security rules** are the missing authority: they run on
Google's servers, and they can express "a staff member may create documents
under their own id and may never update one that is already approved" in a way
no client can talk its way around.

The cost is not money. It is that the data would then sit in a database the
developer controls, which changes the privacy claim, the data-safety form and
the privacy policy — and turns a tool that cannot read your expenses into one
that can. That is a real loss and should not be traded away for a feature five
customers asked for.

---

## 7. Side by side

| | Drive star (no server) | Firebase Spark | Export and send |
|---|---|---|---|
| Money | none | none until large | none |
| Server to run | none | none (client-only) | none |
| Read-only enforced | **yes**, by Drive | **yes**, by rules | n/a |
| Staff can't rewrite history | no (detectable) | **yes** | no |
| Real-time | no | yes | no |
| Setup per staff member | one share + one picker by the owner | sign in | none |
| Scales to | ~20 staff | thousands | any, badly |
| Privacy claim survives | **yes** | no | yes |
| Work to build | ~2 weeks | ~3 weeks | ~2 days |

The third column is not a joke. Staff export their week from the statement
screen and send the file; the owner imports it. It uses code that already
exists, it works today, and for an office of three it may genuinely be enough.
Worth offering as the fallback even after the real thing is built, because it
is the only option that needs nobody to have a Google account.

---

## 8. What I would do

**Build the Drive star.** It meets four of the five requirements properly, the
fifth is met well enough for the size of business it serves, it costs nothing
to run, and it keeps the one claim that makes this app different.

Order:

1. **Staff mode** — the app writes an append-only file to the user's own Drive,
   and a screen to share it with the owner's email as Viewer. Small, useful on
   its own, and testable with two phones.
2. **Owner mode** — pick staff files, merge, a company ledger view, and per-
   person totals. This is where the picker screen has to be good.
3. **Tamper-evidence** — the owner's local copy and the "changed after
   submission" list. Cheap once step 2 exists, and the thing that makes an
   owner trust it.
4. **Read-only sharing outward** — the summary file, shared as Viewer with an
   accountant or a partner.
5. *Later, only if asked for* — approvals, and then the server conversation.

**And charge for it.** This is a business feature: it is bought by someone
spending company money, on a different scale from a ₹299 personal unlock. An
office of eight paying a few hundred rupees a month for something that costs
nothing to run is the first thing in this project that could pay for the
developer's time.

---

## Sources

- [permissions.create — accepted scopes include `drive.file`](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create)
- [Drive API scopes: `drive.file` is non-sensitive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Sharing roles: reader, commenter, writer](https://developers.google.com/workspace/drive/api/guides/ref-roles)
- Firebase Spark plan limits — see `docs/sharing-feasibility.md` §4
