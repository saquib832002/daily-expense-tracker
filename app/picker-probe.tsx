/**
 * A probe, not a feature.
 *
 * Office mode rests on one assumption: that a staff member can hand this app a
 * file **somebody else owns**, through the Google Picker, and then *write* to
 * it — with only the `drive.file` scope. Every screen in the plan depends on
 * that, and none of it can be built honestly until it has been seen working on
 * a real phone against a real Drive account.
 *
 * So this screen does that one thing and reports exactly what came back. No
 * translations, no theming niceties, no persistence: it is meant to be deleted
 * the day step 3 starts, and a throwaway that pretends to be a product is a
 * throwaway nobody deletes.
 *
 * ## What it proves, in order
 *
 * 1. **The build can open the picker.** `pickFiles` exists in the native
 *    module, which only holds if play-services-auth is 21.6.0 or newer.
 * 2. **The picker runs and returns ids.** This is the step with real unknowns:
 *    the flow leaves for the browser and has to come back.
 * 3. **The app can read a file it did not create.** Metadata for the picked id.
 * 4. **The app can WRITE to it.** The decisive one. If this fails, office mode
 *    as planned does not work and the fallback in `docs/team-feasibility.md` —
 *    staff own their own files — is the design instead.
 *
 * ## How to run it
 *
 * Two Google accounts, which can be two phones or one phone and a browser.
 *
 *   A (the "owner")  — in Drive on a laptop, create a plain text file, then
 *                      share it with account B as an **Editor**
 *   B (the "staff")  — on the phone, open More → Picker probe, tap
 *                      "Open the picker", choose that file, then tap
 *                      "Append a line"
 *
 * If step 4 reports OK and the file on the laptop has grown a line, the plan
 * is sound.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  canPickFiles,
  isAvailable,
  pickFiles,
  signingInfo,
  type AuthResult,
} from '../modules/google-drive-auth';
import { space, type, useTheme } from '@/theme';
import { Card, Screen, SectionLabel } from '@/ui';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

interface Line {
  ok: boolean;
  text: string;
}

export default function PickerProbeScreen() {
  const theme = useTheme();
  const [log, setLog] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuthResult | null>(null);
  const [restrictTo, setRestrictTo] = useState('');

  const say = useCallback((ok: boolean, text: string) => {
    setLog((previous) => [...previous, { ok, text }]);
  }, []);

  const reset = useCallback(() => {
    setLog([]);
    setResult(null);
  }, []);

  /* ------------------------------------------------------------ 1 and 2 */

  const openPicker = useCallback(async () => {
    reset();
    setBusy(true);
    try {
      say(isAvailable(), `native module present: ${isAvailable()}`);
      say(canPickFiles(), `pickFiles compiled in: ${canPickFiles()}`);
      const signing = signingInfo();
      say(true, `package ${signing?.packageName ?? '?'}`);
      say(true, `SHA-1 ${signing?.sha1 || 'unavailable'}`);

      if (!canPickFiles()) {
        say(false, 'STOP: this build has no picker. Check play-services-auth is 21.6.0+.');
        return;
      }

      say(true, 'opening the picker — the browser will take over…');
      const picked = await pickFiles({
        allowMultiple: true,
        fileIds: restrictTo.trim() || undefined,
      });
      setResult(picked);

      say(picked.outcome === 'granted', `outcome: ${picked.outcome}`);
      if (picked.code != null) say(false, `code: ${picked.code}${picked.code === 10 ? ' (DEVELOPER_ERROR — SHA-1 not registered)' : ''}`);
      if (picked.message) say(false, `message: ${picked.message}`);
      say(picked.token != null, `access token: ${picked.token ? 'yes' : 'no'}`);
      say(
        picked.pickedFileIds.length > 0,
        `picked ${picked.pickedFileIds.length} file(s): ${picked.pickedFileIds.join(', ') || '—'}`,
      );

      if (!picked.token || picked.pickedFileIds.length === 0) {
        say(false, 'STOP: nothing to test against.');
        return;
      }

      /* ------------------------------------------------------------- 3 */

      for (const id of picked.pickedFileIds) {
        try {
          const res = await fetch(
            `${DRIVE}/files/${id}?fields=id,name,mimeType,size,owners(emailAddress),capabilities(canEdit)`,
            { headers: { Authorization: `Bearer ${picked.token}` } },
          );
          const body = await res.text();
          if (!res.ok) {
            say(false, `READ ${id} → HTTP ${res.status}: ${body.slice(0, 200)}`);
            continue;
          }
          const file = JSON.parse(body) as {
            name?: string;
            mimeType?: string;
            size?: string;
            owners?: { emailAddress?: string }[];
            capabilities?: { canEdit?: boolean };
          };
          say(true, `READ ok — "${file.name}" (${file.mimeType}, ${file.size ?? '?'} bytes)`);
          // The interesting line. If the owner is somebody else, drive.file has
          // genuinely reached a file this app did not create.
          say(true, `owner: ${file.owners?.[0]?.emailAddress ?? 'unknown'}`);
          say(!!file.capabilities?.canEdit, `Drive says canEdit: ${file.capabilities?.canEdit}`);
        } catch (e) {
          say(false, `READ ${id} threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [reset, say, restrictTo]);

  /* ---------------------------------------------------------------- 4 */

  /**
   * The decisive test: append to somebody else's file.
   *
   * Read-then-write rather than a patch, because Drive has no append. That is
   * fine for a probe; the real sync appends a line to a `.jsonl` the same way
   * and relies on one writer per file so there is nothing to race against.
   */
  const appendLine = useCallback(async () => {
    if (!result?.token || result.pickedFileIds.length === 0) return;
    setBusy(true);
    try {
      const id = result.pickedFileIds[0]!;
      const token = result.token;

      const readRes = await fetch(`${DRIVE}/files/${id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!readRes.ok) {
        say(false, `content read → HTTP ${readRes.status}`);
        return;
      }
      const existing = await readRes.text();
      say(true, `current length: ${existing.length} chars`);

      const line = `{"probe":true,"at":${Date.now()}}`;
      const next = existing.endsWith('\n') || existing === '' ? existing + line + '\n' : existing + '\n' + line + '\n';

      const writeRes = await fetch(`${UPLOAD}/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: next,
      });
      const writeBody = await writeRes.text();

      if (writeRes.ok) {
        say(true, 'WRITE ok — office mode is viable. Check the file on the other account.');
      } else {
        say(false, `WRITE → HTTP ${writeRes.status}: ${writeBody.slice(0, 300)}`);
        say(false, 'If this is 403, drive.file cannot write a picked file and the fallback design applies.');
      }
    } catch (e) {
      say(false, `WRITE threw: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [result, say]);

  const canAppend = !busy && !!result?.token && result.pickedFileIds.length > 0;

  return (
    <Screen title="Picker probe">
      <Card gap={space.sm}>
        <SectionLabel>What this is</SectionLabel>
        <Text style={[styles.body, { color: theme.textDim }]}>
          A throwaway test of the one assumption office mode rests on: that this app can be handed a
          file another Google account owns, and write to it, with only the drive.file scope.
        </Text>
        <Text style={[styles.body, { color: theme.textDim }]}>
          Share a text file from another account to this one as Editor first, then pick it below.
        </Text>
      </Card>

      <Card gap={space.sm}>
        <SectionLabel>Restrict the picker (optional)</SectionLabel>
        <TextInput
          value={restrictTo}
          onChangeText={setRestrictTo}
          placeholder="comma-separated file ids"
          placeholderTextColor={theme.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { color: theme.text, borderColor: theme.borderStrong }]}
        />
        <Text style={[styles.hint, { color: theme.textDim }]}>
          Leave empty to browse everything. The real join flow passes the ids from the invite.
        </Text>
      </Card>

      <Card gap={space.sm}>
        <Btn label="Open the picker" onPress={() => void openPicker()} disabled={busy} />
        <Btn label="Append a line to the first file" onPress={() => void appendLine()} disabled={!canAppend} />
        <Btn label="Clear" onPress={reset} disabled={busy} variant="quiet" />
        {busy ? <ActivityIndicator color={theme.accent} /> : null}
      </Card>

      <Card gap={space.xs}>
        <SectionLabel>Result</SectionLabel>
        {log.length === 0 ? (
          <Text style={[styles.hint, { color: theme.textDim }]}>Nothing run yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              {log.map((line, i) => (
                <Text
                  key={i}
                  style={[styles.mono, { color: line.ok ? theme.text : theme.danger }]}
                >
                  {line.ok ? '· ' : '! '}
                  {line.text}
                </Text>
              ))}
            </View>
          </ScrollView>
        )}
      </Card>
    </Screen>
  );
}

function Btn({
  label,
  onPress,
  disabled,
  variant,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'quiet';
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        {
          borderColor: variant === 'quiet' ? theme.borderStrong : theme.accent,
          backgroundColor: pressed ? theme.accentSoft : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text style={{ color: variant === 'quiet' ? theme.textDim : theme.accent, fontSize: type.body, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: type.small, lineHeight: 20 },
  hint: { fontSize: type.tiny, lineHeight: 17 },
  mono: { fontSize: 12, lineHeight: 18, fontFamily: 'monospace' },
  input: { borderWidth: 1, borderRadius: 8, padding: space.sm, fontSize: type.small },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: space.sm, alignItems: 'center' },
});
