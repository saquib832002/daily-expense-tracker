# Google Drive backup — what you have to set up

> **Google Cloud Console is not the Play Console.** They are two different
> Google sites and confusing them costs an afternoon.
>
> | | What it is for | Cost |
> |---|---|---|
> | **Play Console** — play.google.com/console | Publishing the app to users | $25, once |
> | **Cloud Console** — console.cloud.google.com | Registering the app so Google's own services (Drive) will accept requests from it | Free |
>
> This whole document is about the second one. Nothing here goes anywhere near
> the Play listing.

Everything here is free. No annual fee, no security assessment, no paid library.
Budget about half an hour, once.

---

## Why this is free (and why it stays free)

Google sorts OAuth scopes into three buckets. **Restricted** scopes — full Drive
access, Gmail, and the like — require an annual third-party security assessment
that runs into thousands of dollars. **Sensitive** scopes require a manual
review by Google. **Non-sensitive** scopes require neither.

This app asks for exactly one scope:

```
https://www.googleapis.com/auth/drive.file
```

Google classifies it as **non-sensitive**. It grants access to files the app
itself creates and to nothing else the user owns — not their documents, not
their photos, not even the other files in the folder it writes into. That is
both the honest design and the one that costs nothing to publish.

**Do not add a second scope without checking its bucket first.** Adding
`drive` or `drive.readonly` to "make restore easier" would move this app into
the restricted tier and the assessment bill that comes with it.

---

## 1. A Google Cloud project (free)

1. Go to <https://console.cloud.google.com/>.
2. Create a project. Name it whatever you like — the user never sees it.
3. No billing account is needed. Drive API usage at this volume is free.

## 2. Turn on the Drive API

**APIs & Services → Library → Google Drive API → Enable.**

## 3. The OAuth consent screen

**Google Auth Platform → Branding / Audience** (console.cloud.google.com/auth).

Google moved all of this out of "APIs & Services → Credentials" into a section
called **Google Auth Platform** during 2025. The old menu still exists and still
looks plausible, which is worse than it being gone — you can follow the old
directions, land on a page that seems right, and find the button missing.

- User type: **External**.
- App name: the name users will see on the consent screen. Use the app's real
  name — this is the one string in this whole process that your users read.
- Support email and developer contact email: yours.
- **Privacy policy URL** — required to publish. You already host a website, so
  put the policy there. It must mention that the app can write backup files to
  the user's Google Drive.
- Scopes: add `.../auth/drive.file`. Nothing else.

While the app is in **Testing**, only accounts you list can sign in, and tokens
expire after 7 days.

> **This is now a hard blocker, not a nuisance.** Signing in is required to use
> the app at all. So while the project is in Testing, anyone who is not on your
> Test users list installs the app, meets `403 access_denied`, and cannot get
> past the first screen — there is no Skip. **Press Publish app before anybody
> else installs it**, including your twelve closed testers. Because the only
> scope is non-sensitive, publishing needs no manual review and no security
> assessment; the status simply flips to In production.

## 4. The Android OAuth client

**Google Auth Platform → Clients → Create client → Android.**

Direct link: <https://console.cloud.google.com/auth/clients>

- Package name: `com.mma.expensetracker`
- SHA-1 certificate fingerprint: see below.

**You need more than one client.** An OAuth client is bound to one package name
plus one signing fingerprint, and your app gets signed by a different key at
each stage. Create an Android client for each fingerprint you use:

```powershell
# Debug builds — the key Android Studio generates for you
keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" `
        -alias androiddebugkey -storepass android -keypass android

