# Building and signing a release

Everything needed to take this project from source to a Play upload, and the
errors you get when a step is missed. Written after hitting most of them.

---

## The three keys, and why there are three

Android decides whether an app may talk to a Google API by looking at the
**package name plus the certificate the app was actually signed with**. This
project gets signed by three different keys depending on how it was built, and
each one needs its own Android OAuth client or Drive sign-in fails.

| Built with | Signed by | Where the key lives |
|---|---|---|
| `npx expo run:android` | React Native's debug key | `android/app/debug.keystore`, shipped with the template |
| `npm run build:apk` / `build:aab` | your upload key | `keys/expense-tracker-upload.jks` |
| Installed from Play | **Google's** app signing key | Google's servers. You never get it |

The third one is the one that surprises people. Play App Signing strips your
upload signature and re-signs with a key Google holds, so the certificate on a
real user's phone is not yours and never can be. That is deliberate: it is how
a lost upload key stops being fatal.

**The fingerprints for this app:**

```
Debug   5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
Upload  run the keytool command below
Play    39:E0:CC:92:A3:30:B7:D3:31:57:25:97:D6:F5:23:46:3B:5D:59:DA
```

The debug one is fixed — it ships inside React Native, valid until 2052, and
`expo prebuild --clean` restores the identical file every time. It does not
drift. If a fingerprint appears to have changed, what changed is which build
you are holding.

---

## One-time setup

### 1. The upload key

```powershell
mkdir keys
keytool -genkeypair -v -storetype PKCS12 `
  -keystore keys\expense-tracker-upload.jks `
  -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Run from the project root. It asks for a password, then a name — publishing as
an individual, your own name is right for both name and organisation.

**Back the `.jks` up somewhere off this machine today.** Play App Signing can
reset a lost *upload* key, so it is not fatal — but that is a fire escape, not
a plan, and the reset takes days.

### 2. Point the build at it

`keystore.properties` in the **project root** — beside `package.json`, not
inside `android/`, which `prebuild --clean` deletes:

```
storeFile=keys/expense-tracker-upload.jks
storePassword=<yours>
keyAlias=upload
keyPassword=<same; PKCS12 uses one password for both>
```

Forward slashes: a backslash is an escape character in a Java properties file.

`plugins/withReleaseSigning.js` injects this into the generated Gradle at
prebuild time. It is a config plugin rather than an edit to
`android/app/build.gradle` because that file is regenerated from the template
on every `prebuild --clean` — a hand edit there survives until the next one,
then silently reverts to signing releases with the **debug** key, which Play
rejects with *"You uploaded an APK or Android App Bundle that was signed in
debug mode."*

If `keystore.properties` is missing or any value is blank, `bundleRelease` now
fails with a message saying which — rather than producing a debug-signed
bundle you only find out about at the upload.

### 3. Register all three OAuth clients

https://console.cloud.google.com/auth/clients → **Create client → Android**,
once per fingerprint:

- Package name: `com.mma.expensetracker`
- SHA-1: one of the three above

Get the upload key's with:

```powershell
keytool -list -v -keystore keys\expense-tracker-upload.jks -alias upload
```

Get Play's from **Protected with Play → Play Store distribution → Go to Play
app signing** (older consoles: Release → Setup → App integrity). Take it from
the **App signing key certificate** block, not the Upload key one. Register
every certificate listed there — Google has begun issuing additional app
signing certificates for post-quantum readiness.

Adding a client takes effect on apps that are **already installed**; there is
nothing to rebuild.

### 4. Publish the OAuth consent screen

https://console.cloud.google.com/auth/audience → **Publish app**.

While it is in Testing, anyone not on the test-user list hits `403
access_denied` at the sign-in gate with no way past — and sign-in is mandatory
in this app. The only scope is `drive.file`, which Google classifies as
non-sensitive, so publishing needs no review; the status just flips. It also
ends the 7-day token expiry.

---

## Every release

### 1. Bump the version

`app.json`:

```json
"version": "0.2.0",
"android": { "versionCode": 2 }
```

**`versionCode` must increase on every upload.** Play rejects a duplicate with
*"Version code 1 has already been used"*, and it is the step most easily
forgotten because nothing local complains.

### 2. Build

```powershell
npm install
npx tsc --noEmit
npm test
npx expo prebuild --platform android --clean
npm run build:aab
npm run check:16kb
```

`npm install` is not optional when dependencies changed — a missing native
module shows up as *"Unable to resolve module …"* at bundling, or as a crash
on the screen that uses it.

`check:16kb` reads the ELF program headers of every `.so` in the build output.
Every 64-bit library must report **16384**. A 4096 means Play will refuse the
upload with *"Recompile your app with 16 KB native library alignment"*; the
fix is the toolchain, not app code — see `docs/sdk54-upgrade.md`.

The bundle lands at:

```
android\app\build\outputs\bundle\release\app-release.aab
```

### 3. Check what actually signed it

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs android\app\build\outputs\apk\release\app-release.apk
```

`Signer #1 certificate SHA-1 digest` is the answer, measured from the artifact
rather than trusted from a label. Note `keytool -printcert -jarfile` does **not**
work on modern APKs — it only understands the old v1 JAR signature, and says
*"Not a signed jar file"* for anything signed with v2/v3 only.

### 4. Upload, then verify on a real install

After uploading, the closest thing to what users get is **App bundle explorer
→ your version → Downloads → Signed, universal APK**. That file carries
Google's signature, so it exercises the Play OAuth client rather than your
upload one.

```powershell
adb uninstall com.mma.expensetracker
adb install -r path\to\downloaded.apk
```

The uninstall is needed because Android refuses to replace an app with one
signed by a different key — `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. It wipes the
app's data, so you go through sign-in and the welcome screen again.

---

## Testing on a device without a release build

```powershell
adb devices
npx expo run:android --device
```

Debug build, Metro attached, JS changes reload without rebuilding. Native
changes — a new Expo module, anything under `android/` — need the full command
again. This uses the debug key, which is why that third OAuth client matters.

---

## When it goes wrong

| What you see | What it means |
|---|---|
| "signed in debug mode" | `signingConfig signingConfigs.debug` reached the release build. The plugin is not applied, or `keystore.properties` was missing when prebuild ran |
| "Version code N has already been used" | Bump `android.versionCode` in `app.json` |
| "Recompile with 16 KB native library alignment" | A 64-bit `.so` is 4096-aligned. Run `npm run check:16kb` to find which |
| "signed with a key that is not recognized" | No OAuth client for the certificate on *this* build. Check with apksigner, register that SHA-1 |
| `403 access_denied` for other people | OAuth consent screen still in Testing. Publish it |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Installing over a differently-signed copy. `adb uninstall` first |
| "Unable to resolve module …" | `npm install` was skipped after a dependency was added |
| "Not a signed jar file" | Wrong tool — use `apksigner`, not `keytool -printcert` |

---

## What must never be committed

`.gitignore` already excludes all of it, and it is worth knowing why:

```
keys/                    the signing key itself
keystore.properties      the password, in plain text
*.jks  *.keystore        anywhere they end up
*.aab  *.apk             build output, large and regenerable
```

Putting the upload key in a public repository hands anyone the ability to
publish updates to your app, and there is no way to un-publish a secret from
git history.
