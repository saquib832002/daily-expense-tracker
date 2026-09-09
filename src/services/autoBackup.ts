/**
 * Automatic backups.
 *
 * Off by default and controlled by one switch, because an app that starts
 * writing files on its own is an app you stop trusting. When it is on, a JSON
 * backup is written into the app's own folder every week, the five most recent
 * are kept, and Android's own backup carries that folder to a new phone
 * without anyone having to remember anything.
 *
 * The folder is the app's private storage: no permission is needed, nothing
 * else on the phone can read it, and uninstalling removes it — which is exactly
 * why "save a backup somewhere you choose" stays on the same screen.
 */
import * as FileSystem from 'expo-file-system';

import { buildBackup, restoreBackup, type RestoreResult } from '@/db/backup';
import { getSetting, setSetting } from '@/db/queries';
import {
  DEFAULT_INTERVAL_DAYS,
  KEEP_SNAPSHOTS,
  isBackupDue,
  snapshotName,
  snapshotsToPrune,
  sortSnapshots,
} from '@/domain/backupSchedule';

export const BACKUP_DIR = `${FileSystem.documentDirectory}backups/`;

const ENABLED_KEY = 'auto_backup';
const LAST_KEY = 'auto_backup_last';

export interface Snapshot {
  name: string;
  at: number;
  size: number;
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(BACKUP_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(BACKUP_DIR, { intermediates: true });
}

export async function isAutoBackupEnabled(): Promise<boolean> {
  return (await getSetting(ENABLED_KEY)) === '1';
}

/**
 * Turn automatic backups on or off.
 * Turning them on takes one immediately, so the switch produces something you
 * can see rather than a promise about next week.
 */
export async function setAutoBackupEnabled(on: boolean, appVersion?: string): Promise<void> {
  await setSetting(ENABLED_KEY, on ? '1' : '0');
  if (on) await takeSnapshot(appVersion);
}

export async function lastBackupAt(): Promise<number | null> {
  const raw = await getSetting(LAST_KEY);
  const n = Number(raw);
  return raw && Number.isFinite(n) ? n : null;
}

/** Every snapshot this app wrote, newest first. Other files are ignored. */
export async function listSnapshots(): Promise<Snapshot[]> {
  await ensureDir();
  const names = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  const ours = sortSnapshots(names);

  const out: Snapshot[] = [];
  for (const s of ours) {
    const info = await FileSystem.getInfoAsync(`${BACKUP_DIR}${s.name}`);
    out.push({ name: s.name, at: s.at, size: info.exists ? (info.size ?? 0) : 0 });
  }
  return out;
}

/** Write a snapshot now and prune the old ones. Returns the file name. */
export async function takeSnapshot(appVersion?: string): Promise<string> {
  await ensureDir();
  const json = await buildBackup(appVersion);
  const name = snapshotName(Date.now());
  await FileSystem.writeAsStringAsync(`${BACKUP_DIR}${name}`, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await setSetting(LAST_KEY, String(Date.now()));

  const all = await FileSystem.readDirectoryAsync(BACKUP_DIR);
  for (const stale of snapshotsToPrune(all, KEEP_SNAPSHOTS)) {
    await FileSystem.deleteAsync(`${BACKUP_DIR}${stale}`, { idempotent: true }).catch(() => {});
  }
  return name;
}

/**
 * Called on every app start. Does nothing unless the switch is on and a week
 * has passed — and never throws, because failing to back up must not be the
 * reason the app will not open.
 */
export async function runAutoBackupIfDue(appVersion?: string): Promise<string | null> {
  try {
    if (!(await isAutoBackupEnabled())) return null;
    if (!isBackupDue(await lastBackupAt(), Date.now(), DEFAULT_INTERVAL_DAYS)) return null;
    return await takeSnapshot(appVersion);
  } catch {
    return null;
  }
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

export { DEFAULT_INTERVAL_DAYS, KEEP_SNAPSHOTS };
