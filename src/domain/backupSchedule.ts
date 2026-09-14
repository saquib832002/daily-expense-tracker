/**
 * When to take an automatic backup, and which old ones to throw away.
 *
 * Kept as pure functions because "did it silently stop backing up?" and "did it
 * delete the wrong snapshot?" are exactly the questions you cannot answer by
 * looking at a screen. They can be answered by tests.
 */

import { startOfDay } from './dates';

export const DEFAULT_INTERVAL_DAYS = 7;

/** How often the app should back itself up. */
export type BackupFrequency = 'off' | 'daily' | 'weekly';

/** Days between backups. Zero means never. */
export function intervalDaysFor(frequency: BackupFrequency): number {
  return frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 0;
}

/**
 * When the next backup falls due, or null when there is nothing scheduled.
 * Whole days from the last one, so the answer is a date rather than a moment —
 * which is what a person wants to be told.
 */
export function nextBackupAt(
  lastAt: number | null,
  frequency: BackupFrequency,
  now = Date.now(),
): number | null {
  const days = intervalDaysFor(frequency);
  if (days === 0) return null;
  if (lastAt === null || lastAt > now) return now;
  return startOfDay(lastAt) + days * 86400000;
}
/** How many automatic snapshots to keep. Older ones are deleted. */
export const KEEP_SNAPSHOTS = 5;

/**
 * Is a backup due?
 *
 * Compares whole days rather than exact timestamps, so a weekly backup taken at
 * 9pm does not drift later every week until it never fires on the day someone
 * actually opens the app.
 */
export function isBackupDue(
  lastAt: number | null,
  now: number,
  intervalDays = DEFAULT_INTERVAL_DAYS,
): boolean {
  if (lastAt === null) return true; // never backed up — do it now
  if (lastAt > now) return true; // clock moved backwards; don't get stuck
  const days = Math.floor((startOfDay(now) - startOfDay(lastAt)) / 86400000);
  return days >= intervalDays;
}

/** File name for a snapshot. Sorts chronologically as plain text. */
export function snapshotName(at: number, extension: 'json' | 'zip' = 'json'): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `auto-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}.${extension}`;
}

/** Epoch ms encoded in a snapshot name, or null if it isn't one of ours. */
export function snapshotTime(name: string, extension?: 'json' | 'zip'): number | null {
  const suffix = extension ?? '(json|zip)';
  const m = name.match(new RegExp(`^auto-(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})\\.${suffix}$`));
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const date = new Date(y!, mo! - 1, d!, h!, mi!);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * Given every file in the backup folder, decide what to delete.
 * Only ever returns names this app created — a user's own file dropped in that
 * folder is never touched.
 */
export function snapshotsToPrune(
  names: string[],
  keep = KEEP_SNAPSHOTS,
  extension?: 'json' | 'zip',
): string[] {
  const ours = names
    .map((name) => ({ name, at: snapshotTime(name, extension) }))
    .filter((x): x is { name: string; at: number } => x.at !== null)
    .sort((a, b) => b.at - a.at);

  return ours.slice(keep).map((x) => x.name);
}

/** Snapshots newest first, for showing in the UI. */
export function sortSnapshots(
  names: string[],
  extension?: 'json' | 'zip',
): { name: string; at: number }[] {
  return names
    .map((name) => ({ name, at: snapshotTime(name, extension) }))
    .filter((x): x is { name: string; at: number } => x.at !== null)
    .sort((a, b) => b.at - a.at);
}
