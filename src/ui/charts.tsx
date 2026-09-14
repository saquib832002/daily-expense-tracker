/**
 * Charts, drawn with plain Views.
 *
 * No SVG, no charting library, no extra native module — which keeps the build
 * simple, but that is not the main reason. The two questions this app answers
 * are both about MAGNITUDE ("where did it go", "how much per day"), and
 * magnitude is read most accurately from a common baseline. So: ranked
 * horizontal bars and a column series, both single-series.
 *
 * A single series needs no legend and no categorical palette — identity is
 * carried by the label on every row, and the colour only has to separate the
 * mark from the surface. That removes an entire class of colour-blindness
 * problems rather than mitigating it.
 */
import { Pressable, StyleSheet, Text, View, I18nManager } from 'react-native';

import { niceMax } from '@/domain/report';
import { radius, space, type, useTheme } from '@/theme';

/* -------------------------------------------------------------- ranked bars */

export interface RankedBarItem {
  key: string;
  label: string;
  icon?: string | null;
  /** Positive minor units. */
  amountMinor: number;
  /** 0–1 share of the total. */
  fraction: number;
  /** Pre-formatted for display; this component never formats money itself. */
  amountLabel: string;
  /** Optional tint for the mark — falls back to the accent colour. */
  tint?: string | null;
}

/**
 * "Where the money went" — biggest first, every row labelled with its name,
 * amount and share. The bar is a proportion of the LARGEST row, not of the
 * total, because that is what makes the comparison between rows legible.
 */
