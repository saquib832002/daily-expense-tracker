import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus, StyleSheet, Text, View } from 'react-native';

import { t } from '@/i18n';
import { isLockAvailable, isLockEnabled, unlock } from '@/services/lock';
import { space, type, useTheme } from '@/theme';

import { Button } from './index';

/** Re-lock after this long in the background. Short enough to matter, long
 *  enough that answering a message does not make you re-authenticate. */
const RELOCK_AFTER_MS = 2 * 60 * 1000;

/**
 * Holds the app behind a fingerprint when the lock is on.
 *
 * This hides the screen; it does not encrypt the database. That distinction is
 * stated in Settings rather than left for the user to assume, because a lock
 * that implies more protection than it gives is worse than no lock.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  const attempt = useCallback(async () => {
    setFailed(false);
    const res = await unlock(t('lock.prompt'), t('common.cancel'));
    if (res.ok) setUnlocked(true);
    else if (!res.cancelled) setFailed(true);
  }, []);

  // Decide once, on launch, whether the gate applies at all.
  useEffect(() => {
    (async () => {
      const on = (await isLockEnabled()) && (await isLockAvailable());
      setEnabled(on);
      if (on) attempt();
      else setUnlocked(true);
    })();
  }, [attempt]);

  // Re-lock after a spell in the background.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state === 'active' && backgroundedAt.current) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away > RELOCK_AFTER_MS) {
          setUnlocked(false);
          attempt();
        }
      }
    });
    return () => sub.remove();
  }, [enabled, attempt]);

  if (enabled === null) return null; // one frame, before we know
  if (unlocked) return <>{children}</>;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.bg }]}>
      <Text style={styles.icon}>🔒</Text>
      <Text style={[styles.title, { color: theme.text }]}>{t('app.name')}</Text>
      <Text style={[styles.body, { color: theme.textDim }]}>
        {failed ? t('lock.failed') : t('lock.locked')}
      </Text>
      <View style={styles.action}>
        <Button label={t('lock.unlock')} onPress={attempt} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  icon: { fontSize: 42 },
  title: { fontSize: type.title, fontWeight: '600' },
  body: { fontSize: type.small, textAlign: 'center', maxWidth: 280, lineHeight: 19 },
  action: { alignSelf: 'stretch', paddingTop: space.md, maxWidth: 280, width: '100%' },
});
