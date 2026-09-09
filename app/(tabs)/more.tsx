import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { getBaseCurrency, setSetting } from '@/db/queries';
import { isLockAvailable, isLockEnabled, setLockEnabled } from '@/services/lock';
import { LANGUAGES, getLanguage, setLanguage, t, type LanguageCode } from '@/i18n';
import { space, type, useTheme } from '@/theme';
import { Card, Chip, ListRow, RowGroup, Screen, SectionLabel } from '@/ui';

/**
 * Settings, and the way into the things that manage themselves.
 * Rules, backup and export arrive in Phases 4 and 5.
 */
export default function MoreScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [language, setLang] = useState<LanguageCode>(getLanguage());
  const [currency, setCurrency] = useState('INR');
  const [lockOn, setLockOn] = useState(false);
  const [lockPossible, setLockPossible] = useState(false);

  useEffect(() => {
    getBaseCurrency().then(setCurrency);
    isLockAvailable().then(setLockPossible);
    isLockEnabled().then(setLockOn);
  }, []);

  const toggleLock = useCallback(async (on: boolean) => {
    setLockOn(on);
    await setLockEnabled(on);
  }, []);

  const choose = useCallback(async (code: LanguageCode) => {
    setLanguage(code);
    setLang(code);
    await setSetting('language', code);
  }, []);

  return (
    <Screen title={t('more.title')}>
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

      <Card gap={space.xs}>
        <SectionLabel>{t('more.currency')}</SectionLabel>
        <Text style={{ color: theme.text, fontSize: type.body }}>{currency}</Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('more.currencyHint')}</Text>
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
  hint: { fontSize: type.small, lineHeight: 19 },
});
