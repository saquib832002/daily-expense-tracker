/**
 * The shared UI kit.
 *
 * Phase 1 repeated StyleSheet blocks in every screen; Phase 2 pulls them here
 * so a change to how a row or a card looks happens in one place. Everything
 * reads its colours from `useTheme`, so light and dark both work by default.
 */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, space, type, useTheme } from '@/theme';

/* ------------------------------------------------------------------ screen */

export function Screen({
  title,
  back,
  right,
  scroll = true,
  children,
}: {
  title?: string;
  back?: boolean;
  right?: ReactNode;
  scroll?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const router = useRouter();
  const Body = scroll ? ScrollView : View;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {title ? (
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          {back ? (
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
              <Text style={{ color: theme.accent, fontSize: 22 }}>‹</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.headerRight}>{right}</View>
        </View>
      ) : null}
      <Body style={scroll ? undefined : styles.flex} contentContainerStyle={scroll ? styles.body : undefined}>
        {children}
      </Body>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------- card */

export function Card({ children, gap = space.md }: { children: ReactNode; gap?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, gap }]}>
      {children}
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.sectionLabel, { color: theme.textDim }]}>{children}</Text>;
}

export function EmptyState({ text }: { text: string }) {
  const theme = useTheme();
  return <Text style={[styles.empty, { color: theme.textDim }]}>{text}</Text>;
}

/* --------------------------------------------------------------------- row */

export function ListRow({
  icon,
  title,
  subtitle,
  value,
  valueColor,
  onPress,
  chevron,
  last,
}: {
  icon?: string;
  title: string;
  subtitle?: string | null;
  value?: string;
  valueColor?: string;
  onPress?: () => void;
  chevron?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: 1, borderBottomColor: theme.border },
        pressed && onPress ? { backgroundColor: theme.surfaceAlt } : null,
      ]}
    >
      {icon ? <Text style={styles.rowIcon}>{icon}</Text> : null}
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: theme.textDim }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.rowValue, { color: valueColor ?? theme.text }]}>{value}</Text>
      ) : null}
      {chevron ? <Text style={{ color: theme.textDim, fontSize: 18 }}>›</Text> : null}
    </Pressable>
  );
}

/** A card whose children are ListRows, with the borders working out. */
export function RowGroup({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ button */

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const bg =
    variant === 'primary' ? theme.accent : variant === 'danger' ? theme.danger : 'transparent';
  const fg =
    variant === 'secondary' ? theme.text : variant === 'danger' ? theme.onAccent : theme.onAccent;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === 'secondary' ? theme.border : bg,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={{ color: fg, fontWeight: '600', fontSize: type.body }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.accentSoft : theme.surface,
          borderColor: active ? theme.accent : theme.border,
        },
      ]}
    >
      <Text
        style={{
          color: active ? theme.accent : theme.textDim,
          fontSize: type.small,
          fontWeight: '600',
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------------- field */

export function Field({
  label,
  ...props
}: TextInputProps & { label?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.xs, flex: props.style ? 1 : undefined }}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: theme.textDim }]}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={theme.textDim}
        {...props}
        style={[
          styles.input,
          { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg },
          props.style,
        ]}
      />
    </View>
  );
}

/* ------------------------------------------------------------------- sheet */

/** A bottom sheet built on Modal — no extra native dependency. */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: theme.text }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={{ color: theme.accent, fontSize: type.body }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: space.xl, gap: space.sm }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
  },
  back: { paddingRight: space.xs },
  headerTitle: { flex: 1, fontSize: type.title, fontWeight: '600' },
  headerRight: { flexDirection: 'row', gap: space.sm },
  body: { padding: space.lg, gap: space.lg },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
  group: { borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  sectionLabel: {
    fontSize: type.tiny,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  empty: { fontSize: type.small, textAlign: 'center', paddingVertical: space.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.md,
  },
  rowIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: type.body },
  rowSubtitle: { fontSize: type.tiny },
  rowValue: { fontSize: type.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  button: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 160,
  },
  fieldLabel: { fontSize: type.tiny, textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: type.body,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  sheetTitle: { fontSize: type.body, fontWeight: '600' },
});
