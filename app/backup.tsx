import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native';

import {
  buildBackup,
  countAllRows,
  exportTransactionsCsv,
  importTransactionsCsv,
  restoreBackup,
} from '@/db/backup';
import { formatDate, t } from '@/i18n';
import {
  DEFAULT_INTERVAL_DAYS,
  KEEP_SNAPSHOTS,
  deleteSnapshot,
  isAutoBackupEnabled,
  listSnapshots,
  restoreSnapshot,
  setAutoBackupEnabled,
  snapshotUri,
  takeSnapshot,
  type Snapshot,
} from '@/services/autoBackup';
import { buildBackupZip, restoreBackupZip } from '@/db/backupZip';
import { copyDatabaseForExport, restoreFromDatabaseFile } from '@/services/dbFile';
import { listReceiptFiles } from '@/services/receipts';
import {
  pickFile,
  pickTextFile,
  shareExistingFile,
  shareText,
  suggestedName,
} from '@/services/files';
import { space, type, useTheme } from '@/theme';
import { Button, Card, EmptyState, ListRow, RowGroup, Screen, SectionLabel } from '@/ui';

/**
 * Your data, in your hands.
 *
 * Three separate jobs, deliberately kept apart, because confusing them is how
 * people lose data:
 *   - CSV is for reading your spending in a spreadsheet. It cannot restore
 *     budgets, rules or categories.
 *   - The backup file is for moving everything to a new phone. The ZIP is the
 *     complete one — it carries the receipt photos too; the JSON and the .db
 *     carry only the ledger.
 *   - Automatic backups are the copy you did not remember to make.
 */
