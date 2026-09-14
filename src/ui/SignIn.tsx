/**
 * The door. Nothing else in the app is reachable until this succeeds.
 *
 * Signing in with Google is required on first launch. That was asked for
 * explicitly, twice; I argued against it twice and lost, which is the right
 * outcome for a product decision that is not mine. The argument is recorded in
 * `services/account.ts`, and one consequence of it lands squarely on this file:
 *
 *   While the Cloud project's publishing status is **Testing**, only accounts
 *   on the Test users list can get past this screen. Everyone else is refused
 *   with `403 access_denied` and has no way into the app at all. **Publish app**
 *   in Google Auth Platform → Audience must be pressed before anybody else
 *   installs this.
 *
 * Which makes the failure text here the most important text in the app. Someone
 * stuck on this screen cannot go and find a settings page that explains it —
 * whatever is printed in that warning box is the entirety of what they will
 * ever be told. So every branch of the sign-in result gets its own sentence,
 * and a signature failure prints the fingerprint that fixes it.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { signIn } from '@/services/account';
import { driveSigningInfo } from '@/services/autoBackup';
import { radius, space, type, useTheme } from '@/theme';
import { Button } from '@/ui';

export function SignIn({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  const go = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    setFingerprint(null);
    try {
      const res = await signIn();
      if (res.ok) {
        onDone();
        return;
      }

      switch (res.reason) {
        case 'cancelled':
          setProblem(t('signin.errCancelled'));
          break;
        case 'notRegistered':
        case 'closed':
          setProblem(t('signin.errSignature'));
          setFingerprint(res.signing?.sha1 ?? driveSigningInfo()?.sha1 ?? null);
          break;
        case 'noResult':
          setProblem(t('signin.errNoResult'));
          break;
        case 'refused':
          setProblem(`${t('signin.errRefused')}\n\n${res.message}`);
          break;
        case 'apiError':
          setProblem(`${t('signin.errApi')}\n\n${res.message}`);
          break;
      }
    } catch (e) {
      setProblem(`${t('signin.errRefused')}\n\n${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [onDone]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Text style={styles.mark}>💸</Text>
          <Text style={[styles.title, { color: theme.text }]}>{t('app.name')}</Text>
          <Text style={[styles.lead, { color: theme.textDim }]}>{t('signin.lead')}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.cardTitle, { color: theme.text }]}>{t('signin.title')}</Text>
          <Text style={[styles.hint, { color: theme.textDim }]}>{t('signin.body')}</Text>

          <Button label={t('signin.button')} onPress={go} disabled={busy} />

          {/* Said before the tap, not after it. The one thing people want to
              know about a forced Google sign-in is what it can see. */}
          <Text style={[styles.caveat, { color: theme.textDim }]}>{t('signin.scopeNote')}</Text>
        </View>

        {problem ? (
          <View style={[styles.problem, { borderColor: theme.warn, backgroundColor: theme.surface }]}>
            <Text style={[styles.hint, { color: theme.warn }]}>{problem}</Text>
            {fingerprint ? (
              <Text style={[styles.mono, { color: theme.textDim }]} selectable>
                SHA-1: {fingerprint}
              </Text>
            ) : null}
            <Text style={[styles.caveat, { color: theme.textDim }]}>{t('signin.errRetry')}</Text>
          </View>
        ) : null}

        {busy ? <ActivityIndicator color={theme.accent} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: space.lg, gap: space.lg, paddingTop: space.xxl, paddingBottom: space.xl },
  hero: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  mark: { fontSize: 56 },
  title: { fontSize: type.title + 6, fontWeight: '700', textAlign: 'center' },
  lead: { fontSize: type.body, lineHeight: 22, textAlign: 'center' },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  cardTitle: { fontSize: type.body, fontWeight: '600' },
  hint: { fontSize: type.small, lineHeight: 19 },
  caveat: { fontSize: type.tiny, lineHeight: 16 },
  mono: { fontSize: type.tiny, fontFamily: 'monospace', marginTop: space.xs },
  problem: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.xs },
});