export function RankedBars({ items }: { items: RankedBarItem[] }) {
  const theme = useTheme();
  if (items.length === 0) return null;

  const largest = Math.max(...items.map((i) => i.amountMinor), 1);

  return (
    <View style={styles.ranked}>
      {items.map((item) => (
        <View key={item.key} style={styles.rankedRow}>
          <View style={styles.rankedHead}>
            <Text style={styles.rankedIcon}>{item.icon ?? '•'}</Text>
            <Text style={[styles.rankedLabel, { color: theme.text }]} numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={[styles.rankedShare, { color: theme.textDim }]}>
              {Math.round(item.fraction * 100)}%
            </Text>
            <Text style={[styles.rankedAmount, { color: theme.text }]}>{item.amountLabel}</Text>
          </View>

          <View style={[styles.rankedTrack, { backgroundColor: theme.surfaceAlt }]}>
            <View
              style={[
                styles.rankedFill,
                {
                  backgroundColor: item.tint ?? theme.accent,
                  width: `${Math.max(2, (item.amountMinor / largest) * 100)}%`,
                },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ columns */

export interface ColumnPoint {
  key: string;
  /** Positive minor units. */
  amountMinor: number;
  /** Shown under the column. Pass '' to leave a column unlabelled. */
  label: string;
  /** Draws this column in the accent colour — used for "this month". */
  highlight?: boolean;
}

/**
 * A column series over time. Empty buckets are drawn as empty, never skipped —
 * a spending chart with days missing lies about the rhythm of a month.
 *
 * The upper bound is a round number so the reference line means something.
 */
export function Columns({
  points,
  height = 120,
  maxLabel,
  averageMinor,
}: {
  points: ColumnPoint[];
  height?: number;
  /** Pre-formatted label for the top gridline. */
  maxLabel?: string;
  /** Draws a dashed reference line at the average. */
  averageMinor?: number;
}) {
  const theme = useTheme();
  if (points.length === 0) return null;

  const peak = Math.max(...points.map((p) => p.amountMinor), 0);
  const ceiling = niceMax(peak);

  return (
    <View style={styles.columns}>
      {maxLabel ? (
        <Text style={[styles.ceilingLabel, { color: theme.textDim }]}>{maxLabel}</Text>
      ) : null}

      <View style={[styles.plot, { height, borderColor: theme.border }]}>
        {/* Recessive top gridline. */}
        <View style={[styles.gridline, { backgroundColor: theme.border, top: 0 }]} />

        {averageMinor != null && averageMinor > 0 ? (
          <View
            style={[
              styles.average,
              {
                borderColor: theme.textDim,
                bottom: (averageMinor / ceiling) * height,
              },
            ]}
          />
        ) : null}

        <View style={styles.bars}>
          {points.map((p) => (
            <View key={p.key} style={styles.barSlot}>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(p.amountMinor > 0 ? 3 : 0, (p.amountMinor / ceiling) * height),
                    backgroundColor: p.highlight ? theme.accent : theme.textDim,
                    opacity: p.highlight ? 1 : 0.55,
                  },
                ]}
              />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.bars}>
        {points.map((p) => (
          <View key={p.key} style={styles.barSlot}>
            <Text style={[styles.tick, { color: theme.textDim }]} numberOfLines={1}>
              {p.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------- meter */

/**
 * One quantity against a limit.
 *
 * The optional `paceFraction` marker is the whole point of this component: a
 * budget 78% spent is fine on day 25 and alarming on day 8, and a bare
 * progress bar cannot tell you which. The marker is where the calendar says
 * you should be, so the gap between fill and marker *is* the answer.
 */
export function Meter({
  fraction,
  paceFraction,
  color,
  trackColor,
  height = 10,
}: {
  /** 0–1+. Values above 1 are clamped; the caller shows "over" some other way. */
  fraction: number;
  /** 0–1, where the period marker sits. Omitted for a plain progress bar. */
  paceFraction?: number;
  color: string;
  trackColor: string;
  height?: number;
}) {
  const theme = useTheme();
  const width = Math.min(100, Math.max(0, fraction * 100));

  return (
    <View style={[styles.meterTrack, { backgroundColor: trackColor, height }]}>
      <View style={[styles.meterFill, { backgroundColor: color, width: `${width}%` }]} />
      {paceFraction != null ? (
        <View
          style={[
            styles.meterMarker,
            // `start`, not `left`. React Native flips start/end for RTL but
            // leaves left/right exactly where you put them, so a meter that
            // fills from the right in Arabic needs its "you are here" marker
            // measured from the right too.
            {
              start: `${Math.min(100, Math.max(0, paceFraction * 100))}%`,
              backgroundColor: theme.text,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------ summary tile */

/**
 * One square in the summary row at the top of the dashboard.
 *
 * Three of these sit side by side, so they must stay equal: the square shape
 * comes from `aspectRatio`, not from a fixed height, which keeps them square on
 * a 5-inch phone and a tablet alike. The value shrinks to fit rather than
 * wrapping — a lakh figure that wraps onto two lines breaks the row's rhythm,
 * and these three numbers are read as a set.
 *
 * The dot carries the same meaning as the value's colour, so a reader who
 * cannot separate the hues still has the label right beside it.
 */
export function SummaryTile({
  label,
  value,
  hint,
  hintColor,
  accent,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string | null;
  hintColor?: string;
  /** The dot and the value take this colour. Pass the text colour for neutral. */
  accent: string;
  onPress?: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          borderColor: theme.border,
          backgroundColor: pressed && onPress ? theme.surfaceAlt : theme.surface,
        },
      ]}
    >
      <View style={styles.tileHead}>
        <View style={[styles.tileDot, { backgroundColor: accent }]} />
        <Text style={[styles.tileLabel, { color: theme.textDim }]} numberOfLines={1}>
          {label}
        </Text>
      </View>

      <Text
        style={[styles.tileValue, { color: accent }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </Text>

      <Text style={[styles.tileHint, { color: hintColor ?? theme.textDim }]} numberOfLines={2}>
        {hint ?? ''}
      </Text>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- stat tile */

/** Sometimes the honest answer is a number, not a chart. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string | null;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const theme = useTheme();
  const color =
    tone === 'good'
      ? theme.income
      : tone === 'warn'
        ? theme.warn
        : tone === 'bad'
          ? theme.danger
          : theme.text;

  return (
    <View style={[styles.stat, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={[styles.statLabel, { color: theme.textDim }]}>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {hint ? <Text style={[styles.statHint, { color: theme.textDim }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ranked: { gap: space.md },
  rankedRow: { gap: space.xs },
  rankedHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rankedIcon: { fontSize: 15 },
  rankedLabel: { flex: 1, fontSize: type.small },
  // React Native has no textAlign: 'end', and it does not mirror 'right'
  // either, so the flip has to be asked for by hand.
  rankedShare: {
    fontSize: type.tiny,
    fontVariant: ['tabular-nums'],
    minWidth: 30,
    textAlign: I18nManager.isRTL ? 'left' : 'right',
  },
  rankedAmount: { fontSize: type.small, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rankedTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  rankedFill: { height: '100%', borderRadius: radius.pill },

  columns: { gap: space.xs },
  ceilingLabel: { fontSize: type.tiny, fontVariant: ['tabular-nums'] },
  plot: { justifyContent: 'flex-end', position: 'relative' },
  gridline: { position: 'absolute', left: 0, right: 0, height: 1 },
  average: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  tick: { fontSize: 9, paddingTop: 2 },

  tile: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    justifyContent: 'space-between',
  },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileDot: { width: 6, height: 6, borderRadius: radius.pill },
  tileLabel: { flex: 1, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase' },
  // Proportional figures: equal-width digits make a big number look loose.
  tileValue: { fontSize: 21, fontWeight: '700', letterSpacing: -0.6 },
  tileHint: { fontSize: 10, lineHeight: 13 },

  meterTrack: { width: '100%', borderRadius: radius.pill, overflow: 'hidden', position: 'relative' },
  meterFill: { height: '100%', borderRadius: radius.pill },
  meterMarker: { position: 'absolute', top: 0, bottom: 0, width: 2, opacity: 0.45 },

  stat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
    minWidth: 110,
  },
  statLabel: { fontSize: type.tiny, textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statHint: { fontSize: type.tiny },
});
