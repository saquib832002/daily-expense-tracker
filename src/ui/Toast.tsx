/**
 * A confirmation that something happened.
 *
 * This exists because of a real complaint about the add screen: tapping a
 * category saved the expense **silently**. The only acknowledgement was a
 * thirteen-point line of text swapping places with the hint that had been there
 * a moment earlier, in the middle of a screen whose numbers had just reset to
 * zero. Two people can read that same screen as "saved" and "nothing happened",
 * and the second reading is the one that makes someone enter the expense twice.
 *
 * So the rules this follows, in order of how much they matter:
 *
 *   1. **It moves.** A thing that slides in is noticed; a thing that swaps text
 *      in place is not. Motion is the whole mechanism.
 *   2. **It says what was saved**, with the amount and the category, because
 *      "Saved" alone does not tell you whether it saved what you meant.
 *   3. **It leaves on its own.** A confirmation that needs dismissing is a
 *      second chore added to the first.
 *   4. **It carries the undo**, for as long as it is on screen. That is the
 *      moment someone realises the amount was wrong, and the moment they are
 *      still looking at the place where it can be fixed.
 *
 * `useNativeDriver` throughout: this animates while the keypad is still
 * settling, and a confirmation that stutters is worse than none.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, space, type, useTheme } from '@/theme';

/** How long it stays. Long enough to read twice, short enough not to nag. */
export const TOAST_MS = 4000;

export function Toast({
  visible,
  /** Distance from the top of the parent. See the note in the add screen. */
  top,
  title,
  detail,
  actionLabel,
  onAction,
  onHide,
  tone = 'success',
}: {
  visible: boolean;
  top?: number;
  title: string;
  /** The specifics — what was saved, in this case. */
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Called when it has finished leaving, so the caller can clear its state. */
  onHide: () => void;
  tone?: 'success' | 'warn';
}) {
  const theme = useTheme();
  const slide = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onHide();
    });
  }, [slide, onHide]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (!visible) {
      slide.setValue(0);
      return;
    }

    // Re-entering from zero every time, so a second save while the first is
    // still on screen reads as a new confirmation rather than as the old one
    // quietly changing its text.
    slide.setValue(0);
    Animated.spring(slide, {
      toValue: 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 220,
      mass: 0.7,
    }).start();

    timer.current = setTimeout(hide, TOAST_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visible, title, detail, slide, hide]);

  if (!visible) return null;

  const accent = tone === 'warn' ? theme.warn : theme.income;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          ...(top === undefined ? null : { top }),
          opacity: slide,
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
          ],
        },
      ]}
    >
      <View
        // Android reads this out to TalkBack without stealing focus, which is
        // the accessible equivalent of the thing this component exists to fix.
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          { backgroundColor: theme.surface, borderColor: accent, shadowColor: '#000' },
        ]}
      >
        <View style={[styles.tick, { backgroundColor: accent }]}>
          <Text style={[styles.tickMark, { color: theme.onAccent }]}>✓</Text>
        </View>

        <View style={styles.text}>
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
          {detail ? (
            <Text style={[styles.detail, { color: theme.textDim }]} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>

        {actionLabel && onAction ? (
          <Pressable
            onPress={() => {
              if (timer.current) clearTimeout(timer.current);
              onAction();
              hide();
            }}
            hitSlop={10}
            style={({ pressed }) => [
              styles.action,
              { borderColor: theme.borderStrong, backgroundColor: pressed ? theme.surfaceAlt : 'transparent' },
            ]}
          >
            <Text style={[styles.actionText, { color: theme.danger }]}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: space.sm,
    left: space.lg,
    right: space.lg,
    zIndex: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    // Lifted off the screen behind it, or it reads as part of the layout
    // rather than as something that just happened.
    elevation: 6,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  tick: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tickMark: { fontSize: type.small, fontWeight: '900' },
  text: { flex: 1, gap: 1 },
  title: { fontSize: type.body, fontWeight: '700' },
  detail: { fontSize: type.small },
  action: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  actionText: { fontSize: type.small, fontWeight: '700' },
});
