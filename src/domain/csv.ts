/**
 * CSV, done properly.
 *
 * A tracker's export is the user's escape hatch — the thing that means their
 * data is theirs and not hostage to this app. So it has to survive the awkward
 * cases: a merchant called `Ram, Shyam & Co`, a note containing a quotation
 * mark, a note with a line break in it, and Hindi text opened in Excel.
 *
 * Follows RFC 4180. Pure functions: no React, no database, no file system.
 */

/** Excel assumes the system codepage unless a UTF-8 BOM says otherwise. */
export const UTF8_BOM = '﻿';

const NEEDS_QUOTING = /[",\r\n]/;

/** Quote a single field only when it has to be quoted. */
export function encodeField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s === '') return '';
  // Leading or trailing spaces get eaten by some readers unless quoted.
  if (NEEDS_QUOTING.test(s) || s !== s.trim()) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function encodeRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(encodeField).join(',');
}

/**
 * Rows → a CSV document.
 * CRLF line endings, because that is what RFC 4180 says and what Excel expects.
 */
export function encodeCsv(
  rows: (string | number | null | undefined)[][],
  options: { bom?: boolean } = {},
): string {
  const body = rows.map(encodeRow).join('\r\n');
  return (options.bom === false ? '' : UTF8_BOM) + body;
}

/**
 * A CSV document → rows.
 *
 * Handles quoted fields containing commas, quotes and newlines, and accepts
 * CRLF, LF or CR line endings because exports arrive from everywhere.
 * Never throws: malformed input yields the best interpretation available,
 * since refusing to import someone's data is worse than importing it slightly
 * wrong and letting them see the result.
 */
export function parseCsv(input: string): string[][] {
  if (!input) return [];

  let text = input;
  if (text.startsWith(UTF8_BOM)) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      endField();
      i++;
      continue;
    }
    if (ch === '\r') {
      // Treat CRLF and a lone CR alike.
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // A trailing newline should not produce a phantom empty row.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Parse into objects keyed by the header row.
 * Header names are trimmed and lower-cased so `Amount`, `amount` and ` AMOUNT `
 * all work — an import from another app should not fail on capitalisation.
 */
export function parseCsvObjects(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  const header = rows[0];
  if (!header || rows.length < 2) return [];

  const keys = header.map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    keys.forEach((key, idx) => {
      if (key) obj[key] = cells[idx] ?? '';
    });
    return obj;
  });
}
