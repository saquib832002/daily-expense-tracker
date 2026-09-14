import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';

import {
  buildBackup,
  countAllRows,
  exportTransactionsCsv,
  importTransactionsCsv,
  restoreBackup,
} from '@/db/backup';
import { buildBackupZip, restoreBackupZip } from '@/db/backupZip';
import { formatDate, t } from '@/i18n';
import {
  DRIVE_FOLDER_NAME,
  KEEP_IN_DRIVE,
  driveSigningInfo,
  KEEP_IN_FOLDER,
  KEEP_SNAPSHOTS,
  backupStatus,
  chooseExportFolder,
  connectDrive,
  deleteSnapshot,
  disconnectDrive,
  forgetExportFolder,
  restoreSnapshot,
  setFrequency,
  snapshotUri,
  takeSnapshot,
  type BackupFrequency,
  type BackupStatus,
} from '@/services/autoBackup';
import type { SigningInfo } from '@/services/drive';
import { copyDatabaseForExport, restoreFromDatabaseFile } from '@/services/dbFile';
import {
  pickFile,
  pickTextFile,
  shareExistingFile,
  shareText,
  suggestedName,
} from '@/services/files';
import { radius, space, type, useTheme } from '@/theme';
import { Button, Card, Chip, EmptyState, ListRow, RowGroup, Screen, SectionLabel } from '@/ui';

const FREQUENCIES: BackupFrequency[] = ['off', 'daily', 'weekly'];

/**
 * Your data, in your hands — and a screen that says so in words.
 *
 * The hard part of a backup screen is not the buttons, it is that nobody can
 * tell what is protected against what. So this one is organised by the
 * disaster rather than by the mechanism: what happens if you get a new phone,
 * if you delete a month by mistake, if you uninstall the app. Each answer says
 * where the file goes and whether the bill photos are in it, because those are
 * the two things people actually want to know and neither is guessable.
 */