# Your release keystore, once you create it
keytool -list -v -keystore path\to\release.keystore -alias your-alias
```

Copy the **SHA1** line from each.

**Do not skip this one:** if you use Play App Signing (and you should — it is
how you recover from a lost keystore), Google re-signs your app with *their*
key, so the fingerprint on a user's phone is not your release key's. After your
first upload, take the SHA-1 of the **app signing key** from Play Console and
create an Android OAuth client for that too. Miss it and Drive will work
perfectly in every build you test and fail for every real user, which is the
worst-shaped bug there is — and the error it produces, *"this copy of the app
was signed with a key that is not recognized"*, names the cause without
naming the fix.

Play Console moved this page. As of 2026 it is:

> **Protected with Play → Play Store distribution → Go to Play app signing**

The older **Release → Setup → App integrity** path is what Google's own
developer documentation still tells you, and it may still work; if it does not,
use the one above. Both land on a page with two blocks — **App signing key
certificate** and **Upload key certificate**. You want the first one, and if it
lists more than one certificate, register an OAuth client for every SHA-1 it
shows: Google has begun issuing additional app signing certificates for
post-quantum readiness, and a phone may be served by any of them.

Adding a client takes effect for apps that are **already installed** — an
Android OAuth client is matched by package name and fingerprint at the moment
of the request, so there is nothing to rebuild and nothing to re-upload. Allow
a few minutes for it to propagate, then clear the app's data and sign in again.

There is no client ID to paste into the app. Android OAuth clients are matched
by package name and signature at request time, which is why there is no secret
in this repository and nothing to leak.

---

## 5. Rebuild

The backup rules and the new native module both change the Android project, so
a JS reload is not enough:

```powershell
npx expo prebuild --platform android
npx expo run:android
```

---

## 6. Before publishing on Play

**Data safety form.** Signing in and backing up both move data off the device,
so the declaration changes. Declare:

- Data collected: **no** — you run no server and receive nothing.
- Data shared: **no** — Google Drive here is the user's own storage, not a
  third party you hand data to.
- Data transferred off device: **yes**, financial info and photos, **encrypted
  in transit**, **user can request deletion** (they delete the file in their
  own Drive).
- Optional: **no**, as of the mandatory sign-in. The account is required to use
  the app, and the backup it authorises starts immediately. Saying "optional"
  here would be untrue, and data-safety accuracy is one of the commonest reasons
  a first submission is rejected.

Answer this honestly and specifically. A wrong data-safety form is one of the
more common reasons a first submission gets rejected.

**Privacy policy.** Must now say: the app **requires** a Google sign-in; it
requests only the `drive.file` scope; it uses the account solely to create and
manage backup files in the user's own Google Drive; it cannot read any other
file there; the developer receives none of it; and signing out from More → Sign
out removes the account from the phone.

---

## Troubleshooting

**`Error 403: access_denied` on the Google sign-in screen.**

The commonest failure once the project exists, and it is not a code problem.
While the app's publishing status is **Testing**, only Google accounts listed
as **Test users** may authorise it — everyone else, including you, is refused.

Two ways out, in **Google Auth Platform → Audience**:

- *Right now:* add your own address under **Test users**. Takes thirty seconds.
- *Before the closed test:* press **Publish app**. Because `drive.file` is a
  non-sensitive scope this needs no verification review and no security
  assessment — the status just flips to In production.

Publishing is the better end state for a second reason: in Testing, tokens
expire after **seven days**, so a connection made today silently stops working
next week. That is a maddening bug to chase if you do not know the rule.

**The app shows a fingerprint panel after you pick an account** — the key that
signed this build is not registered against an Android client.
This is the cause roughly nine times out of ten. Re-run `keytool` on the
keystore that actually signed the APK you are holding.

**Works on your phone, fails for testers.** — the Play App Signing fingerprint
(step 4) is missing.

**"This app was installed before Drive backup was added."** — not an error. The
JS bundle knows about Drive and the installed APK does not. Rebuild.

**Sign-in works, upload fails with 403.** — check the consent screen still lists
`drive.file`, and that the account is a test user if the app is still in
Testing.

---

## What this does not cover: iOS and iCloud

Reaching an iPhone at all needs the Apple Developer Program at **$99/year**, so
it is out of scope while the app is free to build. Worth knowing for later:

- **iCloud Backup** is the direct equivalent of Android Auto Backup, and it
  comes free with zero code — iOS includes an app's Documents directory
  automatically. It also has no 25 MB cliff, so the exclusion problem this
  document exists to solve does not arise there.
- **CloudKit** would be the equivalent of the Drive integration. Also included
  in the $99, no extra fee.

So the cost of iOS is the membership, not the backup work.
