import { describe, it, expect, vi } from 'vitest';

import {
  toCsv, downloadCsv, timestampedFilename, csvMoney, csvDate, csvDateTime, csvBool,
  type CsvColumn,
} from './csv.js';

interface Row {
  name: string;
  amount: number;
  note?: string | null;
}

const columns: CsvColumn<Row>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Amount', value: (r) => r.amount },
  { header: 'Note', value: (r) => r.note },
];

describe('toCsv', () => {
  it('writes a header row and one row per record', () => {
    const csv = toCsv([{ name: 'Ali', amount: 6750 }], columns);

    expect(csv.split('\r\n')).toEqual(['Name,Amount,Note', 'Ali,6750,']);
  });

  it('separates rows with CRLF, which is what Excel expects', () => {
    const csv = toCsv([{ name: 'A', amount: 1 }, { name: 'B', amount: 2 }], columns);
    expect(csv).toContain('\r\n');
  });

  it('leaves a blank cell for null and undefined', () => {
    const csv = toCsv([{ name: 'Ali', amount: 0, note: null }], columns);
    expect(csv).toContain('Ali,0,');
  });

  it('quotes a value containing a comma', () => {
    const csv = toCsv([{ name: 'House 4, Model Town', amount: 1 }], columns);
    expect(csv).toContain('"House 4, Model Town"');
  });

  it('doubles embedded quotes', () => {
    const csv = toCsv([{ name: 'Ali "Bhai"', amount: 1 }], columns);
    expect(csv).toContain('"Ali ""Bhai"""');
  });

  it('quotes a value containing a newline', () => {
    const csv = toCsv([{ name: 'Line one\nLine two', amount: 1 }], columns);
    expect(csv).toContain('"Line one\nLine two"');
  });

  it('keeps an Urdu name intact', () => {
    const csv = toCsv([{ name: 'محمد علی', amount: 1 }], columns);
    expect(csv).toContain('محمد علی');
  });
});

/**
 * A CSV cell beginning with =, +, - or @ is executed as a formula when Excel
 * opens the file. These exports are built from customer-supplied names and
 * notes, so this is a live injection route, not a theoretical one.
 */
describe('toCsv — spreadsheet formula injection', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])('neutralises a cell starting with %s', (payload) => {
    const csv = toCsv([{ name: payload, amount: 1 }], columns);
    const cell = csv.split('\r\n')[1].split(',')[0];

    expect(cell.startsWith('\t')).toBe(true);
  });

  it('neutralises the classic command payload', () => {
    const attack = '=cmd|\' /C calc\'!A0';
    const csv = toCsv([{ name: attack, amount: 1 }], columns);

    // Quoted because it contains a comma-free but quote-triggering payload, and
    // prefixed with a tab so Excel treats it as text.
    expect(csv).toContain('\t=cmd');
    expect(csv).not.toMatch(/(^|,)=cmd/);
  });

  it('leaves an ordinary negative number usable as a number', () => {
    // A tab prefix is the cost of safety here: the value survives, but as text.
    // Money columns go through csvMoney, which never produces a leading "-"
    // for the amounts these exports carry.
    const csv = toCsv([{ name: 'x', amount: -500 }], columns);
    expect(csv).toContain('\t-500');
  });
});

/**
 * Reads the blob's raw bytes.
 *
 * Deliberately not `readAsText`: a UTF-8 decoder consumes the BOM, so the very
 * thing under test would disappear before the assertion. Excel reads bytes, so
 * the test does too.
 */
function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

describe('downloadCsv', () => {
  it('prefixes a UTF-8 BOM so Excel on Windows does not mangle Urdu', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    // jsdom cannot navigate, and a real click on a download link tries to.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadCsv('test.csv', 'Name\r\nمحمد علی');

    const blob = created.mock.calls[0][0] as Blob;
    const bytes = await readBlobBytes(blob);

    // EF BB BF — without these three bytes Excel on Windows reads the file as
    // ANSI and every Urdu name comes out as mojibake.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    expect(new TextDecoder('utf-8').decode(bytes)).toContain('محمد علی');
    expect(blob.type).toContain('charset=utf-8');
  });

  it('triggers a download and cleans the link out of the document', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    downloadCsv('devices.csv', 'a,b');

    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});

describe('timestampedFilename', () => {
  it('appends the date and a .csv extension', () => {
    expect(timestampedFilename('devices')).toMatch(/^devices-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('formatting helpers', () => {
  it('exports money as a plain number a spreadsheet can sum', () => {
    expect(csvMoney(6750.4)).toBe(6750);
    expect(csvMoney(null)).toBe(0);
    expect(csvMoney(undefined)).toBe(0);
    expect(typeof csvMoney(100)).toBe('number');
  });

  it('reduces a timestamp to a date', () => {
    expect(csvDate('2026-08-17T06:00:00.000Z')).toBe('2026-08-17');
    expect(csvDate(null)).toBe('');
  });

  it('passes an unparseable date through rather than printing "Invalid Date"', () => {
    expect(csvDate('not a date')).toBe('not a date');
    expect(csvDateTime('not a date')).toBe('not a date');
  });

  it('formats a date and time', () => {
    expect(csvDateTime('2026-08-17T06:00:00.000Z')).toMatch(/^2026-08-17 \d{2}:\d{2}$/);
  });

  it('writes booleans as words', () => {
    expect(csvBool(true)).toBe('Yes');
    expect(csvBool(false)).toBe('No');
    expect(csvBool(undefined)).toBe('No');
  });
});
