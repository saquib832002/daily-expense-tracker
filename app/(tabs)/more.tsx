import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { ONBOARDED_KEY, getBaseCurrency, ledgerCurrencies, setSetting } from '@/db/queries';
import { signedInAccount, type Account } from '@/services/account';
import { dateOrderExample } from '@/domain/dateOrder';
import { deviceDateOrder, deviceRegion } from '@/services/region';
import { isLockAvailable, isLockEnabled, setLockEnabled } from '@/services/lock';
import {
  LANGUAGES,
  applyDirection,
  getLanguage,
  directionMismatch,
  isRTL,
  layoutIsRTL,
  mirrorIsOn,
  setMirrorRTL,
  needsRestartFor,
  setLanguage,
  t,
  type LanguageCode,
} from '@/i18n';
import { radius, space, type, useTheme } from '@/theme';
import { Card, Chip, ListRow, RowGroup, Screen, SectionLabel } from '@/ui';
import { rescheduleAll } from '@/services/notifications';
import { requestFirstRun } from '@/ui/firstRun';

/**
 * Settings, and the way into the things that manage themselves.
 * Rules, backup and export arrive in Phases 4 and 5.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [language, setLang] = useState<LanguageCode>(getLanguage());
  // Read on every render: it can only change by restarting the process, so a
  // cached value is exactly what would hide the problem.
  const mismatch = directionMismatch();
  const [mirror, setMirror] = useState(mirrorIsOn());
  const [currency, setCurrency] = useState('INR');
  /** Every currency already in use, so the screen can warn about mixing. */
  const [inLedger, setInLedger] = useState<string[]>([]);
  /** Who is signed in. Null until read, and null again after signing out. */
  const [account, setAccount] = useState<Account | null>(null);
  /** What the phone reports. Read once; it cannot change while we are open. */
  const detected = useMemo(() => deviceRegion(), []);
  const detectedOrder = useMemo(() => deviceDateOrder(), []);
  const [lockOn, setLockOn] = useState(false);
  const [lockPossible, setLockPossible] = useState(false);

  useEffect(() => {
    getBaseCurrency().then(setCurrency);
    ledgerCurrencies().then(setInLedger);
    signedInAccount().then(setAccount);
    isLockAvailable().then(setLockPossible);
    isLockEnabled().then(setLockOn);
  }, []);

  const toggleLock = useCallback(async (on: boolean) => {
    setLockOn(on);
    await setLockEnabled(on);
  }, []);

  /**
   * Reopen the welcome screen.
   *
   * Two steps in this order for a reason. The flag is cleared first, so that an
   * app killed between here and the next frame still comes back to the
   * question; the navigation home happens before the root layout swaps the
   * navigator out for the welcome screen, so nothing is left pointing at a
   * screen that is no longer mounted.
   *
   * Nothing is lost by doing this — no data is touched, and the only setting
   * the screen can change is the currency, which it asks about plainly.
   */
  const runSetupAgain = useCallback(() => {
    Alert.alert(t('more.setupAgain'), t('more.setupAgainConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('more.setupAgainGo'),
        onPress: () => {
          void (async () => {
            await setSetting(ONBOARDED_KEY, '0');
            router.replace('/');
            requestFirstRun();
          })();
        },
      },
    ]);
  }, [router]);

  /**
   * Switching language is instant. Switching DIRECTION is not.
   *
   * Android decides left-to-right or right-to-left when the process starts, so
   * moving between English and Arabic needs a relaunch before the layout
   * mirrors. The strings change immediately either way, so the app is never
   * broken in between — it is just not yet mirrored, and saying so is far
   * better than leaving someone to wonder why half of it looks wrong.
   */
  /**
   * Turn layout mirroring on or off.
   *
   * Takes hold on the next launch like every other direction change, so the
   * screen says so rather than leaving someone tapping a switch that appears
   * to do nothing.
   */
  const toggleMirror = useCallback(
    async (on: boolean) => {
      setMirror(on);
      setMirrorRTL(on);
      await setSetting('mirror_rtl', on ? '1' : '0');
      applyDirection(language);
      if (needsRestartFor(language)) {
        Alert.alert(t('more.restartTitle'), t('common.restartForDirection'), [
          { text: t('common.ok') },
        ]);
      }
    },
    [language],
  );

  const choose = useCallback(async (code: LanguageCode) => {
    const flips = needsRestartFor(code);
    setLanguage(code);
    setLang(code);
    await setSetting('language', code);
    applyDirection(code);
    // Scheduled notifications carry frozen text — Android holds the words, not
    // a callback — so without this a user who switches to Urdu keeps getting
    // English reminders for the next thirty days.
    void rescheduleAll();
    if (flips) {
      Alert.alert(t('more.restartTitle'), t('more.restartBody'), [
        { text: t('common.ok') },
      ]);
    }
  }, []);

  return (
    <Screen title={t('more.title')}>
      {/* The person, first.
          Signing in is required to use this app, so the account is not a
          connection status to be filed under Settings — it is who they are
          while they are here, and the first thing this screen should show is
          their own name and face. Everything about that account lives one tap
          away rather than expanding here, because a settings screen that opens
          with a wall of account detail buries the settings. */}
      <Pressable
        onPress={() => router.push('/profile')}
        style={({ pressed }) => [
          styles.profile,
          {
            backgroundColor: pressed ? theme.accentSoft : theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        {account?.photo ? (
          <Image source={{ uri: account.photo }} style={styles.avatarLarge} />
        ) : (
          <View
            style={[styles.avatarLarge, styles.avatarFallback, { backgroundColor: theme.accentSoft }]}
          >
            <Text style={{ color: theme.accent, fontWeight: '700', fontSize: type.title }}>
              {(account?.name ?? account?.email ?? '?').slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.accountText}>
          <Text
            style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}
            numberOfLines={1}
          >
            {account?.name ?? t('more.accountNone')}
          </Text>
          <Text style={[styles.hint, { color: theme.textDim }]} numberOfLines={1}>
            {account?.email ?? t('more.accountNoneHint')}
          </Text>
          <Text style={[styles.hint, { color: theme.accent }]}>{t('more.viewProfile')}</Text>
        </View>
        <Text style={{ color: theme.textDim, fontSize: type.body }}>›</Text>
      </Pressable>

      <RowGroup>
        <ListRow
          icon="🏦"
          title={t('more.accounts')}
          subtitle={t('more.accountsHint')}
          chevron
          onPress={() => router.push('/accounts')}
        />
        <ListRow
          icon="🏷️"
          title={t('more.categories')}
          subtitle={t('more.categoriesHint')}
          chevron
          onPress={() => router.push('/categories')}
        />
        <ListRow
          icon="📊"
          title={t('more.reports')}
          subtitle={t('more.reportsHint')}
          chevron
          onPress={() => router.push('/reports')}
        />
        <ListRow
          icon="⚡"
          title={t('more.rules')}
          subtitle={t('more.rulesHint')}
          chevron
          onPress={() => router.push('/rules')}
        />
        <ListRow
          icon="💳"
          title={t('more.cards')}
          subtitle={t('more.cardsHint')}
          chevron
          onPress={() => router.push('/cards')}
        />
        <ListRow
          icon="💱"
          title={t('more.convert')}
          subtitle={t('more.convertHint')}
          chevron
          onPress={() => router.push('/convert')}
        />
        <ListRow
          icon="📄"
          title={t('more.statement')}
          subtitle={t('more.statementHint')}
          chevron
          onPress={() => router.push('/statement')}
        />
        <ListRow
          icon="🛡️"
          title={t('more.warranties')}
          subtitle={t('more.warrantiesHint')}
          chevron
          onPress={() => router.push('/warranties')}
        />
        <ListRow
          icon="🔔"
          title={t('more.notifications')}
          subtitle={t('more.notificationsHint')}
          chevron
          onPress={() => router.push('/notifications')}
        />
        <ListRow
          icon="🔁"
          title={t('more.recurring')}
          subtitle={t('more.recurringHint')}
          chevron
          onPress={() => router.push('/recurring')}
        />
        <ListRow
          icon="💾"
          title={t('more.backup')}
          subtitle={t('more.backupHint')}
          chevron
          onPress={() => router.push('/backup')}
          last
        />
      </RowGroup>

      <View style={styles.section}>
        <SectionLabel>{t('more.language')}</SectionLabel>
        <View style={styles.chips}>
          {LANGUAGES.map((l) => (
            <Chip
              key={l.code}
              label={l.label}
              active={l.code === language}
              onPress={() => choose(l.code)}
            />
          ))}
        </View>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('more.languageHint')}</Text>
        {/* The true layout direction, always visible.
            Arabic and Urdu mirror the interface and English does not, and the
            switch only lands on the next cold start — so when the two disagree
            the tabs run backwards while the words look right. Printing the
            actual state turns "why is my app reversed" into one glance. */}
        <Text style={[styles.hint, { color: mismatch ? theme.warn : theme.textDim }]}>
          {t('more.layoutDirection', {
            direction: layoutIsRTL() ? t('more.rightToLeft') : t('more.leftToRight'),
          })}
          {mismatch ? ` — ${t('common.restartForDirection')}` : ''}
        </Text>

        {/* Only for languages it can apply to. In English or Hindi this switch
            would do nothing at all, and a dead setting is worse than none. */}
        {isRTL(language) ? (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={{ color: theme.text, fontSize: type.body }}>
                {t('more.mirrorLayout')}
              </Text>
              <Text style={[styles.hint, { color: theme.textDim }]}>
                {t('more.mirrorLayoutHint')}
              </Text>
            </View>
            <Switch value={mirror} onValueChange={toggleMirror} />
          </View>
        ) : null}
      </View>

      <Card gap={space.sm}>
        <SectionLabel>{t('more.security')}</SectionLabel>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={{ color: theme.text, fontSize: type.body }}>{t('more.appLock')}</Text>
            <Text style={[styles.hint, { color: theme.textDim }]}>
              {lockPossible ? t('more.appLockHint') : t('more.appLockUnavailable')}
            </Text>
          </View>
          <Switch value={lockOn} onValueChange={toggleLock} disabled={!lockPossible} />
        </View>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('more.appLockCaveat')}</Text>
      </Card>

      {/* What the phone told us, said out loud.
          The currency and the date order are both decided automatically, and a
          decision nobody can see is a decision nobody can correct — which is
          exactly how a US receipt reading 9/3 got filed as 9 March without
          anyone being able to work out why. */}
      <Card gap={space.xs}>
        <SectionLabel>{t('more.detected')}</SectionLabel>
        <Text style={{ color: theme.text, fontSize: type.body }}>
          {detected.code
            ? t('more.detectedRegion', { region: detected.code, tag: detected.languageTag })
            : t('more.detectedUnknown')}
        </Text>
        <Text style={{ color: theme.text, fontSize: type.body }}>
          {t('more.detectedCurrency', { currency })}
        </Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>
          {t('more.detectedDates', { example: dateOrderExample(detectedOrder) })}
        </Text>
        {/* Only once a second currency is genuinely in play. Totals add
            currencies one for one, because the app holds no exchange rates. */}
        {inLedger.filter((c) => c !== currency).length > 0 ? (
          <Text style={[styles.hint, { color: theme.warn }]}>
            {t('more.currencyMixed', {
              others: inLedger.filter((c) => c !== currency).join(', '),
            })}
          </Text>
        ) : null}
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('more.detectedHint')}</Text>
        {/* The way back to the welcome screen.
            It is here rather than buried in About because this card is where
            someone comes when the automatic currency is wrong — and because a
            screen reachable only by a first-launch condition is a screen that
            cannot be checked, which is how it came to be broken for three
            builds running. */}
        <ListRow
          icon="🚀"
          title={t('more.setupAgain')}
          subtitle={t('more.setupAgainHint')}
          onPress={runSetupAgain}
          chevron
          last
        />
      </Card>

      <Card gap={space.xs}>
        <SectionLabel>{t('more.about')}</SectionLabel>
        <Text style={{ color: theme.text, fontSize: type.body }}>{t('app.name')}</Text>
        <Text style={{ color: theme.textDim, fontSize: type.small }}>
          {t('more.version', { version: Constants.expoConfig?.version ?? '0.1.0' })}
        </Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('more.privacy')}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  switchText: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
  },
  avatarLarge: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  accountText: { flex: 1, gap: 2 },
  hint: { fontSize: type.small, lineHeight: 19 },
});
