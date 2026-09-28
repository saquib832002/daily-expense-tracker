/**
 * Bump the version before a Play upload.
 *
 * Play keys an upload on **versionCode**, not on the version string, and it
 * rejects a repeat with "Version code 1 has already been used. Try another
 * version code." — after the build, after the upload, several minutes into
 * something you thought was finished. Nothing locally warns you, because
 * locally nothing is wrong.
 *
 * This is the smallest thing that stops it happening twice.
 *
 *   npm run bump             versionCode + 1, version string untouched
 *   npm run bump -- patch    versionCode + 1, and 0.1.1 → 0.1.2
 *   npm run bump -- minor    versionCode + 1, and 0.1.1 → 0.2.0
 *   npm run bump -- major    versionCode + 1, and 0.1.1 → 1.0.0
 *
 * versionCode always moves, because that is the one Play enforces. The
 * version string is what users see and is yours to choose — which is why it
 * only changes when you ask.
 */
const fs = require('fs');
const path = require('path');

const APP_JSON = path.join(__dirname, '..', 'app.json');

/** 'patch' | 'minor' | 'major', or undefined to leave the name alone. */
const bump = process.argv[2];

if (bump && !['patch', 'minor', 'major'].includes(bump)) {
  console.error(`Unknown bump "${bump}". Use patch, minor, major, or nothing at all.`);
  process.exit(1);
}

const raw = fs.readFileSync(APP_JSON, 'utf8');
const config = JSON.parse(raw);
const expo = config.expo;

if (!expo || !expo.android) {
  console.error('app.json has no expo.android block. Nothing to bump.');
  process.exit(1);
}

const oldCode = Number(expo.android.versionCode);
if (!Number.isInteger(oldCode) || oldCode < 1) {
  console.error(`expo.android.versionCode is "${expo.android.versionCode}" — expected a positive integer.`);
  process.exit(1);
}
expo.android.versionCode = oldCode + 1;

const oldVersion = String(expo.version ?? '0.0.0');
let newVersion = oldVersion;

if (bump) {
  const parts = oldVersion.split('.').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    console.error(`expo.version is "${oldVersion}" — expected three numbers like 1.2.3.`);
    process.exit(1);
  }
  let [major, minor, patch] = parts;
  if (bump === 'major') [major, minor, patch] = [major + 1, 0, 0];
  else if (bump === 'minor') [major, minor, patch] = [major, minor + 1, 0];
  else patch += 1;
  newVersion = `${major}.${minor}.${patch}`;
  expo.version = newVersion;
}

// Two spaces and a trailing newline, matching what Expo writes, so this never
// shows up as a whitespace diff on top of the real change.
fs.writeFileSync(APP_JSON, `${JSON.stringify(config, null, 2)}\n`);

console.log(`versionCode ${oldCode} → ${expo.android.versionCode}`);
console.log(bump ? `version ${oldVersion} → ${newVersion}` : `version ${oldVersion} (unchanged)`);
console.log('');
console.log('Now: npx expo prebuild --platform android --clean && npm run build:aab');
