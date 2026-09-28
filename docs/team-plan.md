# Office mode: the owner invites, staff write into the owner's Drive

A plan, not a study. `docs/team-feasibility.md` asked whether an office could
share a ledger at all and answered yes, with each staff member writing a file
in *their own* Drive and sharing it back. This turns that around: **the owner
creates the files and invites staff to write into them.**

That is a better design in every way that matters, and it is the one to build.

---

## 1. Why the owner should own the files

| | Staff own their file | **Owner owns the file** |
|---|---|---|
| Pickers the owner does | one per staff member | **none** |
| Pickers a staff member does | none | one, at joining |
| Where company records live | scattered across staff Drives | **the owner's Drive** |
| Staff leaves the company | owner loses the history | **owner keeps everything** |
| Revoking access | ask them to unshare | **owner removes the permission** |
| Edit history | none | **Drive revisions, visible to the owner** |

The last three are the business ones. A company's expense records should sit in
the company's custody, cut off the day someone leaves, and be inspectable when
a number looks wrong. Owner-owned files give all three for free, because Drive
already does them.

The one cost is that each staff member does a single picker journey when they
join — which is the natural moment for it, and which the owner never has to
think about.

---

## 2. The two facts this rests on

Both checked against Google's current documentation, because the whole design
falls over without them.

**`permissions.create` accepts `drive.file`.** The owner's app can share a file
it created with a staff member's email address, as a writer, using the scope
the app already has. No new scope, nothing sensitive, no security assessment.

**`drive.file` covers files the user picks.** The scope is *"Create new Drive
files, or modify existing files, that you open with an app or that the user
shares with an app while using the Google Picker API"* — and **modify** is the
operative word. Once a staff member picks the owner's file, their app can write
to it, permanently.

### And the picker no longer needs a website

This is the part that changed the plan. The earlier study assumed the Google
Picker meant hosting a web page, which for a project with no server was a
problem. Google now documents a **desktop and mobile flow** that does not:

> "The Google Picker API for desktop and mobile apps redirects to the Google
> Picker within a new tab in the user's default browser."

The app builds an OAuth URL with `prompt=consent` and `trigger_onepick=true`,
opens it in the system browser, and the redirect comes back to the app's own
`redirect_uri` carrying **`picked_file_ids`** and an authorization **`code`**.
On Android the supported route is `AuthorizationRequest` with the
`PICKER_OAUTH_TRIGGER` parameter. One constraint: in this flow `drive.file`
**cannot be combined with any other scope** — which is fine, because it is the
only scope this app asks for.

So: no server, no hosted page, no new scope. Verify the exact parameter names
against the live guide when implementing; that page is young and the shape of
it may still move.

---

## 3. What gets created

When the owner switches on Office mode, their app creates — all in the owner's
Drive, all app-created and therefore in scope without any picker:

```
Expense Tracker — <Company>/          folder
├── company.json                      name, currency, categories, staff roster
├── staff-<uuid>.jsonl                one per person. Owner owns, staff writes
├── staff-<uuid>.jsonl
└── summary.json                      written by the owner, for read-only eyes
```

**One file per person, and only that person writes it.** This is what removes
every concurrency problem: two phones never touch the same file, so there is no
merge, no last-writer-wins, and no clock to trust. The company ledger is the
union of the files, and because each line is an immutable fact with an id, a
union is all it takes.

**`.jsonl`, not `.json`** — one JSON object per line. Appending a line is the
only write, which means a sync that dies halfway leaves a file that is still
readable up to the last complete line.

```jsonl
{"id":"9f3c…","at":1789500000000,"amountMinor":-45000,"currency":"INR","category":"fuel","merchant":"HP Petrol","note":"client visit","by":"priya","rev":1}
{"id":"a71d…","at":1789586400000,"amountMinor":-120000,"currency":"INR","category":"office","merchant":"Reliance Digital","rev":1}
```

`rev` exists so an edit is an appended line rather than a rewrite — the file
stays append-only, the owner sees the correction, and nothing is lost.

---

## 4. The flows

### Owner: create a company

1. More → Office mode → **Create a company**
2. Name, currency, who reports to whom (nobody, at first)
3. App creates the folder and `company.json`

### Owner: invite a staff member

1. Enter name and Google email
2. App creates `staff-<uuid>.jsonl` and calls:
   - `permissions.create(fileId, {type:'user', role:'writer', emailAddress})`
   - `permissions.create(companyFileId, {type:'user', role:'reader', emailAddress})`
     — so they get the company's categories but cannot change them
3. Google sends its own "shared a file with you" mail
4. App shows a **join link** to send over WhatsApp:
   `expensetracker://join?c=<companyFileId>&s=<staffFileId>&n=Priya`

### Staff: join

1. Tap the link, or More → **Join a company** and paste the code
2. App explains what is about to happen, then opens the picker flow in the
   browser
3. Staff picks the two files their employer shared
4. Redirect returns `picked_file_ids` and `code`; app exchanges the code and
   stores the tokens
5. Done, permanently. Nothing to repeat

### Staff: every day

Record expenses exactly as now — offline, on their own phone, into their own
local database. A background sync appends anything new to their file in the
owner's Drive on app open and every few hours.

### Owner: every day

