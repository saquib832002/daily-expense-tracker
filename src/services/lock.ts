/**
 * The app lock.
 *
 * A fingerprint in front of the ledger. Note what this is and is not: it stops
 * someone who picks up an unlocked phone from reading your spending. It does
 * not encrypt the database — that arrives with the sync work, when there is a
 * key worth protecting. Saying so plainly matters more than the feature.
 */
import * as LocalAuthentication from 'expo-local-authentication';

import { getSetting, setSetting } from '@/db/queries';

const KEY = 'lock_enabled';

export async function isLockAvailable(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

export async function isLockEnabled(): Promise<boolean> {
  return (await getSetting(KEY)) === '1';
}

export async function setLockEnabled(on: boolean): Promise<void> {
  await setSetting(KEY, on ? '1' : '0');
}

export interface UnlockResult {
  ok: boolean;
  /** True when the user cancelled rather than failed — used to avoid nagging. */
  cancelled: boolean;
}

export async function unlock(promptMessage: string, cancelLabel: string): Promise<UnlockResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      // Let the phone's PIN or pattern work too — a fingerprint sensor that
      // stops reading in winter should not lock someone out of their own data.
      disableDeviceFallback: false,
    });
    if (result.success) return { ok: true, cancelled: false };
    const reason = 'error' in result ? String(result.error) : '';
    return { ok: false, cancelled: reason.includes('cancel') || reason === 'user_cancel' };
  } catch {
    return { ok: false, cancelled: false };
  }
}
