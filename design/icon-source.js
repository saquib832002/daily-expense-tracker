/**
 * The icon, as vector source.
 *
 * Everything is drawn once in a 512-unit space and placed by transform, so the
 * same artwork produces the 1024 app icon, the masked Android foreground, the
 * monochrome themed icon and the Play Store 512 with no redrawing and no
 * resampling. Change the mark here and every deliverable follows.
 */
const GREEN_DEEP = '#0E3E35';
const GREEN_MID  = '#1B6B58';
const GREEN      = '#14574B';
const ACCENT     = '#2E9B7F';
const CREAM      = '#FBF8F1';
const PAPER_LINE = '#C3CBC6';

/** Bounding box of the mark inside the 512 space. Drives every placement. */
const MARK = { x: 144, y: 132, w: 224, h: 240 };
const MARK_CX = MARK.x + MARK.w / 2;
const MARK_CY = MARK.y + MARK.h / 2;

/**
 * Place the mark so it stands `fraction` of the canvas tall, centred.
 * The Android foreground uses a smaller fraction than the plain icon because a
 * launcher may mask it to a circle, and a circle inscribed in the square cuts
 * the corners off anything larger than about 61%.
 */
function place(canvas, fraction) {
  const s = (fraction * canvas) / MARK.h;
  return `translate(${canvas / 2 - MARK_CX * s} ${canvas / 2 - MARK_CY * s}) scale(${s})`;
}

/**
 * The receipt itself: a torn foot, one printed line, three rising bars.
 *
 * Deliberately fewer parts than the first draft. Two text lines and three thin
 * bars looked considered at 200px and turned to porridge at 48, which is the
 * size that actually decides whether someone finds the app on a crowded home
 * screen. One line and three fat bars survive the shrink.
 */
function mark({ mono = false } = {}) {
  const x0 = MARK.x, x1 = MARK.x + MARK.w;
  const footTop = 348, tooth = 20, teeth = 4;
  const w = (x1 - x0) / teeth;
  let zig = `L${x1},${footTop} `;
  for (let i = 0; i < teeth; i++) {
    zig += `L${x1 - i * w - w / 2},${footTop + tooth} L${x1 - (i + 1) * w},${footTop} `;
  }
  const body = `M${x0},${MARK.y + 28} a28,28 0 0 1 28,-28 h168 a28,28 0 0 1 28,28 ${zig} Z`;

  // Bars share a baseline so the eye reads a chart rather than three shapes.
  const base = 324;
  const bars = [
    { x: 180, h: 50 },
    { x: 236, h: 78 },
    { x: 292, h: 106 },
  ];
  const line = { x: 180, y: 166, w: 104, h: 20 };

  if (mono) {
    // One colour with the detail knocked out, because Android tints themed
    // icons to a single ink and anything relying on colour disappears.
    return `
    <mask id="knock">
      <rect x="0" y="0" width="512" height="512" fill="#fff"/>
      <rect x="${line.x}" y="${line.y}" width="${line.w}" height="${line.h}" rx="10" fill="#000"/>
      ${bars.map((b) => `<rect x="${b.x}" y="${base - b.h}" width="40" height="${b.h}" rx="10" fill="#000"/>`).join('')}
    </mask>
    <path d="${body}" fill="#000" mask="url(#knock)"/>`;
  }

  return `
  <path d="${body}" fill="${CREAM}"/>
  <rect x="${line.x}" y="${line.y}" width="${line.w}" height="${line.h}" rx="10" fill="${PAPER_LINE}"/>
  <rect x="${bars[0].x}" y="${base - bars[0].h}" width="40" height="${bars[0].h}" rx="10" fill="${GREEN}"/>
  <rect x="${bars[1].x}" y="${base - bars[1].h}" width="40" height="${bars[1].h}" rx="10" fill="${GREEN}"/>
  <rect x="${bars[2].x}" y="${base - bars[2].h}" width="40" height="${bars[2].h}" rx="10" fill="${ACCENT}"/>`;
}

const GRADIENT = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${GREEN_MID}"/><stop offset="1" stop-color="${GREEN_DEEP}"/>
  </linearGradient>`;

/** Full-bleed square. The launcher and the Play Store apply their own rounding. */
function iconSvg(size, fraction = 0.58, rounded = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>${GRADIENT}</defs>
  <rect width="${size}" height="${size}" rx="${rounded}" fill="url(#bg)"/>
  <g transform="${place(size, fraction)}">${mark()}</g></svg>`;
}

/** Transparent: Android composites this over the background colour itself. */
function foregroundSvg(size, fraction = 0.52, { mono = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="${place(size, fraction)}">${mark({ mono })}</g></svg>`;
}

/**
 * The Play Store feature graphic: 1024x500, no transparency allowed.
 *
 * Text is placed by `build-feature.js`, which measures the real rendered width
 * in the browser and shrinks the title until it fits. Guessing at font metrics
 * is how a graphic ends up with its last word clipped at the edge of the
 * canvas — and Play shows this image at the top of the listing, uncropped, on
 * every phone.
 *
 * The third line is the one that has been wrong before. It used to read "No
 * account needed", which was true when it was written and stopped being true
 * the day signing in became mandatory. A store graphic that contradicts the
 * first screen of the app is worse than a plain one.
 */
function featureGraphic({
  title = 'Daily Expense Tracker',
  tagline = 'Scan a bill. Know where it went.',
  footnote = 'Works offline \u00b7 Backs up to your own Google Drive',
  titleSize = 58,
} = {}) {
  const W = 1024, H = 500;
  const s = 300 / MARK.h;
  const textX = 400;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${GREEN_MID}"/><stop offset="1" stop-color="${GREEN_DEEP}"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#fg)"/>
  <g transform="translate(${110 - MARK_CX * s} ${H / 2 - MARK_CY * s}) scale(${s})">${mark()}</g>
  <text id="t" x="${textX}" y="226" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="${titleSize}" font-weight="700" fill="${CREAM}">${title}</text>
  <text id="g" x="${textX + 2}" y="286" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="29" fill="#9FD6C4">${tagline}</text>
  <text id="f" x="${textX + 2}" y="334" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        font-size="24" fill="#7FBBA8">${footnote}</text>
</svg>`;
}

module.exports = { iconSvg, foregroundSvg, featureGraphic, GREEN_DEEP, GREEN, CREAM };
