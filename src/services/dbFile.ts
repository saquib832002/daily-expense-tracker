/**
 * The database file itself, as a backup format.
 *
 * The JSON backup is the readable one — you can open it in any text editor in
 * ten years and see your data. This is the other kind: a byte-for-byte copy of
 * the SQLite file, which is what you want when the JSON writer itself is what
 * you distrust. Two formats that fail in different ways is the whole point;
 * a single backup format is a single point of failure.
 *
 * Export is a file copy. Import deliberately is NOT: overwriting the live
 * database file underneath a running app leaves every open handle pointing at
 * freed pages. Instead the picked file is opened as a second database and its
 * rows are copied across with ATTACH, so the app never has to be restarted and
 * a bad file can be rejected before anything is deleted.
 */
import * as FileSystem from 'expo-file-system';

import { TABLE_NAMES } from '@/db/backup';
import { sqlite } from '@/db/client';

/** Where expo-sqlite keeps databases. */
const SQLITE_DIR = `${FileSystem.documentDirectory}SQLite/`;
const DB_NAME = 'expense.db';

/** First 16 bytes of every SQLite file: "SQLite format 3\0". */
const SQLITE_MAGIC_B64 = 'U1FMaXRlIGZvcm1hdCAzAA==';

export interface DbRestoreResult {
  ok: boolean;
  error?: string;
  counts?: Record<string, number>;
}

/**
 * Fold the write-ahead log back into the main file.
 *
 * Without this the copy can be missing everything written since the last
 * checkpoint — which on a phone is usually "today". A backup that silently
 * loses the most recent day is worse than no backup, because it is trusted.
 */
async function checkpoint(): Promise<void> {
  try {
    await sqlite.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Not fatal: a database not in WAL mode has nothing to checkpoint.
  }
}

/** A consistent copy of the database in the cache, ready to be shared. */
export async function copyDatabaseForExport(filename: string): Promise<string> {
  await checkpoint();
  const target = `${FileSystem.cacheDirectory}${filename}`;
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists) await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.copyAsync({ from: `${SQLITE_DIR}${DB_NAME}`, to: target });
  return target;
}

/** SQLite wants a plain path; the picker hands back a file:// URI. */
function toPath(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ''));
}

async function looksLikeSqlite(uri: string): Promise<boolean> {
  try {
    const head = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 16,
    });
    return head.startsWith(SQLITE_MAGIC_B64.slice(0, 20));
  } catch {
    return false;
  }
}

/**
 * Replace everything with the contents of a `.db` file.
 *
 * Destructive, like the JSON restore, and for the same reason: merging would
 * silently duplicate every row for anyone restoring onto a phone that already
 * has data.
 */
export async function restoreFromDatabaseFile(uri: string): Promise<DbRestoreResult> {
  if (!(await looksLikeSqlite(uri))) return { ok: false, error: 'notDb' };

  const staging = `${SQLITE_DIR}import-${Date.now()}.db`;
  await FileSystem.makeDirectoryAsync(SQLITE_DIR, { intermediates: true }).catch(() => {});
  await FileSystem.copyAsync({ from: uri, to: staging });

  const path = toPath(staging).replace(/'/g, "''");
  let attached = false;

  try {
    await sqlite.execAsync(`ATTACH DATABASE '${path}' AS src;`);
    attached = true;

    // Is this actually one of ours? Check before deleting anything.
    const present = await sqlite.getAllAsync<{ name: string }>(
      `SELECT name FROM src.sqlite_master WHERE type = 'table'`,
    );
    const names = new Set(present.map((r) => r.name));
    const missing = TABLE_NAMES.filter((n) => !names.has(n));
    if (missing.length > 0) return { ok: false, error: 'notOurs' };

    // Copy column by column rather than `SELECT *`, so a file from an older
    // version of the app — with fewer columns — still restores, with the new
    // columns taking their defaults.
    const columns: Record<string, string[]> = {};
    for (const table of TABLE_NAMES) {
      const [src, main] = await Promise.all([
        sqlite.getAllAsync<{ name: string }>(`PRAGMA src.table_info("${table}")`),
        sqlite.getAllAsync<{ name: string }>(`PRAGMA main.table_info("${table}")`),
      ]);
      const mainNames = new Set(main.map((c) => c.name));
      columns[table] = src.map((c) => c.name).filter((c) => mainNames.has(c));
    }

    const counts: Record<string, number> = {};

    await sqlite.withTransactionAsync(async () => {
      // Delete children before parents, insert parents before children.
      for (const table of [...TABLE_NAMES].reverse()) {
        await sqlite.execAsync(`DELETE FROM main."${table}";`);
      }
      for (const table of TABLE_NAMES) {
        const cols = columns[table] ?? [];
        if (cols.length === 0) {
          counts[table] = 0;
          continue;
        }
        const list = cols.map((c) => `"${c}"`).join(', ');
        await sqlite.execAsync(
          `INSERT INTO main."${table}" (${list}) SELECT ${list} FROM src."${table}";`,
        );
        const row = await sqlite.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) AS n FROM main."${table}"`,
        );
        counts[table] = row?.n ?? 0;
      }
    });

    return { ok: true, counts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (attached) {
      await sqlite.execAsync('DETACH DATABASE src;').catch(() => {});
    }
    await FileSystem.deleteAsync(staging, { idempotent: true }).catch(() => {});
  }
}
