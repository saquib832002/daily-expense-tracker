/**
 * Automatic backups.
 *
 * Three destinations, deliberately different, because they protect against
 * different disasters:
 *
 *  1. **Inside the app** — a small JSON snapshot of the data. No permission
 *     needed, invisible to everything else on the phone, and swept up by
 *     Android's own nightly backup to the user's Drive. It protects against a
 *     bad import, a wrong delete, a new phone. It does NOT survive
 *     uninstalling the app.
 *
 *  2. **A folder on the phone** — a full ZIP, photos included. Somewhere the
 *     user can see and copy: Downloads, an SD card. Chosen once and remembered.
 *
 *  3. **Google Drive** — the same full ZIP, in the user's own Drive. The only
 *     copy that survives losing the phone AND uninstalling the app, and the
 *     only one not bounded by Android's 25 MB backup quota.
 *
 * The snapshot in (1) carries no images, and that is not laziness. Android's
 * Auto Backup stops backing up an app ENTIRELY once its data passes 25 MB — not
 * partially, entirely, and without telling anyone. Receipt photos are excluded
 * from it at the manifest level (see plugins/withBackupRules.js) so that the
 * database always gets through, however many bills have been photographed.
 * Putting those same images back inside a JSON snapshot would walk straight
 * into the ceiling we just stepped around. (2) and (3) are the copies that must
 * stand alone, so those are ZIPs with the photos inside.
 */
import * as FileSystem from 'expo-file-system';

import { buildBackup, restoreBackup, type RestoreResult } from '@/db/backup';
import { buildBackupZip } from '@/db/backupZip';
import { getSetting, setSetting } from '@/db/queries';
import {
  KEEP_SNAPSHOTS,
  intervalDaysFor,
  isBackupDue,
  nextBackupAt,
  snapshotName,
  snapshotsToPrune,
  sortSnapshots,
  type BackupFrequency,
} from '@/domain/backupSchedule';
import * as drive from './drive';
import { listReceiptFiles, receiptsSize } from './receipts';

export const BACKUP_DIR = `${FileSystem.documentDirectory}backups/`;

const FREQUENCY_KEY = 'auto_backup_frequency';
const LAST_KEY = 'auto_backup_last';
const FOLDER_KEY = 'auto_backup_folder';
const DRIVE_ON_KEY = 'auto_backup_drive';
const DRIVE_FOLDER_KEY = 'auto_backup_drive_folder';
const DRIVE_LAST_KEY = 'auto_backup_drive_last';
const DRIVE_ERROR_KEY = 'auto_backup_drive_error';
const DRIVE_NAME_KEY = 'auto_backup_drive_name';
const DRIVE_EMAIL_KEY = 'auto_backup_drive_email';
const DRIVE_PHOTO_KEY = 'auto_backup_drive_photo';
/** Folder copies are big. Three is a fortnight of weeklies, or three days. */
const KEEP_IN_FOLDER = 3;

export interface Snapshot {
  name: string;
  at: number;
  size: number;
}

/** Everything the Backup screen needs, gathered once. */
export interface BackupStatus {
  frequency: BackupFrequency;
  lastAt: number | null;
  nextAt: number | null;
  snapshots: Snapshot[];
  /** Where folder copies go, or null when none has been chosen. */
  folderUri: string | null;
  folderLabel: string | null;
  receiptCount: number;
  receiptBytes: number;
  drive: DriveStatus;
}

export interface DriveStatus {
  /** False when this build predates Drive backup, or Play Services is absent. */
  available: boolean;
  /** Has the user connected an account? */
  connected: boolean;
  lastAt: number | null;
  /** Whose Drive this is, once connected. Null until then. */
  account: drive.DriveAccount;
  /**
   * What went wrong last time, in the app's own words, or null.
   * Kept because a Drive upload fails while nobody is watching, and a silent
   * failure is the exact thing this whole screen exists to prevent.
   */
  lastError: string | null;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
}

/* ------------------------------------------------------------- preferences */

export async function getFrequency(): Promise<BackupFrequency> {
  const raw = await getSetting(FREQUENCY_KEY);
  return raw === 'daily' || raw === 'weekly' ? raw : 'off';
}

/**
 * Change how often the app backs itself up.
 * Choosing daily or weekly takes one immediately, so the choice produces
 * something you can see rather than a promise about next week.
 */
export async function setFrequency(
  frequency: BackupFrequency,
  appVersion?: string,
): Promise<void> {
  await setSetting(FREQUENCY_KEY, frequency);
  if (frequency !== 'off') await takeSnapshot(appVersion);
}

export async function lastBackupAt(): Promise<number | null> {
  const raw = await getSetting(LAST_KEY);
  const n = Number(raw);
  return raw && Number.isFinite(n) ? n : null;
}

