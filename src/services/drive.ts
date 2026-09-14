/**
 * Backup copies in the user's own Google Drive.
 *
 * This is the third and last destination, and the only one that survives every
 * disaster at once. The other two each have a hole:
 *
 *   - Android's own backup is free and automatic, but it caps at 25 MB, holds
 *     only the newest copy, and vanishes if the app is uninstalled.
 *   - The folder on the phone holds everything including photos, but it is on
 *     the phone, and phones are the thing that gets lost.
 *
 * A ZIP in Drive has neither hole. It is why this file exists.
 *
 * Two decisions worth stating, because both look like corners cut:
 *
 * **Only the `drive.file` scope.** The app can see the files it creates and
 * absolutely nothing else the user owns — not their documents, not their
 * photos, not even the rest of the folder it writes into. That is also why the
 * folder id is remembered in settings: with this scope the app genuinely cannot
 * find a folder it did not make, so losing the id means making a new folder
 * rather than silently writing into a stranger's.
 *
 * **Resumable upload rather than multipart.** Multipart would mean holding the
 * whole ZIP in memory as a base64 string — for a few hundred receipts that is
 * tens of megabytes of JavaScript string, on a phone, next to the ZIP it was
 * copied from. The resumable session URI lets `FileSystem.uploadAsync` stream
 * the file off disk instead, and it survives a dropped connection.
 */
import * as FileSystem from 'expo-file-system';

import {
  DEVELOPER_ERROR,
  authorize,
  authorizeSilently,
  isAvailable,
  signingInfo,
  type AuthResult,
  type SigningInfo,
} from '../../modules/google-drive-auth';
import { snapshotsToPrune } from '@/domain/backupSchedule';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Shown in the user's Drive. Named for a person browsing, not for a machine. */
export const FOLDER_NAME = 'Expense Tracker Backups';

/** How many copies to keep up there. Drive is roomy, but not a landfill. */
export const KEEP_IN_DRIVE = 5;

export interface DriveFile {
  id: string;
  name: string;
  size: number | null;
}

/** Something Drive said no to, carrying enough detail to act on. */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

export { DEVELOPER_ERROR, isAvailable, signingInfo };
export type { AuthResult, SigningInfo };

/* ----------------------------------------------------------------- requests */

