/**
 * JS side of the Drive authorization module.
 *
 * Everything here tolerates the native half being absent. A JS bundle can be
 * newer than the APK it is running in — that is exactly what happened with the
 * bill scanner, where the app claimed a photo was unreadable when the truth was
 * that the phone had never been given a build containing the scanner. So
 * `isAvailable()` asks the native registry, not the JS wrapper.
 *
 * The other lesson is newer and cost a round of its own: the first version of
 * this file returned `string | null`, which meant "you closed the account
 * picker" and "Google refused this build's signature" arrived as the same
 * value. On screen both looked like a button that does nothing. Nothing here
 * returns a bare token any more — every call answers with an outcome that has a
 * name, and the screen is expected to say which one happened.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The one scope this app ever asks for. It grants access to files THIS app
 * creates in the user's Drive, and to nothing else they own. Google classifies
 * it as non-sensitive, which is why publishing needs no security assessment and
 * costs nothing.
 */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/**
 * `10` is Play Services' DEVELOPER_ERROR, and it is the answer far more often
 * than anything else: the SHA-1 of the key that signed the running APK is not
 * registered against an Android OAuth client for this package name in the
 * Google Cloud Console. Debug key versus release key, or your release key
 * versus the one Play App Signing re-signed with.
 */
export const DEVELOPER_ERROR = 10;

export type AuthOutcome =
  /** A token. Use it. */
  | 'granted'
  /** The user backed out, or consent is needed and we were told not to ask. */
  | 'cancelled'
  /** Google refused. `code` and `message` say why. */
  | 'failed'
  /** We returned to the foreground and Android never delivered a result. */
  | 'noResult'
  /** This build has no Drive support compiled in. */
  | 'unavailable';

export interface AuthResult {
  outcome: AuthOutcome;
  token: string | null;
  code: number | null;
  message: string | null;
  /**
   * Did the account picker and consent screen actually run before this answer?
   *
   * The difference between a cancel that happened after the user picked an
   * account and one that happened before anything was shown. Android reports
   * both as a bare RESULT_CANCELED with no code, so this flag is the only way
   * to tell "I changed my mind" from "Play Services silently refused this
   * build's signature" — which are the two things that look identical and need
   * opposite responses.
   */
  afterConsent: boolean;
}

export interface SigningInfo {
  packageName: string;
  /** Colon-separated uppercase hex, the format the Cloud Console expects. */
  sha1: string;
  sha256: string;
}

interface GoogleDriveAuthNativeModule {
  authorize(scopes: string[]): Promise<AuthResult>;
  authorizeSilently(scopes: string[]): Promise<AuthResult>;
  signingInfo(): SigningInfo;
}

const native = requireOptionalNativeModule<GoogleDriveAuthNativeModule>('GoogleDriveAuth');

/** False when this build was made before Drive backup existed. */
export function isAvailable(): boolean {
  return native != null;
}

const UNAVAILABLE: AuthResult = {
  outcome: 'unavailable',
  token: null,
  code: null,
  message: null,
  afterConsent: false,
};

/** Get a token, asking the user if needed. */
export async function authorize(): Promise<AuthResult> {
  if (!native) return UNAVAILABLE;
  try {
    return await native.authorize([DRIVE_FILE_SCOPE]);
  } catch (e) {
    // A rejection from the native side is a bug in the bridge rather than an
    // answer from Google, but it still has to arrive as an outcome rather than
    // an exception nobody catches.
    return {
      outcome: 'failed',
      token: null,
      code: null,
      message: e instanceof Error ? e.message : String(e),
      afterConsent: false,
    };
  }
}

/**
 * Get a token without showing anything. `cancelled` means consent is needed,
 * which during a scheduled backup means "skip Drive and stay quiet".
 */
export async function authorizeSilently(): Promise<AuthResult> {
  if (!native) return UNAVAILABLE;
  try {
    return await native.authorizeSilently([DRIVE_FILE_SCOPE]);
  } catch {
    return { outcome: 'cancelled', token: null, code: null, message: null, afterConsent: false };
  }
}

/**
 * How this build identifies itself to Google — the thing to paste into the
 * Cloud Console. Null when the native half is missing.
 */
export function signingInfo(): SigningInfo | null {
  if (!native) return null;
  try {
    const info = native.signingInfo();
    return info.sha1 ? info : { ...info, sha1: '', sha256: '' };
  } catch {
    return null;
  }
}
