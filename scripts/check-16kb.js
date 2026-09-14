/**
 * Does this build satisfy Google Play's 16 KB page size requirement?
 *
 * Since 1 November 2025, an app targeting Android 15 or newer must have every
 * 64-bit native library aligned to 16 KB, or Play refuses the upload with
 * "Recompile your app with 16 KB native library alignment". This app targets
 * Android 16, so the rule applies — and the answer is not a matter of opinion,
 * it is four bytes in each .so file's program headers.
 *
 * So this reads them. For every library under the Android build output it
 * parses the ELF program header table and reports the alignment of the
 * loadable segments. 16384 or more passes; 4096 fails.
 *
 * Usage, after a build:
 *
 *   node scripts/check-16kb.js
 *   node scripts/check-16kb.js path\to\some\folder
 *
 * Only arm64-v8a and x86_64 matter. The 32-bit ABIs are exempt, and are
 * reported separately so a red line there does not cause a panic.
 */
const fs = require('fs');
const path = require('path');

const PT_LOAD = 1;
const NEEDED = 16384;

/** Alignments of the PT_LOAD segments in a 64-bit ELF, or null if not one. */
function loadAlignments(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(64);
    if (fs.readSync(fd, head, 0, 64, 0) < 64) return null;
    if (head.toString('latin1', 0, 4) !== '\x7fELF') return null;

    const is64 = head[4] === 2;
    if (!is64) return { bits: 32, aligns: [] };

    const phoff = Number(head.readBigUInt64LE(32));
    const phentsize = head.readUInt16LE(54);
    const phnum = head.readUInt16LE(56);

    const table = Buffer.alloc(phentsize * phnum);
    fs.readSync(fd, table, 0, table.length, phoff);

    const aligns = [];
    for (let i = 0; i < phnum; i += 1) {
      const entry = table.subarray(i * phentsize, (i + 1) * phentsize);
      if (entry.readUInt32LE(0) !== PT_LOAD) continue;
      // p_align is the last 8 bytes of a 56-byte 64-bit program header.
      aligns.push(Number(entry.readBigUInt64LE(48)));
    }
    return { bits: 64, aligns };
  } finally {
    fs.closeSync(fd);
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Symlinks are skipped rather than followed: a broken one in a build tree
    // should not stop the check, and a working one only duplicates a file that
    // is already in the list.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.so')) out.push(full);
  }
  return out;
}

const roots = process.argv.slice(2);
const defaults = [
  path.join('android', 'app', 'build', 'intermediates', 'merged_native_libs'),
  path.join('android', 'app', 'build', 'outputs'),
];
const searchIn = (roots.length > 0 ? roots : defaults).filter((p) => fs.existsSync(p));

if (searchIn.length === 0) {
  console.error('Nothing to check. Build first:  cd android && gradlew bundleRelease');
  process.exit(2);
}

const files = searchIn.flatMap((r) => walk(r));
if (files.length === 0) {
  console.error('No .so files found under: ' + searchIn.join(', '));
  process.exit(2);
}

let bad = 0;
let checked = 0;
const skipped = [];

for (const file of files.sort()) {
  const abi = file.includes('arm64-v8a') ? 'arm64-v8a'
    : file.includes('x86_64') ? 'x86_64'
    : file.includes('armeabi-v7a') ? 'armeabi-v7a'
    : file.includes('x86') ? 'x86'
    : '?';

  // 32-bit ABIs are not covered by the requirement.
  if (abi === 'armeabi-v7a' || abi === 'x86') {
    skipped.push(file);
    continue;
  }

  const info = loadAlignments(file);
  if (!info || info.bits !== 64) {
    skipped.push(file);
    continue;
  }

  checked += 1;
  const worst = info.aligns.length > 0 ? Math.min(...info.aligns) : 0;
  const ok = worst >= NEEDED;
  if (!ok) bad += 1;

  console.log(
    `${ok ? 'OK  ' : 'FAIL'}  ${String(worst).padStart(6)}  ${abi.padEnd(10)}  ${path.basename(file)}`,
  );
}

console.log('');
console.log(`${checked} 64-bit libraries checked, ${bad} not 16 KB aligned.`);
console.log(`${skipped.length} skipped (32-bit ABIs, which the rule does not cover).`);

if (bad > 0) {
  console.log('');
  console.log('Google Play will refuse this build with:');
  console.log('  "Recompile your app with 16 KB native library alignment."');
  console.log('The fix is an Expo SDK upgrade — the alignment comes from the');
  console.log('toolchain that built these libraries, not from anything in app code.');
}

process.exit(bad > 0 ? 1 : 0);
