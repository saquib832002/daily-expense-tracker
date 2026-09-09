import { describe, expect, it } from '@jest/globals';
import {
  isBackupDue,
  snapshotName,
  snapshotTime,
  snapshotsToPrune,
  sortSnapshots,
} from '../backupSchedule';

const at = (y: number, m: number, d: number, h = 9, mi = 0) =>
  new Date(y, m - 1, d, h, mi).getTime();

describe('isBackupDue', () => {
  it('is due when nothing has ever been backed up', () => {
    expect(isBackupDue(null, at(2026, 8, 15))).toBe(true);
  });

  it('is not due the same day', () => {
    expect(isBackupDue(at(2026, 8, 15, 9), at(2026, 8, 15, 23))).toBe(false);
  });

  it('is due after the interval', () => {
    expect(isBackupDue(at(2026, 8, 1), at(2026, 8, 8))).toBe(true);
    expect(isBackupDue(at(2026, 8, 1), at(2026, 8, 7))).toBe(false);
  });

  it('compares whole days, so a late backup does not drift later each week', () => {
    // Taken at 9pm; a week later at 8am is still seven days and must fire.
    expect(isBackupDue(at(2026, 8, 1, 21), at(2026, 8, 8, 8))).toBe(true);
  });

  it('does not get stuck when the clock moves backwards', () => {
    expect(isBackupDue(at(2026, 8, 15), at(2026, 8, 1))).toBe(true);
  });

  it('respects a custom interval', () => {
    expect(isBackupDue(at(2026, 8, 1), at(2026, 8, 2), 1)).toBe(true);
    expect(isBackupDue(at(2026, 8, 1), at(2026, 8, 20), 30)).toBe(false);
  });
});

describe('snapshotName / snapshotTime', () => {
  it('round-trips to the minute', () => {
    const when = at(2026, 8, 15, 21, 5);
    expect(snapshotTime(snapshotName(when))).toBe(when);
  });

  it('sorts chronologically as plain text', () => {
    const a = snapshotName(at(2026, 8, 9));
    const b = snapshotName(at(2026, 8, 10));
    expect(a < b).toBe(true);
  });

  it('refuses to claim files it did not write', () => {
    expect(snapshotTime('my-own-backup.json')).toBeNull();
    expect(snapshotTime('auto-2026-08-15.json')).toBeNull();
    expect(snapshotTime('expense-backup-20260815-2105.json')).toBeNull();
  });
});

describe('snapshotsToPrune', () => {
  const names = [
    snapshotName(at(2026, 8, 1)),
    snapshotName(at(2026, 8, 8)),
    snapshotName(at(2026, 8, 15)),
    snapshotName(at(2026, 8, 22)),
    snapshotName(at(2026, 8, 29)),
    snapshotName(at(2026, 9, 5)),
  ];

  it('keeps the newest and prunes the rest', () => {
    const pruned = snapshotsToPrune(names, 5);
    expect(pruned).toEqual([snapshotName(at(2026, 8, 1))]);
  });

  it('prunes nothing when under the limit', () => {
    expect(snapshotsToPrune(names.slice(0, 3), 5)).toEqual([]);
  });

  it('never touches a file it did not create', () => {
    const withUserFile = [...names, 'my-own-backup.json', 'expenses.csv'];
    const pruned = snapshotsToPrune(withUserFile, 1);
    expect(pruned).not.toContain('my-own-backup.json');
    expect(pruned).not.toContain('expenses.csv');
    expect(pruned).toHaveLength(5);
  });
});

describe('sortSnapshots', () => {
  it('returns ours newest first, ignoring anything else', () => {
    const out = sortSnapshots([
      snapshotName(at(2026, 8, 1)),
      'notes.txt',
      snapshotName(at(2026, 8, 20)),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.at).toBeGreaterThan(out[1]!.at);
  });
});