export default function BackupScreen() {
  const theme = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [receiptCount, setReceiptCount] = useState(0);

  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

  const refresh = useCallback(async () => {
    setAutoOn(await isAutoBackupEnabled());
    setSnapshots(await listSnapshots());
    setReceiptCount((await listReceiptFiles()).length);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = useCallback(
    async (job: string, fn: () => Promise<string | null>) => {
      setBusy(job);
      setMessage(null);
      try {
        setMessage(await fn());
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh],
  );

  /* ------------------------------------------------------------------ CSV */

  const exportCsv = useCallback(
    () =>
      run('csv', async () => {
        const csv = await exportTransactionsCsv(t);
        const res = await shareText(suggestedName('expenses', 'csv'), csv, 'text/csv');
        return res.ok ? t('backup.csvShared') : t('backup.shareFailed');
      }),
    [run],
  );

  const importCsv = useCallback(
    () =>
      run('importCsv', async () => {
        const text = await pickTextFile();
        if (text == null) return null;
        const res = await importTransactionsCsv(text, t);
        return t('backup.imported', { imported: res.imported, skipped: res.skipped });
      }),
    [run],
  );

  /* --------------------------------------------------------- full backups */

  const exportBackup = useCallback(
    () =>
      run('backup', async () => {
        const json = await buildBackup(appVersion);
        const res = await shareText(
          suggestedName('expense-backup', 'json'),
          json,
          'application/json',
        );
        return res.ok ? t('backup.backupShared') : t('backup.shareFailed');
      }),
    [run, appVersion],
  );

  const exportDb = useCallback(
    () =>
      run('db', async () => {
        const uri = await copyDatabaseForExport(suggestedName('expense-backup', 'db'));
        const res = await shareExistingFile(uri, 'application/octet-stream');
        return res.ok ? t('backup.dbShared') : t('backup.shareFailed');
      }),
    [run],
  );

  const confirmReplace = useCallback(
    async (onConfirm: () => void) => {
      const existing = await countAllRows();
      Alert.alert(t('backup.restoreTitle'), t('backup.restoreBody', { rows: existing }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('backup.restoreConfirm'), style: 'destructive', onPress: onConfirm },
      ]);
    },
    [],
  );

  const exportZip = useCallback(
    () =>
      run('zip', async () => {
        const { uri, receipts } = await buildBackupZip(
          suggestedName('expense-backup', 'zip'),
          appVersion,
        );
        const res = await shareExistingFile(uri, 'application/zip');
        return res.ok ? t('backup.zipShared', { receipts }) : t('backup.shareFailed');
      }),
    [run, appVersion],
  );

  const doRestoreZip = useCallback(async () => {
    const picked = await pickFile(['application/zip', '*/*']);
    if (picked == null) return;
    confirmReplace(() =>
      run('restoreZip', async () => {
        const res = await restoreBackupZip(picked.uri);
        if (!res.ok) {
          const known = ['notZip', 'notOurs', 'notJson', 'tooNew'];
          return known.includes(res.error ?? '')
            ? t(`backup.error.${res.error}`)
            : (res.error ?? t('backup.error.notOurs'));
        }
        const total = Object.values(res.counts ?? {}).reduce((a, b) => a + b, 0);
        return t('backup.restoredZip', { rows: total, receipts: res.receipts ?? 0 });
      }),
    );
  }, [run, confirmReplace]);

  const doRestoreJson = useCallback(async () => {
    const text = await pickTextFile(['application/json', '*/*']);
    if (text == null) return;
    confirmReplace(() =>
      run('restore', async () => {
        const res = await restoreBackup(text);
        if (!res.ok) return t(`backup.error.${res.error ?? 'notOurs'}`);
        const total = Object.values(res.counts ?? {}).reduce((a, b) => a + b, 0);
        return t('backup.restored', { rows: total });
      }),
    );
  }, [run, confirmReplace]);

  const doRestoreDb = useCallback(async () => {
    const picked = await pickFile(['application/octet-stream', 'application/x-sqlite3', '*/*']);
    if (picked == null) return;
    confirmReplace(() =>
      run('restoreDb', async () => {
        const res = await restoreFromDatabaseFile(picked.uri);
        if (!res.ok) {
          const known = ['notDb', 'notOurs', 'notJson', 'tooNew'];
          return known.includes(res.error ?? '')
            ? t(`backup.error.${res.error}`)
            : (res.error ?? t('backup.error.notOurs'));
        }
        const total = Object.values(res.counts ?? {}).reduce((a, b) => a + b, 0);
        return t('backup.restored', { rows: total });
      }),
    );
  }, [run, confirmReplace]);

  /* ------------------------------------------------------------ automatic */

  const toggleAuto = useCallback(
    async (on: boolean) => {
      setAutoOn(on);
      await run('auto', async () => {
        await setAutoBackupEnabled(on, appVersion);
        return on ? t('backup.autoOnMessage') : t('backup.autoOffMessage');
      });
    },
    [run, appVersion],
  );

  const backupNow = useCallback(
    () =>
      run('now', async () => {
        await takeSnapshot(appVersion);
        return t('backup.snapshotTaken');
      }),
    [run, appVersion],
  );

  const openSnapshot = useCallback(
    (snap: Snapshot) => {
      Alert.alert(formatDate(snap.at, 'long'), t('backup.snapshotSize', { kb: kb(snap.size) }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('backup.snapshotShare'),
          onPress: () =>
            run('shareSnap', async () => {
              const res = await shareExistingFile(snapshotUri(snap.name), 'application/json');
              return res.ok ? t('backup.backupShared') : t('backup.shareFailed');
            }),
        },
        {
          text: t('backup.snapshotDelete'),
          style: 'destructive',
          onPress: () =>
            run('deleteSnap', async () => {
              await deleteSnapshot(snap.name);
              return t('backup.snapshotDeleted');
            }),
        },
        {
          text: t('backup.restoreConfirm'),
          style: 'destructive',
          onPress: () =>
            confirmReplace(() =>
              run('restoreSnap', async () => {
                const res = await restoreSnapshot(snap.name);
                if (!res.ok) return t(`backup.error.${res.error ?? 'notOurs'}`);
                const total = Object.values(res.counts ?? {}).reduce((a, b) => a + b, 0);
                return t('backup.restored', { rows: total });
              }),
            ),
        },
      ]);
    },
    [run, confirmReplace],
  );

  return (
    <Screen title={t('more.backup')} back>
      <Card>
        <SectionLabel>{t('backup.spreadsheet')}</SectionLabel>
        <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.csvHint')}</Text>
        <Button label={t('backup.exportCsv')} onPress={exportCsv} disabled={busy !== null} />
        <Button
          label={t('backup.importCsv')}
          variant="secondary"
          onPress={importCsv}
          disabled={busy !== null}
        />
      </Card>

      <Card>
        <SectionLabel>{t('backup.newPhone')}</SectionLabel>
        <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.backupHint')}</Text>

        <Text style={[styles.body, { color: theme.text }]}>
          {receiptCount > 0
            ? t('backup.zipHintWithReceipts', { receipts: receiptCount })
            : t('backup.zipHint')}
        </Text>
        <Button label={t('backup.exportZip')} onPress={exportZip} disabled={busy !== null} />
        <Button
          label={t('backup.restoreZip')}
          variant="secondary"
          onPress={doRestoreZip}
          disabled={busy !== null}
        />

        <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.jsonHint')}</Text>
        <Button
          label={t('backup.exportBackup')}
          variant="secondary"
          onPress={exportBackup}
          disabled={busy !== null}
        />
        <Button
          label={t('backup.restore')}
          variant="secondary"
          onPress={doRestoreJson}
          disabled={busy !== null}
        />

        <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.dbHint')}</Text>
        <Button
          label={t('backup.exportDb')}
          variant="secondary"
          onPress={exportDb}
          disabled={busy !== null}
        />
        <Button
          label={t('backup.restoreDb')}
          variant="secondary"
          onPress={doRestoreDb}
          disabled={busy !== null}
        />

        <Text style={[styles.warn, { color: theme.warn }]}>{t('backup.restoreWarning')}</Text>
      </Card>

      <Card>
        <SectionLabel>{t('backup.automatic')}</SectionLabel>
        <View style={styles.switchRow}>
          <Text style={[styles.switchLabel, { color: theme.text }]}>{t('backup.autoTitle')}</Text>
          <Switch
            value={autoOn}
            onValueChange={toggleAuto}
            disabled={busy !== null}
            trackColor={{ true: theme.accent, false: theme.border }}
          />
        </View>
        <Text style={[styles.body, { color: theme.textDim }]}>
          {t('backup.autoHint', { days: DEFAULT_INTERVAL_DAYS, keep: KEEP_SNAPSHOTS })}
        </Text>
        <Button
          label={t('backup.backupNow')}
          variant="secondary"
          onPress={backupNow}
          disabled={busy !== null}
        />
      </Card>

      <SectionLabel>{t('backup.snapshots')}</SectionLabel>
      {snapshots.length === 0 ? (
        <EmptyState text={t('backup.noSnapshots')} />
      ) : (
        <RowGroup>
          {snapshots.map((snap, i) => (
            <ListRow
              key={snap.name}
              icon="🗂️"
              title={formatDate(snap.at, 'long')}
              subtitle={timeOf(snap.at)}
              value={`${kb(snap.size)} KB`}
              chevron
              last={i === snapshots.length - 1}
              onPress={() => openSnapshot(snap)}
            />
          ))}
        </RowGroup>
      )}

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={theme.accent} />
          <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.working')}</Text>
        </View>
      ) : null}

      {message ? (
        <Card>
          <Text style={{ color: theme.text, fontSize: type.body }}>{message}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function kb(bytes: number): string {
  return String(Math.max(1, Math.round(bytes / 1024)));
}

function timeOf(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  body: { fontSize: type.small, lineHeight: 19 },
  warn: { fontSize: type.small, lineHeight: 19 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.md, justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchLabel: { fontSize: type.body, fontWeight: '500' },
});