async function api(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(`${DRIVE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });

  if (!res.ok) {
    // Drive's error bodies are JSON, but a proxy or a captive portal can return
    // HTML here. Reading as text first means a login page never becomes an
    // unhandled parse error three frames up.
    const body = await res.text().catch(() => '');
    throw new DriveError(driveMessage(body, res.status), res.status);
  }

  if (res.status === 204) return {};
  return (await res.json()) as Record<string, unknown>;
}

/** Pull the human-readable half out of whatever Drive returned. */
function driveMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // not JSON — fall through
  }
  return `Google Drive returned ${status}`;
}

/* -------------------------------------------------------------------- token */

/**
 * A token attempt, with the reason attached when there is no token.
 * The caller decides what to say; this layer never flattens the outcome away.
 */
export async function getToken(interactive: boolean): Promise<AuthResult> {
  return interactive ? authorize() : authorizeSilently();
}

/* ------------------------------------------------------------------- folder */

/** Does this folder id still exist and still belong to us? */
export async function folderExists(token: string, id: string): Promise<boolean> {
  try {
    const file = await api(token, `/files/${id}?fields=id,trashed`);
    return file.trashed !== true;
  } catch (e) {
    if (e instanceof DriveError && (e.status === 404 || e.status === 403)) return false;
    throw e;
  }
}

/**
 * Find the folder this app made last time, or make it.
 *
 * The search is scoped to folders this app created, because that is all the
 * `drive.file` scope can see. If the user moved or renamed it, this makes a new
 * one rather than hunting — a second folder is a small annoyance, and the
 * alternative is an app that goes looking around someone's Drive.
 */
export async function findOrCreateFolder(token: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='${FOLDER_MIME}' and name='${FOLDER_NAME}' and trashed=false`,
  );
  const found = await api(token, `/files?q=${q}&fields=files(id)&pageSize=1`);
  const files = (found.files ?? []) as { id?: string }[];
  const existing = files[0]?.id;
  if (existing) return existing;

  const created = await api(token, '/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  const id = created.id;
  if (typeof id !== 'string') throw new DriveError('Drive did not return a folder id', 0);
  return id;
}

/* ------------------------------------------------------------------- upload */

/**
 * Upload a file already on disk into the folder, streaming it rather than
 * loading it. Returns the new file's id.
 */
export async function uploadFile(
  token: string,
  folderId: string,
  fileUri: string,
  name: string,
  mimeType = 'application/zip',
): Promise<string> {
  // Step one: open a resumable session. The response carries no body worth
  // reading — the thing we need is the Location header.
  const start = await fetch(`${UPLOAD}?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
    },
    body: JSON.stringify({ name, parents: [folderId], mimeType }),
  });

  if (!start.ok) {
    const body = await start.text().catch(() => '');
    throw new DriveError(driveMessage(body, start.status), start.status);
  }

  const session = start.headers.get('location') ?? start.headers.get('Location');
  if (!session) throw new DriveError('Drive did not open an upload session', 0);

  // Step two: send the bytes straight from the filesystem.
  const done = await FileSystem.uploadAsync(session, fileUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': mimeType },
  });

  if (done.status < 200 || done.status >= 300) {
    throw new DriveError(driveMessage(done.body ?? '', done.status), done.status);
  }

  try {
    const parsed = JSON.parse(done.body ?? '{}') as { id?: string };
    return parsed.id ?? '';
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------ list and tidy */

/** The backups this app has put in that folder, newest first. */
export async function listBackups(token: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await api(
    token,
    `/files?q=${q}&fields=files(id,name,size)&orderBy=name desc&pageSize=100`,
  );
  const files = (res.files ?? []) as { id?: string; name?: string; size?: string }[];

  return files
    .filter((f): f is { id: string; name: string; size?: string } =>
      typeof f.id === 'string' && typeof f.name === 'string',
    )
    .map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size != null ? Number(f.size) : null,
    }));
}

/**
 * Delete copies beyond the keep count.
 *
 * Reuses the same pruning rule as the local folder, which only ever matches
 * names this app generated. A file the user dropped into that folder themselves
 * is invisible to it, so it cannot be deleted by accident.
 */
export async function pruneBackups(
  token: string,
  folderId: string,
  keep = KEEP_IN_DRIVE,
): Promise<number> {
  const files = await listBackups(token, folderId);
  const stale = new Set(snapshotsToPrune(files.map((f) => f.name), keep, 'zip'));

  let removed = 0;
  for (const file of files) {
    if (!stale.has(file.name)) continue;
    try {
      await api(token, `/files/${file.id}`, { method: 'DELETE' });
      removed += 1;
    } catch {
      // Failing to delete an old backup is not a reason to report that the new
      // one failed. It did not.
    }
  }
  return removed;
}

export interface DriveAccount {
  name: string | null;
  email: string | null;
  /** Profile picture URL, or null. */
  photo: string | null;
}

/**
 * Who is connected.
 *
 * Worth knowing that this needs NO extra permission. `about.get` accepts the
 * `drive.file` scope the app already holds, so the connected account's name and
 * address come back from the token we have. The alternative — asking for
 * `openid email profile` through Credential Manager — would mean a second
 * native sign-in API, a second entry on the consent screen, and a user being
 * asked for their identity by an app that has no use for it beyond printing it
 * back at them. This way the app shows whose Drive it is writing to and learns
 * nothing it did not already need.
 */
export async function getAccount(token: string): Promise<DriveAccount> {
  try {
    const about = await api(token, '/about?fields=user(displayName,emailAddress,photoLink)');
    const user = about.user as
      | { displayName?: string; emailAddress?: string; photoLink?: string }
      | undefined;
    return {
      name: user?.displayName ?? null,
      email: user?.emailAddress ?? null,
      photo: user?.photoLink ?? null,
    };
  } catch {
    // Never worth failing a connection over. A connected account with no name
    // shown is a cosmetic loss; a failed connection is not.
    return { name: null, email: null, photo: null };
  }
}

/** Free bytes in the account, when Drive will say. Null when it won't. */
export async function remainingSpace(token: string): Promise<number | null> {
  try {
    const about = await api(token, '/about?fields=storageQuota');
    const quota = about.storageQuota as { limit?: string; usage?: string } | undefined;
    if (!quota?.limit || !quota.usage) return null;
    return Math.max(0, Number(quota.limit) - Number(quota.usage));
  } catch {
    return null;
  }
}
