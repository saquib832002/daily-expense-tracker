/**
 * Who is using the app.
 *
 * Signing in is **required** on first launch. That is a deliberate product
 * decision, made twice and against my advice, so the reasoning on both sides is
 * recorded here rather than argued again in a code review:
 *
 *   *For:* one identity, visible in More, with the user's own Google Drive
 *   already authorised for backup. Nobody ends up three months deep in an
 *   expense history that exists on exactly one phone.
 *
 *   *Against, and still true:* the app has no server, so a sign-in identifies
 *   nobody to the developer and unlocks no feature — it authorises Drive and
 *   nothing else. A user with no network, no Play Services, or who simply taps
 *   Cancel is now locked out of an app that works entirely offline. And while
 *   the Cloud project's publishing status is **Testing**, only accounts on the
 *   Test users list can get past this screen at all; everyone else meets
 *   `403 access_denied` and has no way into the app. Pressing **Publish app**
 *   in Google Auth Platform → Audience is therefore no longer optional
 *   housekeeping — it is the difference between a working app and a brick.
 *
 * The identity is kept separate from the backup switch on purpose. Turning
 * Drive backup off on the Backup screen must not sign anyone out, or the next
 * launch would demand a sign-in they did not ask to undo. Only an explicit
 * *Sign out* clears it.
 */
import { getSetting, setSetting } from '@/db/queries';

import { connectDrive, driveStatus, type ConnectResult } from './autoBackup';

const NAME_KEY = 'account_name';
const EMAIL_KEY = 'account_email';
const PHOTO_KEY = 'account_photo';
const AT_KEY = 'account_since';

export interface Account {
  name: string | null;
  email: string | null;
  photo: string | null;
  /** When they signed in, epoch ms. Null on records written before this. */
  since: number | null;
}

/**
 * The signed-in account, or null.
 *
 * Deliberately reads a stored record rather than testing a live token. Tokens
 * expire — after seven days while the Cloud project is in Testing mode — and a
 * gate that tested the token would throw the user out of their own app every
 * week. A dead token breaks the next backup, which the Backup screen already
 * reports; it does not mean nobody is signed in.
 */
export async function signedInAccount(): Promise<Account | null> {
  const email = (await getSetting(EMAIL_KEY)) || null;
  const name = (await getSetting(NAME_KEY)) || null;
  if (!email && !name) return null;

  const since = Number(await getSetting(AT_KEY));
  return {
    name,
    email,
    photo: (await getSetting(PHOTO_KEY)) || null,
    since: Number.isFinite(since) && since > 0 ? since : null,
  };
}

export async function isSignedIn(): Promise<boolean> {
  return (await signedInAccount()) !== null;
}

/**
 * Sign in.
 *
 * There is exactly one Google call in this app — the Drive authorisation — and
 * it already returns everything an identity needs: `drive.file` is enough to
 * ask `about.get` for the account's name, address and picture. Asking
 * separately for `openid email profile` through Credential Manager would mean a
 * second native API and a second line on the consent screen, to learn something
 * the app is already being told.
 */
export async function signIn(): Promise<ConnectResult> {
  const res = await connectDrive();
  if (!res.ok) return res;

  // connectDrive has just asked Drive who this is. Copying the answer into the
  // account record is what survives the Drive switch being turned off later.
  const { account } = await driveStatus();
  await setSetting(NAME_KEY, account.name ?? '');
  await setSetting(EMAIL_KEY, account.email ?? '');
  await setSetting(PHOTO_KEY, account.photo ?? '');
  await setSetting(AT_KEY, String(Date.now()));
  return res;
}

/**
 * Sign out.
 *
 * Forgets the account and nothing else: the ledger stays, the backups already
 * in Drive stay — they are the user's files in the user's account. The next
 * launch will ask for a sign-in again, which is the whole point of the gate,
 * so the screen that offers this has to say so plainly before it happens.
 */
export async function signOut(): Promise<void> {
  await setSetting(NAME_KEY, '');
  await setSetting(EMAIL_KEY, '');
  await setSetting(PHOTO_KEY, '');
  await setSetting(AT_KEY, '');
}
