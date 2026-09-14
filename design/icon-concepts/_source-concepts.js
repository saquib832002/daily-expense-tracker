// Three directions, one function each. Everything is a 512-unit square so the
// same source scales to 1024 for Expo and 512 for Play with no redrawing.
const GREEN_DEEP = '#0E3E35';
const GREEN = '#14574B';
const GREEN_MID = '#1B6B58';
const MINT = '#9FD6C4';
const MINT_SOFT = '#DCEAE5';
const CREAM = '#FBF8F1';
const ACCENT = '#57BFA8';

const defs = `
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${GREEN_MID}"/><stop offset="1" stop-color="${GREEN_DEEP}"/>
  </linearGradient>`;

/** Receipt with a torn bottom edge and a rising bar chart inside it. */
function receipt(bg = true) {
  // Zigzag across the receipt's foot: 7 teeth, 30 units wide, 16 deep.
  const x0 = 156, x1 = 356, footTop = 352, tooth = 16;
  let zig = `L${x1},${footTop} `;
  const n = 5, w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const xa = x1 - i * w - w / 2, xb = x1 - (i + 1) * w;
    zig += `L${xa},${footTop + tooth} L${xb},${footTop} `;
  }
  return `
  ${bg ? `<rect width="512" height="512" rx="114" fill="url(#bg)"/>` : ''}
  <path d="M156,176 a24,24 0 0 1 24,-24 h152 a24,24 0 0 1 24,24 ${zig} Z" fill="${CREAM}"/>
  <rect x="186" y="196" width="106" height="16" rx="8" fill="#C8CFC9"/>
  <rect x="186" y="226" width="70"  height="16" rx="8" fill="#D8DEDA"/>
  <rect x="186" y="286" width="34" height="46" rx="9" fill="${MINT}"/>
  <rect x="239" y="264" width="34" height="68" rx="9" fill="${GREEN}"/>
  <rect x="292" y="238" width="34" height="94" rx="9" fill="${ACCENT}"/>`;
}

/** A rising line, drawn as one confident stroke. */
function pulse(bg = true) {
  return `
  ${bg ? `<rect width="512" height="512" rx="114" fill="url(#bg)"/>` : ''}
  <path d="M132,332 L212,252 L268,296 L372,180"
        fill="none" stroke="${CREAM}" stroke-width="38"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M300,168 h84 v84" fill="none" stroke="${ACCENT}" stroke-width="34"
        stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** A stack of ledger cards, the front one carrying a tick. */
function ledger(bg = true) {
  return `
  ${bg ? `<rect width="512" height="512" rx="114" fill="url(#bg)"/>` : ''}
  <g transform="rotate(-10 256 268)">
    <rect x="146" y="150" width="220" height="200" rx="30" fill="${MINT}" opacity="0.85"/>
  </g>
  <rect x="146" y="176" width="220" height="200" rx="30" fill="${CREAM}"/>
  <rect x="178" y="212" width="120" height="16" rx="8" fill="#C8CFC9"/>
  <rect x="178" y="244" width="80"  height="16" rx="8" fill="#D8DEDA"/>
  <path d="M182,312 L214,342 L286,268" fill="none" stroke="${GREEN}" stroke-width="30"
        stroke-linecap="round" stroke-linejoin="round"/>`;
}

const CONCEPTS = { receipt, pulse, ledger };

function svg(name, { bg = true, size = 512 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs>${defs}</defs>${CONCEPTS[name](bg)}</svg>`;
}

module.exports = { svg, CONCEPTS, GREEN, GREEN_DEEP, MINT_SOFT, CREAM };