export default function BackupScreen() {
  const theme = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  /**
   * Set only when Google rejected this build's signature. Holding it in state
   * rather than showing it always is deliberate: the fingerprint is meaningless
   * noise until the moment it is the answer.
   */
  const [diagnosis, setDiagnosis] = useState<SigningInfo | null>(null);

  const appVersion = Constants.expoConfig?.version ?? '0.1.0';

  const refresh = useCallback(async () => {
    setStatus(await backupStatus());
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

  const working = busy !== null;

  /* --------------------------------------------------------- what it holds */

  const confirmReplace = useCallback(async (onConfirm: () => void) => {
    const existing = await countAllRows();
    Alert.alert(t('backup.restoreTitle'), t('backup.restoreBody', { rows: existing }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('backup.restoreConfirm'), style: 'destructive', onPress: onConfirm },
    ]);
  }, []);

  /* ------------------------------------------------------------- automatic */

  const changeFrequency = useCallback(
    (frequency: BackupFrequency) =>
      run('frequency', async () => {
        await setFrequency(frequency, appVersion);
        if (frequency === 'off') return t('backup.autoOffMessage');
        return t('backup.autoOnMessage');
      }),
    [run, appVersion],
  );

  const backupNow = useCallback(
    () =>
      run('now', async () => {
        // interactive: the user pressed a button and is watching, so this is
        // the one moment a Google consent screen is welcome rather than rude.
        const result = await takeSnapshot(appVersion, { interactive: true });
        if (result.driveError) return t('backup.tookButDrive');
        const where = [
          t('backup.placeApp'),
          result.folder ? t('backup.placeFolder') : null,
          result.drive ? t('backup.placeDrive') : null,
        ].filter(Boolean) as string[];
        return t('backup.tookTo', { places: where.join(', ') });
      }),
    [run, appVersion],
  );

  const pickFolder = useCallback(
    () =>
      run('folder', async () => {
        const uri = await chooseExportFolder();
        if (!uri) return null;
        await takeSnapshot(appVersion);
        return t('backup.folderChosen');
      }),
    [run, appVersion],
  );

  const dropFolder = useCallback(
    () =>
      run('folder', async () => {
        await forgetExportFolder();
        return t('backup.folderForgotten');
      }),
    [run],
  );

  /* ------------------------------------------------------------ your Drive */

  const linkDrive = useCallback(
    () =>
      run('drive', async () => {
        setDiagnosis(null);
        const res = await connectDrive();

        if (res.ok) {
          const result = await takeSnapshot(appVersion, { interactive: true });
          return result.drive ? t('backup.driveConnected') : t('backup.driveConnectedNoCopy');
        }

        switch (res.reason) {
          case 'cancelled':
            // Backing out of the picker is a decision, not a failure.
            return null;
          case 'notRegistered':
            // The one failure the user cannot possibly diagnose from the app,
            // and the one the app happens to hold the answer to. Show it.
            setDiagnosis(res.signing);
            return t('backup.driveNotRegistered');
          case 'closed':
            // Picked an account, then the screen shut without connecting. Most
            // often the app signature is not registered; sometimes the person
            // really did press back. Both get the same honest sentence and the
            // fingerprint, because guessing wrong in either direction is worse
            // than saying which two things it might be.
            setDiagnosis(res.signing);
            return t('backup.driveClosed');
          case 'noResult':
            return t('backup.driveNoResult');
          case 'apiError':
            return t('backup.driveApiError', { reason: res.message });
          case 'refused':
            return t('backup.driveRefused', { reason: res.message });
        }
      }),
    [run, appVersion],
  );

  /**
   * Send the fingerprint somewhere it can be pasted.
   *
   * Reads it fresh rather than reusing what the failure reported, so it is
   * still right if this gets used from a build that never failed.
   */
  const shareFingerprint = useCallback(
    () =>
      run('fingerprint', async () => {
        const info = driveSigningInfo();
        if (!info) return t('backup.driveOldBuild');
        const text = [
          `Package name: ${info.packageName}`,
          `SHA-1: ${info.sha1 || 'unavailable'}`,
          `SHA-256: ${info.sha256 || 'unavailable'}`,
          '',
          'Register these as an Android client at:',
          'https://console.cloud.google.com/auth/clients',
        ].join('\n');
        const res = await shareText('drive-signing.txt', text, 'text/plain');
        return res.ok ? t('backup.driveFingerprintShared') : t('backup.shareFailed');
      }),
    [run],
  );

  const unlinkDrive = useCallback(
    () =>
      Alert.alert(t('backup.driveStopTitle'), t('backup.driveStopBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('backup.driveStop'),
          style: 'destructive',
          onPress: () =>
            run('drive', async () => {
              await disconnectDrive();
              return t('backup.driveDisconnected');
            }),
        },
      ]),
    [run],
  );

  /* ---------------------------------------------------------- save it once */

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

  const exportBackup = useCallback(
    () =>
      run('json', async () => {
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

  const exportCsv = useCallback(
    () =>
      run('csv', async () => {
        const csv = await exportTransactionsCsv(t);
        const res = await shareText(suggestedName('expenses', 'csv'), csv, 'text/csv');
        return res.ok ? t('backup.csvShared') : t('backup.shareFailed');
      }),
    [run],
  );

  /* ------------------------------------------------------------ bring back */

  const restoreFrom = useCallback(
    (kind: 'zip' | 'json' | 'db' | 'csv') => async () => {
      if (kind === 'csv') {
        const text = await pickTextFile();
        if (text == null) return;
        run('importCsv', async () => {
          const res = await importTransactionsCsv(text, t);
          return t('backup.imported', { imported: res.imported, skipped: res.skipped });
        });
        return;
      }

      if (kind === 'json') {
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
        return;
      }

      const picked = await pickFile(['*/*']);
      if (picked == null) return;
      confirmReplace(() =>
        run('restoreFile', async () => {
          // Kept as two branches rather than one clever expression: the ZIP
          // restore reports a photo count and the database one does not, and
          // pretending they share a shape only hides that.
          if (kind === 'zip') {
            const res = await restoreBackupZip(picked.uri);
            if (!res.ok) return errorText(res.error);
            return t('backup.restoredZip', {
              rows: countRows(res.counts),
              receipts: res.receipts ?? 0,
            });
          }

          const res = await restoreFromDatabaseFile(picked.uri);
          if (!res.ok) return errorText(res.error);
          return t('backup.restored', { rows: countRows(res.counts) });
        }),
      );
    },
    [run, confirmReplace],
  );

  const openSnapshot = useCallback(
    (name: string, at: number, size: number) => {
      Alert.alert(formatDate(at, 'long'), t('backup.snapshotSize', { kb: kb(size) }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('backup.snapshotShare'),
          onPress: () =>
            run('shareSnap', async () => {
              const res = await shareExistingFile(snapshotUri(name), 'application/json');
              return res.ok ? t('backup.backupShared') : t('backup.shareFailed');
            }),
        },
        {
          text: t('backup.snapshotDelete'),
          style: 'destructive',
          onPress: () =>
            run('deleteSnap', async () => {
              await deleteSnapshot(name);
              return t('backup.snapshotDeleted');
            }),
        },
        {
          text: t('backup.restoreConfirm'),
          style: 'destructive',
          onPress: () =>
            confirmReplace(() =>
              run('restoreSnap', async () => {
                const res = await restoreSnapshot(name);
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

  /* ----------------------------------------------------------------- view */

  return (
    <Screen title={t('more.backup')} back>
      {/* What is on this phone, and where it is ------------------------- */}
      <Card>
        <Text style={[styles.lead, { color: theme.text }]}>{t('backup.introTitle')}</Text>
        <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.introBody')}</Text>
        {status ? (
          <Text style={[styles.body, { color: theme.textDim }]}>
            {t('backup.holding', {
              photos: status.receiptCount,
              size: mb(status.receiptBytes),
            })}
          </Text>
        ) : null}
      </Card>

      {/* 1 — Google's own backup, which needs nothing from anyone -------- */}
      <Card>
        <SectionLabel>{t('backup.layerGoogle')}</SectionLabel>
        <Text style={[styles.status, { color: theme.income }]}>{t('backup.googleOn')}</Text>
        <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.googleBody')}</Text>
        <Text style={[styles.caveat, { color: theme.warn }]}>{t('backup.googleCaveat')}</Text>
      </Card>

      {/* 2 — the schedule ---------------------------------------------- */}
      <Card>
        <SectionLabel>{t('backup.layerAuto')}</SectionLabel>
        <Text style={[styles.body, { color: theme.textDim }]}>
          {t('backup.autoBody', { keep: KEEP_SNAPSHOTS })}
        </Text>

        <View style={styles.chips}>
          {FREQUENCIES.map((f) => (
            <Chip
              key={f}
              label={t(`backup.every.${f}`)}
              active={status?.frequency === f}
              onPress={() => changeFrequency(f)}
            />
          ))}
        </View>

        {status && status.frequency !== 'off' ? (
          <Text style={[styles.status, { color: theme.text }]}>
            {status.lastAt
              ? t('backup.lastAndNext', {
                  last: formatDate(status.lastAt, 'long'),
                  next: status.nextAt ? formatDate(status.nextAt, 'long') : '—',
                })
              : t('backup.neverYet')}
          </Text>
        ) : null}

        <Button
          label={t('backup.backupNow')}
          variant="secondary"
          onPress={backupNow}
          disabled={working}
        />
      </Card>

      {/* 3 — your own Google Drive -------------------------------------- */}
      <Card>
        <SectionLabel>{t('backup.layerDrive')}</SectionLabel>
        <Text style={[styles.body, { color: theme.textDim }]}>
          {t('backup.driveBody', { folder: DRIVE_FOLDER_NAME, keep: KEEP_IN_DRIVE })}
        </Text>

        {status && !status.drive.available ? (
          // Not an error and not the user's fault: the JS knows about Drive
          // backup and the installed APK does not. Say exactly that, because
          // "sign-in failed" would send someone into their Google settings
          // hunting for a problem that is a reinstall.
          <Text style={[styles.caveat, { color: theme.warn }]}>{t('backup.driveOldBuild')}</Text>
        ) : status?.drive.connected ? (
          <>
            <Text style={[styles.status, { color: theme.income }]}>
              {t('backup.driveOn', { folder: DRIVE_FOLDER_NAME })}
            </Text>
            <Text style={[styles.body, { color: theme.textDim }]}>
              {status.drive.lastAt
                ? t('backup.driveLast', { last: formatDate(status.drive.lastAt, 'long') })
                : t('backup.driveNeverYet')}
            </Text>
            {status.drive.lastError ? (
              <Text style={[styles.caveat, { color: theme.warn }]}>
                {t('backup.driveProblem', { reason: driveReason(status.drive.lastError) })}
              </Text>
            ) : null}
            <Button
              label={t('backup.driveStop')}
              variant="secondary"
              onPress={unlinkDrive}
              disabled={working}
            />
            <Text style={[styles.caveat, { color: theme.textDim }]}>
              {t('backup.driveRevokeHint')}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.status, { color: theme.textDim }]}>{t('backup.driveOff')}</Text>
            <Button label={t('backup.driveConnect')} onPress={linkDrive} disabled={working} />
            <Text style={[styles.caveat, { color: theme.textDim }]}>{t('backup.driveScope')}</Text>
            {/* Available before anything goes wrong, not only after. Checking
                the fingerprint against the Cloud Console is the first thing to
                do when setting this up, and needing to trigger a failure to
                see it was a poor way to arrange that. */}
            {!diagnosis ? (
              <Button
                label={t('backup.driveCheckSetup')}
                variant="secondary"
                onPress={() => setDiagnosis(driveSigningInfo())}
                disabled={working}
              />
            ) : null}

            {/* Only after Google has actually rejected this build. Google
                matches an app by package name plus signing fingerprint, and
                when they don't match it simply closes the consent screen — no
                message, nothing in the app to see. The fingerprint below is
                read off the running APK, so it is the true one whatever
                keystore ended up signing it. */}
            {diagnosis ? (
              <View style={[styles.diagnosis, { borderColor: theme.warn }]}>
                <Text style={[styles.status, { color: theme.warn }]}>
                  {t('backup.driveFixTitle')}
                </Text>
                <Text style={[styles.body, { color: theme.textDim }]}>
                  {t('backup.driveFixBody')}
                </Text>
                <Text style={[styles.mono, { color: theme.text }]} selectable>
                  {t('backup.drivePackage')}: {diagnosis.packageName}
                </Text>
                <Text style={[styles.mono, { color: theme.text }]} selectable>
                  SHA-1: {diagnosis.sha1 || '—'}
                </Text>
                <Button
                  label={t('backup.driveCopyFingerprint')}
                  variant="secondary"
                  onPress={shareFingerprint}
                  disabled={working}
                />
              </View>
            ) : null}
          </>
        )}
      </Card>

      {/* 4 — a folder you can actually see ------------------------------ */}
      <Card>
        <SectionLabel>{t('backup.layerFolder')}</SectionLabel>
        <Text style={[styles.body, { color: theme.textDim }]}>
          {t('backup.folderBody', { keep: KEEP_IN_FOLDER })}
        </Text>

        {status?.folderUri ? (
          <>
            <Text style={[styles.status, { color: theme.income }]}>
              {t('backup.folderIs', { folder: status.folderLabel ?? '' })}
            </Text>
            <Button
              label={t('backup.folderChange')}
              variant="secondary"
              onPress={pickFolder}
              disabled={working}
            />
            <Button
              label={t('backup.folderStop')}
              variant="secondary"
              onPress={dropFolder}
              disabled={working}
            />
          </>
        ) : (
          <>
            <Text style={[styles.status, { color: theme.textDim }]}>{t('backup.folderNone')}</Text>
            <Button label={t('backup.folderChoose')} onPress={pickFolder} disabled={working} />
          </>
        )}
      </Card>

      {/* 5 — one file, right now --------------------------------------- */}
      <Card>
        <SectionLabel>{t('backup.layerManual')}</SectionLabel>
        <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.manualBody')}</Text>
        <Button label={t('backup.exportZip')} onPress={exportZip} disabled={working} />

        <Text style={[styles.body, { color: theme.textDim }]}>{t('backup.otherFormats')}</Text>
        <Button
          label={t('backup.exportBackup')}
          variant="secondary"
          onPress={exportBackup}
          disabled={working}
        />
        <Button
          label={t('backup.exportDb')}
          variant="secondary"
          onPress={exportDb}
          disabled={working}
        />
        <Button
          label={t('backup.exportCsv')}
          variant="secondary"
          onPress={exportCsv}
          disabled={working}
        />
        <Text style={[styles.caveat, { color: theme.textDim }]}>{t('backup.csvCaveat')}</Text>
      </Card>

      {/* Bringing it back ---------------------------------------------- */}
      <Card>
        <SectionLabel>{t('backup.layerRestore')}</SectionLabel>
        <Text style={[styles.caveat, { color: theme.warn }]}>{t('backup.restoreWarning')}</Text>
        <Button
          label={t('backup.restoreZip')}
          variant="secondary"
          onPress={restoreFrom('zip')}
          disabled={working}
        />
        <Button
          label={t('backup.restore')}
          variant="secondary"
          onPress={restoreFrom('json')}
          disabled={working}
        />
        <Button
          label={t('backup.restoreDb')}
          variant="secondary"
          onPress={restoreFrom('db')}
          disabled={working}
        />
        <Button
          label={t('backup.importCsv')}
          variant="secondary"
          onPress={restoreFrom('csv')}
          disabled={working}
        />
      </Card>

      {/* What is sitting in the app right now --------------------------- */}
      <SectionLabel>{t('backup.snapshots')}</SectionLabel>
      {!status || status.snapshots.length === 0 ? (
        <EmptyState text={t('backup.noSnapshots')} />
      ) : (
        <RowGroup>
          {status.snapshots.map((snap, i) => (
            <ListRow
              key={snap.name}
              icon="🗂️"
              title={formatDate(snap.at, 'long')}
              subtitle={timeOf(snap.at)}
              value={`${kb(snap.size)} KB`}
              chevron
              last={i === status.snapshots.length - 1}
              onPress={() => openSnapshot(snap.name, snap.at, snap.size)}
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
        <View style={[styles.message, { backgroundColor: theme.accentSoft }]}>
          <Text style={{ color: theme.text, fontSize: type.small }}>{message}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * Turn a Drive failure into something worth reading.
 *
 * The raw text comes from Google and is written for developers — "insufficient
 * authentication scopes", "The user's Drive storage quota has been exceeded".
 * Only the causes a person can actually do something about get translated; the
 * rest pass through, because a wrong plain-English guess is worse than a
 * technical sentence someone can search for.
 */
function driveReason(raw: string): string {
  if (raw === 'driveNeedsSignIn') return t('backup.driveReason.signIn');
  if (/quota|storage/i.test(raw)) return t('backup.driveReason.full');
  if (/network|timeout|fetch|connection/i.test(raw)) return t('backup.driveReason.offline');
  if (/scope|permission|401|403/i.test(raw)) return t('backup.driveReason.permission');
  return raw;
}

/** A restore failure the user can act on, or the raw message if we can't. */
function errorText(error: string | undefined): string {
  const known = ['notZip', 'notDb', 'notOurs', 'notJson', 'tooNew'];
  return known.includes(error ?? '')
    ? t(`backup.error.${error}`)
    : (error ?? t('backup.error.notOurs'));
}

function countRows(counts: Record<string, number> | undefined): number {
  return Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
}

function kb(bytes: number): string {
  return String(Math.max(1, Math.round(bytes / 1024)));
}

function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeOf(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  lead: { fontSize: type.body, fontWeight: '600' },
  body: { fontSize: type.small, lineHeight: 19 },
  status: { fontSize: type.small, fontWeight: '600' },
  caveat: { fontSize: type.tiny, lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  diagnosis: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  // The fingerprint is copied character by character into a web form, so it
  // gets a monospaced face and a size that survives being read off a phone.
  mono: { fontFamily: 'monospace', fontSize: type.tiny, lineHeight: 18 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.md, justifyContent: 'center' },
  message: { borderRadius: radius.md, padding: space.md },
});
