/**
 * Second run-through, once the sign-in has happened.
 *
 * The order is deliberate and was asked for: Google first, then this. By the
 * time anyone reaches this screen there is an account on record and — because
 * the same authorisation that identifies them also authorises Drive — their
 * backups are already switched on. So this screen no longer asks for any of
 * that. It confirms who they are, asks the one question the app cannot guess
 * safely, and gets out of the way.
 *
 * The currency question is here because it is the one thing the app cannot
 * recover from silently getting wrong. Everything else it guesses — language,
 * date order, categories — is either visibly wrong or harmless. A wrong
 * currency is invisible until a total looks odd, by which time there is a
 * history to rescale. The device's answer is already in the field, so agreeing
 * costs nothing; disagreeing opens a list of every currency there is.
 *
 * It is also reachable later, from More → Set up again, which is why nothing
 * here assumes an empty database.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ONBOARDED_KEY,
  getBaseCurrency,
  hasAnyTransactions,
  setBaseCurrency,
  setSetting,
} from '@/db/queries';
import { t } from '@/i18n';
import { signedInAccount, type Account } from '@/services/account';
import { connectDrive, driveStatus } from '@/services/autoBackup';
import { deviceCurrency } from '@/services/region';
import { radius, space, type, useTheme } from '@/theme';
import { Button } from '@/ui';
import { CurrencySelect } from '@/ui/CurrencySelect';

export function Welcome({ onDone }: { onDone: () => void }) {
  const theme = useTheme();

  const detected = useMemo(() => deviceCurrency(), []);
  const [currency, setCurrency] = useState(detected);
  const [busy, setBusy] = useState<'drive' | 'finish' | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  /**
   * Normally true the moment this screen opens, because signing in connected
   * it. False only for someone who turned Drive backup off on the Backup
   * screen and then reopened this from More — rare, but the screen would be
   * lying if it announced backups that were switched off.
   */
  const [driveOn, setDriveOn] = useState(true);
  const [driveNote, setDriveNote] = useState<string | null>(null);
  /**
   * True when this screen was reopened on an install that has real entries in
   * it. The currency question then stops being free: changing the answer
   * rescales every amount already recorded. Nobody should discover that after.
   */
  const [hasLedger, setHasLedger] = useState(false);
  /** What the app is using today. On a fresh install, the device's answer. */
  const [base, setBase] = useState(detected);

  useEffect(() => {
    void (async () => {
      const [ledger, current, who, drive] = await Promise.all([
        hasAnyTransactions(),
        getBaseCurrency(),
        signedInAccount(),
        driveStatus(),
      ]);
      setHasLedger(ledger);
      setBase(current);
      setAccount(who);
      setDriveOn(drive.connected);
      // Reopened from More: start from the currency actually in use, not the
      // one the phone's region implies. Someone who deliberately chose EUR on
      // an Indian SIM should not find INR pre-selected waiting to convert
      // their history back.
      if (ledger) setCurrency(current);
    })();
  }, []);

  const reconnect = useCallback(async () => {
    setBusy('drive');
    setDriveNote(null);
    try {
      const res = await connectDrive();
      if (res.ok) setDriveOn(true);
      else if (res.reason !== 'cancelled') setDriveNote(t('welcome.driveLater'));
    } catch {
      setDriveNote(t('welcome.driveLater'));
    } finally {
      setBusy(null);
    }
  }, []);

  const finish = useCallback(async () => {
    setBusy('finish');
    try {
      // Written before the flag that closes this screen, so an app killed
      // mid-save comes back to the question rather than to a wrong currency.
      await setBaseCurrency(currency);
      await setSetting(ONBOARDED_KEY, '1');
      onDone();
    } finally {
      setBusy(null);
    }
  }, [currency, onDone]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.title, { color: theme.text }]}>
          {account?.name ? t('welcome.titleNamed', { name: firstName(account.name) }) : t('welcome.title')}
        </Text>
        <Text style={[styles.lead, { color: theme.textDim }]}>{t('welcome.lead')}</Text>

        {/* Who just signed in. Small, and above the question, so the first
            thing they see is that the sign-in actually worked. */}
        {account ? (
          <View style={[styles.account, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {account.photo ? (
              <Image source={{ uri: account.photo }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.accentSoft }]}>
                <Text style={{ color: theme.accent, fontWeight: '700', fontSize: type.body }}>
                  {(account.name ?? account.email ?? '?').slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.accountText}>
              <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                {account.name ?? t('signin.signedIn')}
              </Text>
              <Text style={[styles.hint, { color: theme.textDim }]} numberOfLines={1}>
                {account.email ?? ''}
              </Text>
            </View>
            <Text style={{ color: theme.income, fontSize: type.body }}>✓</Text>
          </View>
        ) : null}

        {/* 1 — currency ----------------------------------------------------- */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.step, { color: theme.textDim }]}>{t('welcome.stepCurrency')}</Text>

          <CurrencySelect value={currency} onChange={setCurrency} prefer={[detected, base]} />
          <Text style={[styles.hint, { color: theme.textDim }]}>{t('welcome.currencyHint')}</Text>

          {hasLedger && currency !== base ? (
            <Text style={[styles.hint, { color: theme.warn }]}>
              {t('welcome.rebaseWarning', { currency })}
            </Text>
          ) : null}
        </View>

        {/* 2 — backup, already arranged by the sign-in ---------------------- */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.step, { color: theme.textDim }]}>{t('welcome.stepBackup')}</Text>
          {driveOn ? (
            <>
              <Text style={[styles.cardTitle, { color: theme.income }]}>
                {t('welcome.driveReady')}
              </Text>
              <Text style={[styles.hint, { color: theme.textDim }]}>{t('welcome.driveBody')}</Text>
            </>
          ) : (
            <>
              <Text style={[styles.cardTitle, { color: theme.text }]}>{t('welcome.driveTitle')}</Text>
              <Text style={[styles.hint, { color: theme.textDim }]}>{t('welcome.driveBody')}</Text>
              <Button
                label={t('welcome.driveConnect')}
                variant="secondary"
                onPress={reconnect}
                disabled={busy !== null}
              />
              {driveNote ? <Text style={[styles.hint, { color: theme.warn }]}>{driveNote}</Text> : null}
            </>
          )}
          <Text style={[styles.caveat, { color: theme.textDim }]}>{t('welcome.driveScope')}</Text>
        </View>

        {busy ? <ActivityIndicator color={theme.accent} /> : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.bg }]}>
        <Button label={t('welcome.start')} onPress={finish} disabled={busy !== null} />
      </View>
    </SafeAreaView>
  );
}

/** "Najmus Saquib" → "Najmus". Greeting somebody by both names reads as a form. */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  title: { fontSize: type.title + 4, fontWeight: '700' },
  lead: { fontSize: type.body, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  step: { fontSize: type.tiny, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  cardTitle: { fontSize: type.body, fontWeight: '600' },
  hint: { fontSize: type.small, lineHeight: 19 },
  caveat: { fontSize: type.tiny, lineHeight: 16 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  accountText: { flex: 1, gap: 2 },
  footer: { padding: space.lg, borderTopWidth: 1 },
});
