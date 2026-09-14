/**
 * Pruning is the only part of Drive backup that deletes anything, so it is the
 * only part that can lose data rather than merely fail to save it. The Drive
 * client reuses `snapshotsToPrune` for exactly that reason — the rule that
 * decides what to delete from someone's Google account is the same one already
 * covered by tests, rather than a second implementation written against a
 * network API that cannot be tested here.
 *
 * These cases are the ones specific to the Drive folder: it is a real folder in
 * a real person's Drive, so it will contain things this app did not put there.
 */
import { describe, expect, it } from '@jest/globals';

import { snapshotsToPrune, sortSnapshots } from '../backupSchedule';

const KEEP_IN_DRIVE = 5;

function generated(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `auto-2026090${(i % 9) + 1}-0${i % 10}00.zip`);
}

describe('pruning the Drive folder', () => {
  it('keeps the newest N and deletes the rest', () => {
    const names = [
      'auto-20260901-1000.zip',
      'auto-20260902-1000.zip',
      'auto-20260903-1000.zip',
      'auto-20260904-1000.zip',
      'auto-20260905-1000.zip',
      'auto-20260906-1000.zip',
      'auto-20260907-1000.zip',
    ];
    const stale = snapshotsToPrune(names, KEEP_IN_DRIVE, 'zip');
    expect(stale).toEqual(['auto-20260902-1000.zip', 'auto-20260901-1000.zip']);
  });

  it('never touches a file the user put in that folder themselves', () => {
    // The whole risk of writing into someone's Drive: their own files are
    // sitting right there next to ours.
    const names = [
      ...generated(8),
      'Tax return 2025.pdf',
      'auto-backup-notes.txt',
      'auto-2026.zip',
      'holiday.jpg',
    ];
    const stale = snapshotsToPrune(names, KEEP_IN_DRIVE, 'zip');

    expect(stale).not.toContain('Tax return 2025.pdf');
    expect(stale).not.toContain('auto-backup-notes.txt');
    expect(stale).not.toContain('holiday.jpg');
    // Close enough to our pattern to be worth an explicit assertion: it lacks
    // the time half, so it is not one of ours and must survive.
    expect(stale).not.toContain('auto-2026.zip');
    expect(stale.every((n) => /^auto-\d{8}-\d{4}\.zip$/.test(n))).toBe(true);
  });

  it('ignores the local JSON snapshots, which live somewhere else entirely', () => {
    const names = [
      'auto-20260901-1000.json',
      'auto-20260902-1000.json',
      'auto-20260903-1000.zip',
      'auto-20260904-1000.zip',
    ];
    expect(snapshotsToPrune(names, 1, 'zip')).toEqual(['auto-20260903-1000.zip']);
  });

  it('deletes nothing when the folder holds fewer than the keep count', () => {
    expect(snapshotsToPrune(generated(3), KEEP_IN_DRIVE, 'zip')).toEqual([]);
    expect(snapshotsToPrune([], KEEP_IN_DRIVE, 'zip')).toEqual([]);
  });

  it('orders by the time in the name, not the order Drive returned them', () => {
    // Drive is asked for `orderBy=name desc`, but a page boundary or a rename
    // can still hand back a different order. Sorting must not trust it.
    const shuffled = [
      'auto-20260903-0900.zip',
      'auto-20260901-2300.zip',
      'auto-20260903-1800.zip',
      'auto-20260902-0700.zip',
    ];
    expect(sortSnapshots(shuffled, 'zip').map((s) => s.name)).toEqual([
      'auto-20260903-1800.zip',
      'auto-20260903-0900.zip',
      'auto-20260902-0700.zip',
      'auto-20260901-2300.zip',
    ]);
  });

  it('keeps the newest when asked to keep exactly one', () => {
    const stale = snapshotsToPrune(
      ['auto-20260901-1000.zip', 'auto-20260905-1000.zip', 'auto-20260903-1000.zip'],
      1,
      'zip',
    );
    expect(stale).toEqual(['auto-20260903-1000.zip', 'auto-20260901-1000.zip']);
  });
});
