import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../drizzle/migrations';
import { db } from '@/db/client';
import { ONBOARDED_KEY, getSetting, materializeDueRecurring } from '@/db/queries';
import { seedIfEmpty } from '@/db/seed';
import {
  applyDirection,
  detectLanguage,
  directionMismatch,
  setLanguage,
  setMirrorRTL,
  t,
  useLanguage,
  type LanguageCode,
} from '@/i18n';
import { isSignedIn } from '@/services/account';
import { runAutoBackupIfDue } from '@/services/autoBackup';
import { startNotificationSync } from '@/services/notifications';
import { useTheme } from '@/theme';
import { onFirstRunRequest } from '@/ui/firstRun';
import { LockGate } from '@/ui/LockGate';
import { SignIn } from '@/ui/SignIn';
import { Welcome } from '@/ui/Welcome';

export default function RootLayout() {
  const theme = useTheme();
  const { success, error } = useMigrations(db, migrations);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  // Subscribed at the root as well, so a language change re-renders the whole
  // tree — including tab screens that are mounted but not currently on screen,
  // which would otherwise still be showing the old language when you get back
  // to them.
  useLanguage();
  /**
   * Null while we are still reading the flag. Rendering the welcome screen on a
   * hunch and then snatching it away would be worse than a moment of the
   * loading spinner we already show.
   */
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  /**
   * Null while unread. The gate: no account on record, no app — see
   * `services/account.ts` for why that is the shape of it.
   */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  /**
   * Recomputed on every render rather than held in state: the direction can
   * only change by restarting the process, so if it is wrong now it is wrong
   * until then, and a stale `false` here is precisely the bug this exists for.
   */
  const mismatched = ready && directionMismatch();

  /**
   * Re-read the gate from the database.
   *
   * Both More → Set up again and More → Sign out change a row and then ring
   * this bell, rather than telling the layout which screen to show. That way
   * there is one definition of "where should this person be", it lives in the
   * database, and the two callers cannot drift from it — signing out lands on
   * the sign-in screen, setting up again lands on the welcome screen, and
   * neither had to know that.
   */
  const readGate = useCallback(async () => {
    const done = (await getSetting(ONBOARDED_KEY)) === '1';
    const who = await isSignedIn();
    setSignedIn(who);
    setOnboarded(done);
  }, []);

  useEffect(() => onFirstRunRequest(() => void readGate()), [readGate]);

  /**
   * Keep the reminder schedule current. Started only once the app is actually
   * usable: scheduling reminders for someone still sitting on the sign-in
   * screen would be scheduling reminders for a user who does not exist yet.
   */
  useEffect(() => {
    if (!ready || !onboarded || !signedIn) return;
    return startNotificationSync();
  }, [ready, onboarded, signedIn]);

  useEffect(() => {
    if (!success) return;
    (async () => {
      try {
        await seedIfEmpty();
        const saved = (await getSetting('language')) as LanguageCode | null;
        const language = saved ?? detectLanguage();
        setLanguage(language);
        // Read BEFORE applyDirection: the setting decides what direction we
        // ask Android for, and asking for the wrong one is a whole launch of
        // a mirrored interface.
        setMirrorRTL((await getSetting('mirror_rtl')) === '1');
        // Two conditions, both required, because signing in is a gate rather
        // than an offer: the welcome screen must have been completed, AND an
        // account must still be on record. Signing out in More therefore puts
        // the app back behind the gate on the next launch, which is the only
        // thing a sign-out can honestly mean when the sign-in was mandatory.
        //
        // Deliberately NOT a live token check. Tokens expire — after seven days
        // while the Cloud project is in Testing mode — and a gate that tested
        // the token would throw people out of their own offline app every week.
        //
        // The flag half of this used to be cleverer, and the cleverness was the
        // bug: it also treated "this database already has data" as consent, on
        // the theory that an install predating the screen should not be asked.
        // It guessed at emptiness twice and got it wrong twice — first by
        // counting every row in the database, including the two dozen categories
        // seeded moments earlier on line one of this very function; then by
        // counting transactions, which marked anyone who had ever used the app
        // as done and made the screen unreachable no matter how many times they
        // reinstalled. Nothing is published yet, so the population that
        // inference protected is empty. It is gone.
        await readGate();
        // Android fixes layout direction when the process starts, so this has
        // to happen on every launch — not only when the language changes.
        // Without it, an Arabic user who force-quits comes back to a mirrored
        // language in an unmirrored interface.
        applyDirection(language);
        // Anything that fell due while the app was closed is posted now —
        // straight to the ledger if it auto-posts, otherwise to the inbox.
        await materializeDueRecurring();
        setReady(true);
        // Deliberately after `setReady`, and deliberately not awaited: a
        // backup must never be the reason the app takes longer to open, and
        // `runAutoBackupIfDue` swallows its own errors for the same reason.
        void runAutoBackupIfDue(Constants.expoConfig?.version ?? undefined);
      } catch (e) {
        setBootError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [success]);

  if (error || bootError) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={[styles.errorTitle, { color: theme.danger }]}>
          Could not open the database
        </Text>
        <Text style={[styles.errorBody, { color: theme.textDim }]}>
          {error?.message ?? bootError}
        </Text>
      </View>
    );
  }

  if (!success || !ready || onboarded === null || signedIn === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.errorBody, { color: theme.textDim }]}>{t('common.loading')}</Text>
      </View>
    );
  }

  // First run, in the order it was asked for: sign in, then set up. Both are
  // rendered instead of the navigator rather than as routes, so there is no
  // back gesture out of a half-configured app and no router timing to get
  // wrong — and no way to reach a tab from behind the gate.
  if (!signedIn) {
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <SignIn onDone={() => setSignedIn(true)} />
      </SafeAreaProvider>
    );
  }

  if (!onboarded) {
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Welcome onDone={() => setOnboarded(true)} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {/* The layout is mirrored the wrong way round for the language on
          screen. Shown here rather than as an alert on the Settings screen,
          because by the time someone notices the tabs have reversed they are
          usually nowhere near where they changed the language — and a
          one-time dialog they already dismissed is no help at all. It stays
          up until a cold start resolves it. */}
      {mismatched ? (
        <View style={[styles.banner, { backgroundColor: theme.warn }]}>
          <Text style={[styles.bannerText, { color: theme.onAccent }]}>
            {t('common.restartForDirection')}
          </Text>
        </View>
      ) : null}
      <LockGate>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="txn/[id]" options={{ presentation: 'card' }} />
        <Stack.Screen name="accounts" />
        <Stack.Screen name="categories" />
        <Stack.Screen name="reports" />
        <Stack.Screen name="inbox" />
        <Stack.Screen name="rules" />
        <Stack.Screen name="recurring" />
        <Stack.Screen name="backup" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="warranties" />
        <Stack.Screen name="cards" />
        <Stack.Screen name="convert" />
        <Stack.Screen name="scan" />
      </Stack>
      </LockGate>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingVertical: 10 },
  bannerText: { fontSize: 13, fontWeight: '600', lineHeight: 18, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  errorBody: { fontSize: 14, textAlign: 'center' },
});