/* ----------------------------------------------------- a folder you choose */

/**
 * Turn Android's content URI into something a person recognises.
 * `content://…/tree/primary%3ADownload` is not an answer to "where is it
 * going?"; "Download" is.
 */
export function folderLabel(uri: string | null): string | null {
  if (!uri) return null;
  try {
    const decoded = decodeURIComponent(uri);
    const afterColon = decoded.split(':').pop() ?? '';
    const leaf = afterColon.split('/').filter(Boolean).pop();
    return leaf || decoded;
  } catch {
    return uri;
  }
}

export async function getExportFolder(): Promise<string | null> {
  return (await getSetting(FOLDER_KEY)) || null;
}

/**
 * Ask Android for a folder to keep copies in. Null means the user backed out.
 * The permission is persisted by the system, so this is asked once ever.
 */
export async function chooseExportFolder(): Promise<string | null> {
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  await setSetting(FOLDER_KEY, permission.directoryUri);
  return permission.directoryUri;
}

export async function forgetExportFolder(): Promise<void> {
  await setSetting(FOLDER_KEY, '');
}

/**
 * Write a full ZIP — data and photos — into the chosen folder, and tidy up
 * older ones so the folder does not fill with months of copies.
 */
async function writeToFolder(folderUri: string, at: number, appVersion?: string): Promise<void> {
  const name = snapshotName(at, 'zip');
  const { uri: cacheUri } = await buildBackupZip(name, appVersion);

  const base64 = await FileSystem.readAsStringAsync(cacheUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const target = await FileSystem.StorageAccessFramework.createFileAsync(
    folderUri,
    name,
    'application/zip',
  );
  await FileSystem.writeAsStringAsync(target, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => {});

  // Prune, matching only files this app named — anything else in that folder
  // belongs to the user and is none of our business.
  try {
    const existing = await FileSystem.StorageAccessFramework.readDirectoryAsync(folderUri);
    const names = existing.map((u) => decodeURIComponent(u).split('/').pop() ?? '');
    const stale = new Set(snapshotsToPrune(names, KEEP_IN_FOLDER, 'zip'));
    for (const uri of existing) {
      const leaf = decodeURIComponent(uri).split('/').pop() ?? '';
      if (stale.has(leaf)) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  } catch {
    // Listing a SAF folder can fail on some providers. Not worth failing the
    // backup we have just successfully written.
  }
}

/* --------------------------------------------------------------- to Drive */

export async function isDriveOn(): Promise<boolean> {
  return (await getSetting(DRIVE_ON_KEY)) === '1';
}

/**
 * Why connecting did not work, in terms the screen can act on.
 *
 *  cancelled     — the user closed the picker. Say nothing.
 *  notRegistered — Google refused this build's signature. Show the fingerprint,
 *                  because that is the one thing that fixes it.
 *  noResult      — the consent screen came and went without an answer.
 *  refused       — Google said no for some other reason; `message` has it.
 *  apiError      — the token worked but Drive itself rejected the request,
 *                  usually because the Drive API is not enabled on the project.
 */
export type ConnectFailure =
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'notRegistered'; signing: drive.SigningInfo | null }
  | { ok: false; reason: 'closed'; signing: drive.SigningInfo | null }
  | { ok: false; reason: 'noResult' }
  | { ok: false; reason: 'refused'; message: string }
  | { ok: false; reason: 'apiError'; message: string };

export type ConnectResult = { ok: true } | ConnectFailure;

/**
 * Connect a Google account: ask for a token once, interactively, and only
 * remember that it worked if it did.
 *
 * Written to make every dead end distinguishable. The first version returned a
 * boolean, so "you closed the picker" and "Google rejected this build" both
 * left the screen sitting on "Not connected" with nothing said — which is
 * precisely the shape of bug that costs a day, because the two need opposite
 * responses.
 */
export async function connectDrive(): Promise<ConnectResult> {
  const auth = await drive.getToken(true);

  if (auth.outcome !== 'granted' || !auth.token) {
    if (auth.outcome === 'noResult') return { ok: false, reason: 'noResult' };

    // DEVELOPER_ERROR arrives as an explicit code when Play Services fails the
    // request outright, and it is unambiguous.
    if (auth.code === drive.DEVELOPER_ERROR) {
      return { ok: false, reason: 'notRegistered', signing: drive.signingInfo() };
    }
    if (auth.outcome === 'failed') {
      return { ok: false, reason: 'refused', message: auth.message ?? 'unknown' };
    }

    // A cancel that arrives AFTER the consent screen ran is the one that used
    // to produce silence, and it is the commonest failure of the lot: Play
    // Services shows the account picker first and only checks the app's
    // signature afterwards, then aborts with a bare RESULT_CANCELED that looks
    // exactly like a back press.
    //
    // The previous version of this function described that in a comment and
    // then never implemented it — it only ever tested for DEVELOPER_ERROR, so
    // the real-world path fell through to a silent 'cancelled' and the button
    // did nothing at all. Twice. The two cases genuinely cannot be told apart
    // from here, so the screen now says so and shows the fingerprint, which
    // costs a user who really did press back one sentence they can ignore.
    if (auth.afterConsent) {
      return { ok: false, reason: 'closed', signing: drive.signingInfo() };
    }
    return { ok: false, reason: 'cancelled' };
  }

  // Make the folder now rather than at the first backup. Connecting should
  // produce something real, and a permission problem should surface while the
  // user is still looking at the button they just pressed.
  try {
    const folderId = await drive.findOrCreateFolder(auth.token);
    await setSetting(DRIVE_FOLDER_KEY, folderId);
    await setSetting(DRIVE_ON_KEY, '1');
    await setSetting(DRIVE_ERROR_KEY, '');

    // Remember whose account it is, so the Settings screen can say. Stored
    // rather than fetched on every render: it is one network call and it does
    // not change.
    const account = await drive.getAccount(auth.token);
    await setSetting(DRIVE_NAME_KEY, account.name ?? '');
    await setSetting(DRIVE_EMAIL_KEY, account.email ?? '');
    await setSetting(DRIVE_PHOTO_KEY, account.photo ?? '');
    return { ok: true };
  } catch (e) {
    // A token but no folder means the Drive API itself said no — nearly always
    // because it was never enabled on the Cloud project, which is a completely
    // different fix from a signing problem and must not be reported as one.
    return { ok: false, reason: 'apiError', message: e instanceof Error ? e.message : String(e) };
  }
}

/** The fingerprint Google is matching this build against. */
export function driveSigningInfo(): drive.SigningInfo | null {
  return drive.signingInfo();
}

/**
 * Stop using Drive.
 *
 * This forgets the app's side only. It deliberately does NOT delete the backups
 * already in Drive — they are the user's files, sitting in the user's account,
 * and quietly binning them because a toggle moved would be indefensible. Access
 * itself is revoked from the Google account page; the screen says so.
 */
export async function disconnectDrive(): Promise<void> {
  await setSetting(DRIVE_ON_KEY, '');
  await setSetting(DRIVE_FOLDER_KEY, '');
  await setSetting(DRIVE_ERROR_KEY, '');
  // The account details go too. Keeping someone's name and address after they
  // disconnected would be a small betrayal of exactly the thing they asked for.
  await setSetting(DRIVE_NAME_KEY, '');
  await setSetting(DRIVE_EMAIL_KEY, '');
  await setSetting(DRIVE_PHOTO_KEY, '');
}

async function driveFolderId(token: string): Promise<string> {
  const saved = await getSetting(DRIVE_FOLDER_KEY);
  if (saved && (await drive.folderExists(token, saved))) return saved;

  // Trashed, or made on a phone whose settings did not come along. Make a new
  // one; with the drive.file scope the app genuinely cannot go looking.
  const fresh = await drive.findOrCreateFolder(token);
  await setSetting(DRIVE_FOLDER_KEY, fresh);
  return fresh;
}

/**
 * Push a ZIP to Drive. `interactive` decides whether the user may be shown a
 * consent screen — false during a scheduled backup, because a backup that
 * interrupts you on app start is worse than a backup that waits a day.
 */
async function writeToDrive(at: number, interactive: boolean, appVersion?: string): Promise<void> {
  const auth = await drive.getToken(interactive);
  const token = auth.token;
  if (auth.outcome !== 'granted' || !token) {
    throw new Error(auth.message ?? 'driveNeedsSignIn');
  }

  const folderId = await driveFolderId(token);
  const name = snapshotName(at, 'zip');
  const { uri } = await buildBackupZip(name, appVersion);

  try {
    await drive.uploadFile(token, folderId, uri, name);
    await setSetting(DRIVE_LAST_KEY, String(at));
    await setSetting(DRIVE_ERROR_KEY, '');
    await drive.pruneBackups(token, folderId);
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}

export async function driveStatus(): Promise<DriveStatus> {
  const lastRaw = await getSetting(DRIVE_LAST_KEY);
  const last = Number(lastRaw);
  return {
    available: drive.isAvailable(),
    connected: await isDriveOn(),
    lastAt: lastRaw && Number.isFinite(last) ? last : null,
    account: {
      name: (await getSetting(DRIVE_NAME_KEY)) || null,
      email: (await getSetting(DRIVE_EMAIL_KEY)) || null,
      photo: (await getSetting(DRIVE_PHOTO_KEY)) || null,
    },
    lastError: (await getSetting(DRIVE_ERROR_KEY)) || null,
  };
}

/* ------------------------------------------------------------- the backups */

export async function listSnapshots(): Promise<Snapshot[]> {
  await ensureDir();
  const names = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  const ours = sortSnapshots(names, 'json');

  const out: Snapshot[] = [];
  for (const s of ours) {
    const info = await FileSystem.getInfoAsync(`${BACKUP_DIR}${s.name}`);
    out.push({ name: s.name, at: s.at, size: info.exists ? (info.size ?? 0) : 0 });
  }
  return out;
}

/** What a backup actually managed to do. Every leg reported separately. */
export interface SnapshotResult {
  name: string;
  folder: boolean;
  drive: boolean;
  /** Set when Drive was meant to happen and did not. */
  driveError: string | null;
}

/**
 * Back up now: a snapshot inside the app, plus a full ZIP in the chosen folder
 * and in Drive where those are set up.
 *
 * The three legs are independent on purpose. The in-app snapshot is written
 * first because it is the one that cannot fail for a reason outside the app —
 * no network, no permission, no quota. Once it is on disk the backup has
 * succeeded in the sense that matters, and the other two are improvements. The
 * result says which of them landed so the screen can be specific instead of
 * claiming a clean sweep it did not have.
 */
export async function takeSnapshot(
  appVersion?: string,
  { interactive = false }: { interactive?: boolean } = {},
): Promise<SnapshotResult> {
  await ensureDir();
  const at = Date.now();

  const json = await buildBackup(appVersion);
  const name = snapshotName(at, 'json');
  await FileSystem.writeAsStringAsync(`${BACKUP_DIR}${name}`, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await setSetting(LAST_KEY, String(at));

  const all = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  for (const stale of snapshotsToPrune(all, KEEP_SNAPSHOTS, 'json')) {
    await FileSystem.deleteAsync(`${BACKUP_DIR}${stale}`, { idempotent: true }).catch(() => {});
  }

  let folder = false;
  const folderUri = await getExportFolder();
  if (folderUri) {
    try {
      await writeToFolder(folderUri, at, appVersion);
      folder = true;
    } catch {
      // A folder can be revoked, unmounted or full. The in-app snapshot above
      // already succeeded, so this is a partial success, not a failure.
    }
  }

  let driveOk = false;
  let driveError: string | null = null;
  if (await isDriveOn()) {
    try {
      await writeToDrive(at, interactive, appVersion);
      driveOk = true;
    } catch (e) {
      // Recorded rather than thrown. A Drive upload usually fails when nobody
      // is looking — no signal on the train, the account's storage full — and
      // the whole point of this screen is that such a failure gets said out
      // loud next time it is opened, instead of being discovered a year later.
      driveError = e instanceof Error ? e.message : String(e);
      await setSetting(DRIVE_ERROR_KEY, driveError).catch(() => {});
    }
  }

  return { name, folder, drive: driveOk, driveError };
}

/**
 * Called on every app start. Does nothing unless a schedule is set and the
 * interval has passed — and never throws, because failing to back up must not
 * be the reason the app will not open.
 */
export async function runAutoBackupIfDue(appVersion?: string): Promise<string | null> {
  try {
    const frequency = await getFrequency();
    const days = intervalDaysFor(frequency);
    if (days === 0) return null;
    if (!isBackupDue(await lastBackupAt(), Date.now(), days)) return null;
    return (await takeSnapshot(appVersion)).name;
  } catch {
    return null;
  }
}

export async function backupStatus(): Promise<BackupStatus> {
  const frequency = await getFrequency();
  const lastAt = await lastBackupAt();
  const folderUri = await getExportFolder();

  return {
    frequency,
    lastAt,
    nextAt: nextBackupAt(lastAt, frequency),
    snapshots: await listSnapshots(),
    folderUri,
    folderLabel: folderLabel(folderUri),
    receiptCount: (await listReceiptFiles()).length,
    receiptBytes: await receiptsSize(),
    drive: await driveStatus(),
  };
}

export async function readSnapshot(name: string): Promise<string> {
  return FileSystem.readAsStringAsync(`${BACKUP_DIR}${name}`, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

export async function restoreSnapshot(name: string): Promise<RestoreResult> {
  return restoreBackup(await readSnapshot(name));
}

export async function deleteSnapshot(name: string): Promise<void> {
  await FileSystem.deleteAsync(`${BACKUP_DIR}${name}`, { idempotent: true });
}

export function snapshotUri(name: string): string {
  return `${BACKUP_DIR}${name}`;
}

export { KEEP_SNAPSHOTS, KEEP_IN_FOLDER };
export const KEEP_IN_DRIVE = drive.KEEP_IN_DRIVE;
export const DRIVE_FOLDER_NAME = drive.FOLDER_NAME;
export type { BackupFrequency };
