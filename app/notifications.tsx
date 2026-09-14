/**
 * Reminder settings.
 *
 * Four switches, one time, and an honest paragraph about why they might not
 * arrive. The last of those is the one that matters most in India: Xiaomi,
 * Oppo, Vivo, Realme and Samsung all ship battery managers that silently kill
 * scheduled work for apps the user has not whitelisted, and no amount of
 * correct code changes that. A screen that explains where the setting lives
 * beats a one-star review saying the reminders do not work.
 */
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { reminderTimeChoices } from '@/domain/notifications';
import { t } from '@/i18n';
import {
  ensurePermission,
  getNotificationSettings,
  permissionState,
  setNotificationSetting,
  setReminderTime,
  type NotificationSettings,
  type PermissionState,
} from '@/services/notifications';
import { radius, space, type, useTheme } from '@/theme';
import { Card, Screen, SectionLabel, Sheet } from '@/ui';

export default function NotificationsScreen() {
  const theme = useTheme();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    void (async () => {
      setSettings(await getNotificationSettings());
      setPermission(await permissionState());
    })();
  }, []);

  /**
   * Turning a switch ON is the moment to ask for permission: the user has just
   * said, in the app's own words, that they want this. Asking anywhere else —
   * on first launch especially — spends the single prompt Android allows on
   * someone who has no idea what they are agreeing to.
   */
  const toggle = useCallback(
    async (key: 'daily' | 'due' | 'inbox' | 'backup' | 'warranty', value: boolean) => {
      setSettings((s) => (s ? { ...s, [key]: value } : s));

      if (value && permission !== 'granted') {
        const ok = await ensurePermission();
        setPermission(await permissionState());
        if (!ok) {
          // Leave the switch on. The setting is a statement of what they want;
          // the banner above explains why nothing is arriving, and turning
          // their choice back off behind their back would be worse.
          return;
        }
      }
      await setNotificationSetting(key, value);
    },
    [permission],
  );

  const chooseTime = useCallback(async (time: string) => {
    setSettings((s) => (s ? { ...s, time } : s));
    setPicking(false);
    await setReminderTime(time);
  }, []);

  if (!settings) return <Screen title={t('notify.title')}>{null}</Screen>;

  return (
    <Screen title={t('notify.title')}>
      {permission === 'denied' ? (
        <Card gap={space.sm}>
          <Text style={[styles.blockedTitle, { color: theme.warn }]}>{t('notify.blocked')}</Text>
          <Text style={[styles.hint, { color: theme.textDim }]}>{t('notify.blockedHint')}</Text>
          <Pressable onPress={() => void Linking.openSettings()}>
            <Text style={[styles.link, { color: theme.accent }]}>{t('notify.openSettings')}</Text>
          </Pressable>
        </Card>
      ) : null}

      <Card gap={space.md}>
        <SectionLabel>{t('notify.sectionReminders')}</SectionLabel>

        <Row
          title={t('notify.daily')}
          hint={t('notify.dailyHint')}
          value={settings.daily}
          onChange={(v) => void toggle('daily', v)}
        />

        {/* Only meaningful while the reminder is on, so it hides rather than
            sitting there greyed out and inviting a tap that does nothing. */}
        {settings.daily ? (
          <Pressable
            onPress={() => setPicking(true)}
            style={[styles.timeRow, { borderColor: theme.borderStrong, backgroundColor: theme.surfaceAlt }]}
          >
            <Text style={{ color: theme.textDim, fontSize: type.small, flex: 1 }}>
              {t('notify.at')}
            </Text>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
              {settings.time}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: type.body }}>▾</Text>
          </Pressable>
        ) : null}

        <Row
          title={t('notify.due')}
          hint={t('notify.dueHint')}
          value={settings.due}
          onChange={(v) => void toggle('due', v)}
        />
        <Row
          title={t('notify.inbox')}
          hint={t('notify.inboxHint')}
          value={settings.inbox}
          onChange={(v) => void toggle('inbox', v)}
        />
        <Row
          title={t('notify.warranty')}
          hint={t('notify.warrantyHint')}
          value={settings.warranty}
          onChange={(v) => void toggle('warranty', v)}
        />
        <Row
          title={t('notify.backup')}
          hint={t('notify.backupHint')}
          value={settings.backup}
          onChange={(v) => void toggle('backup', v)}
        />
      </Card>

      <Card gap={space.sm}>
        <SectionLabel>{t('notify.sectionTrouble')}</SectionLabel>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('notify.troubleBody')}</Text>
        <Text style={[styles.path, { color: theme.text }]}>{t('notify.troublePath')}</Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('notify.troubleTiming')}</Text>
      </Card>

      <Card gap={space.xs}>
        <SectionLabel>{t('notify.sectionPrivacy')}</SectionLabel>
        <Text style={[styles.hint, { color: theme.textDim }]}>{t('notify.privacyBody')}</Text>
      </Card>

      <Sheet visible={picking} title={t('notify.at')} onClose={() => setPicking(false)}>
        <View style={styles.times}>
          {reminderTimeChoices().map((time) => {
            const active = time === settings.time;
            return (
              <Pressable
                key={time}
                onPress={() => void chooseTime(time)}
                style={[
                  styles.time,
                  {
                    backgroundColor: active ? theme.accentSoft : theme.surfaceAlt,
                    borderColor: active ? theme.accent : theme.borderStrong,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? theme.accent : theme.text,
                    fontSize: type.small,
                    fontWeight: '600',
                  }}
                >
                  {time}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </Screen>
  );
}

function Row({
  title,
  hint,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={{ color: theme.text, fontSize: type.body }}>{title}</Text>
        <Text style={[styles.hint, { color: theme.textDim }]}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, gap: 2 },
  hint: { fontSize: type.small, lineHeight: 19 },
  blockedTitle: { fontSize: type.body, fontWeight: '600' },
  link: { fontSize: type.small, fontWeight: '600' },
  path: { fontSize: type.small, fontWeight: '600', lineHeight: 19 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
  },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  time: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minWidth: 68,
    alignItems: 'center',
  },
});
