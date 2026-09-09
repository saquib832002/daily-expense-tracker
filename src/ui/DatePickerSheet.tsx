import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { addMonths, monthGrid, notInFuture, startOfDay } from '@/domain/dates';
import { dateLocale } from '@/i18n';
import { radius, space, type, useTheme } from '@/theme';

import { Sheet } from './index';

/**
 * A month calendar, in about a hundred lines and with no native dependency.
 *
 * `@react-native-community/datetimepicker` would be the obvious choice, but it
 * is another native module to build, and the add screen only ever needs "some
 * day in the recent past". Future days are disabled — you cannot spend money
 * you have not spent yet.
 */
export function DatePickerSheet({
  visible,
  value,
  title,
  onClose,
  onSelect,
  allowFuture = false,
}: {
  visible: boolean;
  value: number;
  title: string;
  onClose: () => void;
  onSelect: (ms: number) => void;
  /** Due dates look forward; spending dates never do. */
  allowFuture?: boolean;
}) {
  const theme = useTheme();
  const [cursor, setCursor] = useState(value);

  const view = new Date(cursor);
  const year = view.getFullYear();
  const monthIndex = view.getMonth();
  const today = startOfDay(Date.now());

  const weeks = useMemo(() => monthGrid(year, monthIndex, 0), [year, monthIndex]);

  const monthLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(dateLocale(), { month: 'long', year: 'numeric' }).format(view);
    } catch {
      return `${monthIndex + 1}/${year}`;
    }
  }, [year, monthIndex]);

  const weekdays = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat(dateLocale(), { weekday: 'narrow' });
      // 4 Jan 1970 was a Sunday — a stable anchor for a Sunday-first week.
      return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(1970, 0, 4 + i)));
    } catch {
      return ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    }
  }, []);

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={styles.nav}>
        <Pressable onPress={() => setCursor(addMonths(cursor, -1))} hitSlop={12}>
          <Text style={[styles.navArrow, { color: theme.accent }]}>‹</Text>
        </Pressable>
        <Text style={[styles.month, { color: theme.text }]}>{monthLabel}</Text>
        <Pressable
          onPress={() => setCursor(allowFuture ? addMonths(cursor, 1) : notInFuture(addMonths(cursor, 1)))}
          hitSlop={12}
        >
          <Text style={[styles.navArrow, { color: theme.accent }]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.week}>
        {weekdays.map((w, i) => (
          <Text key={i} style={[styles.weekday, { color: theme.textDim }]}>
            {w}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.week}>
          {week.map((day, di) => {
            if (day === null) return <View key={di} style={styles.cell} />;

            const ms = new Date(year, monthIndex, day).getTime();
            const selected = startOfDay(value) === ms;
            const future = !allowFuture && ms > today;

            return (
              <Pressable
                key={di}
                disabled={future}
                onPress={() => {
                  onSelect(ms);
                  onClose();
                }}
                style={[
                  styles.cell,
                  selected && { backgroundColor: theme.accent, borderRadius: radius.sm },
                ]}
              >
                <Text
                  style={{
                    color: selected ? theme.onAccent : future ? theme.border : theme.text,
                    fontSize: type.body,
                    fontWeight: selected ? '700' : '400',
                  }}
                >
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.sm,
    paddingBottom: space.md,
  },
  navArrow: { fontSize: 26, paddingHorizontal: space.md },
  month: { fontSize: type.body, fontWeight: '600' },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: type.tiny, paddingBottom: space.xs },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
});
