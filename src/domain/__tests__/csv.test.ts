import { describe, expect, it } from '@jest/globals';
import { UTF8_BOM, encodeCsv, encodeField, encodeRow, parseCsv, parseCsvObjects } from '../csv';

describe('encodeField', () => {
  it('leaves ordinary values alone', () => {
    expect(encodeField('Swiggy')).toBe('Swiggy');
    expect(encodeField(1250)).toBe('1250');
  });

  it('quotes a value containing a comma', () => {
    expect(encodeField('Ram, Shyam & Co')).toBe('"Ram, Shyam & Co"');
  });

  it('doubles embedded quotes', () => {
    expect(encodeField('He said "hi"')).toBe('"He said ""hi"""');
  });

  it('quotes values containing newlines', () => {
    expect(encodeField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('quotes values whose spacing would otherwise be eaten', () => {
    expect(encodeField('  padded  ')).toBe('"  padded  "');
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(encodeField(null)).toBe('');
    expect(encodeField(undefined)).toBe('');
    expect(encodeField('')).toBe('');
  });
});

describe('encodeRow / encodeCsv', () => {
  it('joins fields with commas and rows with CRLF', () => {
    expect(encodeRow(['a', 'b', 'c'])).toBe('a,b,c');
    const csv = encodeCsv([['a', 'b'], ['c', 'd']], { bom: false });
    expect(csv).toBe('a,b\r\nc,d');
  });

  it('writes a BOM by default so Excel reads Hindi correctly', () => {
    const csv = encodeCsv([['श्रेणी']]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
  });
});

describe('parseCsv', () => {
  it('parses a simple document', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('accepts LF and lone CR line endings too', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles quoted commas, quotes and newlines', () => {
    const doc = 'merchant,note\r\n"Ram, Shyam","He said ""hi"""\r\n"multi\nline",ok';
    expect(parseCsv(doc)).toEqual([
      ['merchant', 'note'],
      ['Ram, Shyam', 'He said "hi"'],
      ['multi\nline', 'ok'],
    ]);
  });

  it('strips a leading BOM', () => {
    expect(parseCsv(UTF8_BOM + 'a,b')).toEqual([['a', 'b']]);
  });

  it('keeps empty fields rather than dropping them', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
    expect(parseCsv(',,')).toEqual([['', '', '']]);
  });

  it('does not invent a row from a trailing newline', () => {
    expect(parseCsv('a,b\r\n')).toEqual([['a', 'b']]);
  });

  it('survives an unterminated quote instead of throwing', () => {
    // Refusing to import someone's data is worse than importing it imperfectly.
    expect(() => parseCsv('a,"unterminated')).not.toThrow();
    expect(parseCsv('a,"unterminated')).toEqual([['a', 'unterminated']]);
  });

  it('is empty for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('round-trips anything encodeCsv produces', () => {
    const rows = [
      ['merchant', 'amount', 'note'],
      ['Ram, Shyam & Co', '1250', 'He said "hi"'],
      ['multi\nline', '-40', ''],
      ['  padded  ', '0', 'ठीक है'],
    ];
    expect(parseCsv(encodeCsv(rows))).toEqual(rows);
  });
});

describe('parseCsvObjects', () => {
  it('keys rows by a normalized header', () => {
    const out = parseCsvObjects('Date, Amount ,MERCHANT\r\n2026-08-01,120,Swiggy');
    expect(out).toEqual([{ date: '2026-08-01', amount: '120', merchant: 'Swiggy' }]);
  });

  it('is empty when there is only a header', () => {
    expect(parseCsvObjects('a,b')).toEqual([]);
    expect(parseCsvObjects('')).toEqual([]);
  });

  it('fills missing trailing cells with empty strings', () => {
    const out = parseCsvObjects('a,b,c\r\n1,2');
    expect(out[0]).toEqual({ a: '1', b: '2', c: '' });
  });
});
