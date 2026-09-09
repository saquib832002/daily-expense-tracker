import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import migrations from '../drizzle/migrations';
import { db } from '@/db/client';
import { getSetting, materializeDueRecurring } from '@/db/queries';
import { seedIfEmpty } from '@/db/seed';
import { detectLanguage, setLanguage, t, type LanguageCode } from '@/i18n';
import { runAutoBackupIfDue } from '@/services/autoBackup';
import { useTheme } from '@/theme';
import { LockGate } from '@/ui/LockGate';

export default function RootLayout() {
  const theme = useTheme();
  const { success, error } = useMigrations(db, migrations);
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    if (!success) return;
    (async () => {
      try {
        await seedIfEmpty();
        const saved = (await getSetting('language')) as LanguageCode | null;
        setLanguage(saved ?? detectLanguage());
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

  if (!success || !ready) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} />
        <Text style={[styles.errorBody, { color: theme.textDim }]}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
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
        <Stack.Screen name="scan" />
      </Stack>
      </LockGate>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  errorTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  errorBody: { fontSize: 14, textAlign: 'center' },
});