App reads every `staff-*.jsonl` — no picker, the files are its own — merges
them into a read-only company ledger with per-person totals, and keeps a local
copy so the history survives a staff member leaving.

### Read-only for an accountant

Owner shares `summary.json` as a reader. The accountant picks it once. They see
figures and can change nothing, enforced by Drive rather than by the app.

---

## 5. What is enforced, and by whom

| Rule | Enforced by | Real? |
|---|---|---|
| Staff cannot see each other's entries | Drive — never shared | **yes** |
| Staff cannot alter company categories | Drive — reader role | **yes** |
| Accountant can look, not touch | Drive — reader role | **yes** |
| Owner keeps records when staff leave | Drive — owner owns the file | **yes** |
| Access ends the day someone leaves | `permissions.delete` | **yes** |
| Staff cannot rewrite their own history | *nothing* | **no** |

That last row is unchanged from the feasibility study, and it is the one to be
straight about with customers. A writer can edit the file.

**But owner-ownership makes it far better than before.** Drive keeps revision
history for files, and the owner — as owner — can see it. Combined with the
owner's own local copy, a changed entry produces a visible discrepancy:

> **2 entries changed after submission**
> Priya · 14 Mar · Fuel · was ₹5,000, now ₹500

That is tamper-*evidence*, not tamper-proofing. For an office of eight it is
enough; it means nothing is silently rewritten. For a company that needs a
claim to be genuinely immutable once submitted, the answer is still a server —
Firestore security rules — and that conversation is in the feasibility study.

---

## 6. What it costs, and what it does not do

**Costs nothing.** No server, no hosting, no new scope, no change to the
privacy policy or the Play data-safety form — the data still lives only in
users' own Google Drives and the developer still cannot read it.

**Storage counts against the owner's 15 GB.** Text is nothing: ten staff at
fifty expenses a month is well under a megabyte a year. **Receipt photos are
not nothing**, so they stay on the staff member's phone by default, with
uploading them a per-company setting the owner turns on knowingly.

**Not real-time.** Sync on app open and on pull-to-refresh. This morning's
petrol reaches the owner this afternoon.

**No approval workflow yet.** Submit → approve → reimburse is the next thing a
business asks for. It fits — the owner writes `approvals.jsonl`, staff read it
— but an approval a staff member could edit is not an approval, so it inherits
the caveat above.

**Everyone needs a Google account**, and the app's sign-in gate already
requires one, so this is not a new demand.

**About twenty staff is the ceiling.** Not for technical reasons — twenty files
read on open is trivial — but because past that, a business wants a web
dashboard and real approvals, and that is a different product.

---

## 7. Build order

Each step is useful on its own and testable with two phones.

**1 · Company and invite — 4 days.**
`services/company.ts`: create the folder, `company.json`, staff files; wrap
`permissions.create`. A screen to create a company and add people. At the end
of this step the owner can invite someone; nothing receives the invitation yet.

**2 · The picker, and joining — 5 days, the risky one.**
Extend `modules/google-drive-auth` with the mobile picker trigger, the deep
link `expensetracker://join`, and a join screen that explains the browser
journey before it starts. This is the step with unknowns in it — budget for the
Android authorization API behaving differently from the guide, and prove it
with a throwaway build before writing the screen.

**3 · Staff sync — 4 days.**
An outbox of unsent entries, append to the staff file, retry on failure, and a
status line saying when it last reached the owner. Entirely offline-tolerant.

**4 · The owner's company ledger — 4 days.**
Read every staff file, merge, per-person and per-category totals, and a local
copy kept as the durable record. Read-only: the owner does not edit a staff
member's entry, they ask about it.

**5 · Tamper-evidence — 2 days.**
Compare what has been read before with what is there now; list what changed.
Cheap once step 4 exists, and the thing that makes an owner trust the rest.

**6 · Read-only sharing outward — 2 days.**
`summary.json` and a share-with-viewer screen.

Roughly **three weeks**, with step 2 carrying most of the risk. If it turns out
the mobile picker flow does not behave as documented, the fallback is the
earlier star design — staff own their files, owner picks them — which needs no
picker on the staff side at all and is a screen's worth of change, not a
redesign.

---

## 8. The simpler thing, for the offices that want it

Worth building anyway, because it is two days and it solves the same problem
for a real slice of customers: **one company Google account.**

The owner creates `myoffice.expenses@gmail.com`, staff sign in with it on their
phones, and each device is given a name. Every file is app-created for that one
account, so there is no sharing, no invitation, no picker and no permissions —
the sync that already exists just works.

What it gives up is everything in the enforcement table: one account means one
set of eyes and one set of hands, and "read-only" would be the app's word for
it, not Google's. In an office where the owner already keeps the shared account
password, that is a trade they have made before.

Offer both. Call them **Simple** and **Managed**, say plainly what each one
enforces, and let the customer choose.

---

## Sources

- [Choose Drive API scopes — `drive.file` covers files opened via the Picker, including modifying them](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [`permissions.create` — accepted scopes include `drive.file`](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create)
- [Integrate the Google Picker into desktop and mobile apps](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker)
- [Sharing roles — reader, commenter, writer](https://developers.google.com/workspace/drive/api/guides/ref-roles)
