/**
 * Drawing a barcode with nothing but Views.
 *
 * No `react-native-svg`, and that is a deliberate saving rather than a
 * limitation: SVG is a native module, and a native module means another
 * `prebuild`, another thing that can fail on a Windows toolchain, and another
 * dependency to keep in step with the SDK. A 1D barcode is a row of black and
 * white rectangles, which `<View>` already is.
 *
 * QR codes are the same trick in two dimensions, with one optimisation that
 * matters: each row is drawn as *runs* of equal modules rather than one View
 * per module. A 33×33 QR is 1,089 modules but only a few hundred runs, which is
 * the difference between a screen that renders instantly and one that hitches.
 *
 * **What actually matters for scanning**, learned the hard way by everyone who
 * has held a phone up to a till:
 *
 *   - **A quiet zone.** White space either side, or the scanner never finds the
 *     start. Ten modules for 1D, four for QR — both in the specs, both routinely
 *     left out, and both invisible until it fails at the counter.
 *   - **Pure black on pure white**, never the theme's colours. A dark-mode
 *     barcode in `#E9ECF1` on `#12161A` is a barcode no laser reads.
 *   - **Height.** A 1D symbol needs enough vertical run for the beam to cross it
 *     even when the phone is at an angle.
 */
import { StyleSheet, View } from 'react-native';

const BLACK = '#000000';
const WHITE = '#FFFFFF';

/** Modules of blank either side. The spec says 10 for Code 128; EAN wants 9–11. */
const QUIET_1D = 10;
/** QR's mandatory four-module border. */
const QUIET_QR = 4;

/**
 * A 1D barcode from a list of bar widths in modules, starting black.
 *
 * The width of a module is computed from the space available rather than fixed,
 * so the symbol fills the card and stays crisp: every bar is a whole number of
 * modules times the same base width, which is what keeps the edges sharp on a
 * screen the scanner is reading at an angle.
 */
export function Barcode({
  widths,
  width,
  height = 96,
}: {
  widths: number[];
  /** Space available, in points. */
  width: number;
  height?: number;
}) {
  const totalModules = widths.reduce((a, b) => a + b, 0) + QUIET_1D * 2;
  const module = width / totalModules;

  return (
    <View style={[styles.wrap1d, { width, height, backgroundColor: WHITE }]}>
      <View style={{ width: QUIET_1D * module }} />
      {widths.map((w, i) => (
        <View
          key={i}
          style={{
            width: w * module,
            height: '100%',
            // Odd indexes are the gaps. Drawing them as white Views rather than
            // leaving them transparent keeps the symbol readable on any card
            // colour behind it.
            backgroundColor: i % 2 === 0 ? BLACK : WHITE,
          }}
        />
      ))}
      <View style={{ width: QUIET_1D * module }} />
    </View>
  );
}

/** A QR matrix: `isDark(row, col)` plus the module count. */
export interface QrMatrix {
  count: number;
  isDark: (row: number, col: number) => boolean;
}

export function QrCode({ matrix, size }: { matrix: QrMatrix; size: number }) {
  const total = matrix.count + QUIET_QR * 2;
  const module = size / total;
  const quiet = QUIET_QR * module;

  return (
    <View style={{ width: size, height: size, backgroundColor: WHITE, padding: quiet }}>
      {Array.from({ length: matrix.count }, (_, row) => (
        <View key={row} style={{ flexDirection: 'row', height: module }}>
          {runsFor(matrix, row).map((run, i) => (
            <View
              key={i}
              style={{
                width: run.length * module,
                height: module,
                backgroundColor: run.dark ? BLACK : WHITE,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Collapse a row of modules into runs of the same colour. */
function runsFor(matrix: QrMatrix, row: number): { dark: boolean; length: number }[] {
  const runs: { dark: boolean; length: number }[] = [];
  let current = matrix.isDark(row, 0);
  let length = 0;

  for (let col = 0; col < matrix.count; col += 1) {
    const dark = matrix.isDark(row, col);
    if (dark === current) {
      length += 1;
    } else {
      runs.push({ dark: current, length });
      current = dark;
      length = 1;
    }
  }
  runs.push({ dark: current, length });
  return runs;
}

const styles = StyleSheet.create({
  wrap1d: { flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden' },
});
