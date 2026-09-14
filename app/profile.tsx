/**
 * The account, in full.
 *
 * Signing in is required to use this app, so a person deserves a page that
 * answers, without them having to ask: who am I signed in as, what did that
 * sign-in actually give this app, what is it doing with it, and how do I get
 * out. Four questions, four sections, in that order.
 *
 * The third question is the one most apps duck. A Google sign-in looks
 * identical to the user whether the app asked for one folder or their entire
 * Drive, so the only honest thing to do is print the scope in plain words —
 * *the backup files it creates, and nothing else* — next to a link to the
 * Google page where they can revoke it without going through us. An app that
 * required an account should be the one least afraid of saying what it can see.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDate, t } from '@/i18n';
import { signOut, signedInAccount, type Account } from '@/services/account';
import { driveStatus, type DriveStatus } from '@/services/autoBackup';
import { space, type, useTheme } from '@/theme';
import { Button, Card, ListRow, RowGroup, Screen, SectionLabel } from '@/ui';
import { requestFirstRun } from '@/ui/firstRun';

/** Where a Google account's app permissions are revoked. */
const GOOGLE_PERMISSIONS = 'https://myaccount.google.com/permissions';

export default function ProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [drive, setDrive] = useState<DriveStatus | null>(null);

  // On focus rather than on mount: someone who goes to the Backup screen,
  // reconnects Drive and comes back should not be looking at the stale answer.
  useFocusEffect(
    useCallback(() => {
      void signedInAccount().then(setAccount);
      void driveStatus().then(setDrive);
    }, []),
  );

  /**
   * Sign out.
   *
   * A bigger deal here than in most apps, and the dialog says so: because
   * signing in is required, signing out puts the app back behind the sign-in
   * screen on the spot. Nothing is deleted — not the ledger, not the backups
   * already sitting in their own Drive — but somebody expecting "sign out" to
   * mean "stop syncing" would otherwise find themselves locked out of their own
   * expenses.
   */
  const doSignOut = useCallback(() => {
    Alert.alert(t('more.signOut'), t('more.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('more.signOut'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await signOut();
            router.replace('/');
            requestFirstRun();
          })();
        },
      },
    ]);
  }, [router]);

  const initial = (account?.name ?? account?.email ?? '?').slice(0, 1).toUpperCase();

  return (
    <Screen title={t('profile.title')}>
      {/* 1 — who ---------------------------------------------------------- */}
      <View style={styles.hero}>
        {account?.photo ? (
          <Image source={{ uri: account.photo }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.accentSoft }]}>
            <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 32 }}>{initial}</Text>
          </View>
        )}
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {account?.name ?? t('more.accountNone')}
        </Text>
        {account?.email ? (
          <Text style={[styles.email, { color: theme.textDim }]} numberOfLines={1} selectable>
            {account.email}
          </Text>
        ) : null}
      </View>

      {/* 2 — the details, as facts rather than prose ---------------------- */}
      <Card gap={space.sm}>
        <SectionLabel>{t('profile.details')}</SectionLabel>
        <Detail label={t('profile.name')} value={account?.name ?? '—'} />
        <Detail label={t('profile.email')} value={account?.email ?? '—'} />
        <Detail label={t('profile.provider')} value="Google" />
        <Detail
          label={t('profile.since')}
          value={account?.since ? formatDate(account.since, 'long') : '—'}
        />
      </Card>

      {/* 3 — what the sign-in actually granted ---------------------------- */}
      <Card gap={space.sm}>
        <SectionLabel>{t('profile.access')}</SectionLabel>
        <Text style={[styles.body, { color: theme.text }]}>{t('profile.accessScope')}</Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('profile.accessCannot')}</Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('profile.accessNoServer')}</Text>
        <Pressable onPress={() => void Linking.openURL(GOOGLE_PERMISSIONS)}>
          <Text style={[styles.link, { color: theme.accent }]}>{t('profile.manageAccess')}</Text>
        </Pressable>
      </Card>

      {/* 4 — what it is doing with it ------------------------------------- */}
      <Card gap={space.sm}>
        <SectionLabel>{t('profile.backup')}</SectionLabel>
        <Text style={[styles.body, { color: drive?.connected ? theme.income : theme.warn }]}>
          {drive?.connected ? t('profile.backupOn') : t('profile.backupOff')}
        </Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>
          {drive?.lastAt
            ? t('profile.backupLast', { date: formatDate(drive.lastAt, 'long') })
            : t('profile.backupNever')}
        </Text>
        <RowGroup>
          <ListRow
            icon="☁️"
            title={t('more.backup')}
            subtitle={t('more.backupHint')}
            onPress={() => router.push('/backup')}
            chevron
            last
          />
        </RowGroup>
      </Card>

      {/* 5 — the way out -------------------------------------------------- */}
      <Card gap={space.sm}>
        <SectionLabel>{t('profile.sessionSection')}</SectionLabel>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('profile.signOutHint')}</Text>
        <Button label={t('more.signOut')} variant="danger" onPress={doSignOut} />
      </Card>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.detail}>
      <Text style={[styles.detailLabel, { color: theme.textDim }]}>{label}</Text>
      {/* Deliberately wraps rather than truncating: an address ending in an
          ellipsis is the one piece of text on this screen somebody might need
          to read out to support. */}
      <Text style={[styles.detailValue, { color: theme.text }]} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, paddingVertical: space.md },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: type.title, fontWeight: '700' },
  email: { fontSize: type.body },
  detail: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 28 },
  detailLabel: { fontSize: type.small, width: 96 },
  detailValue: { flex: 1, fontSize: type.body, fontWeight: '600', textAlign: 'right' },
  body: { fontSize: type.body, fontWeight: '600', lineHeight: 22 },
  hint: { fontSize: type.small, lineHeight: 19 },
  link: { fontSize: type.small, fontWeight: '700' },
});
