/**
 * The translation files, checked against each other and against the code.
 *
 * These tests exist because every failure mode here is invisible in
 * development: `t()` falls back to English and then to the key itself, so a
 * string missing from Urdu looks like a working app in English, and a
 * mistyped key renders as `more.setupAgian` on somebody's phone rather than
 * throwing anywhere a developer would see it.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import ar from '../ar.json';
import en from '../en.json';
import hi from '../hi.json';
import ur from '../ur.json';

const LOCALES: Record<string, Record<string, string>> = { hi, ur, ar };
const ROOT = join(__dirname, '..', '..', '..');

/** Every .ts/.tsx file under app/ and src/, read as text. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const SOURCES = [...sourceFiles(join(ROOT, 'app')), ...sourceFiles(join(ROOT, 'src'))];

/** `{{name}}` placeholders in a template. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort();
}

describe('translation files', () => {
  it.each(Object.keys(LOCALES))('%s has every English key', (code) => {
    const missing = Object.keys(en).filter((key) => !(key in LOCALES[code]!));
    expect(missing).toEqual([]);
  });

  it.each(Object.keys(LOCALES))('%s has no keys English does not', (code) => {
    const extra = Object.keys(LOCALES[code]!).filter((key) => !(key in en));
    expect(extra).toEqual([]);
  });

  /**
   * A placeholder dropped in translation is worse than a missing string: the
   * sentence still reads, and the number it was supposed to carry is simply
   * gone. "Choosing converts every one of them" is a perfectly grammatical
   * way to lose the currency code.
   */
  it.each(Object.keys(LOCALES))('%s keeps every placeholder', (code) => {
    const wrong: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      const mine = LOCALES[code]![key];
      if (mine == null) continue;
      if (placeholders(value).join() !== placeholders(mine).join()) wrong.push(key);
    }
    expect(wrong).toEqual([]);
  });
});

describe('keys used in the app', () => {
  it('all exist in English', () => {
    const missing = new Set<string>();
    for (const file of SOURCES) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\bt\(\s*'([a-z][\w.]*)'/gi)) {
        const key = match[1]!;
        // Category names are keys too, but they are built from the database
        // rather than written out here; the seed owns that list.
        if (!(key in en)) missing.add(`${key} (${file.slice(ROOT.length + 1)})`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
