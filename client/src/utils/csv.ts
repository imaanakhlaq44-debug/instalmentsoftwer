export interface CsvColumn<T> {
  header: string;
  /** Pull the cell value out of a row. Return null/undefined for a blank cell. */
  value: (row: T) => string | number | null | undefined;
}

/**
 * Escapes one CSV field.
 *
 * Two things matter for a file a shopkeeper will open in Excel:
 *  - quotes, commas and newlines must be quoted and doubled;
 *  - a value starting with =, +, - or @ is treated by Excel as a formula.
 *    A customer named "=cmd..." would execute on open, so those get prefixed
 *    with a tab (CSV injection defence).
 */
function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  let str = String(value);

  if (/^[=+\-@\t\r]/.test(str)) {
    str = `\t${str}`;
  }

  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(','));
  return [header, ...body].join('\r\n');
}

/**
 * Triggers a browser download.
 *
 * The UTF-8 BOM is required: without it Excel on Windows reads the file as
 * ANSI and mangles every non-ASCII character — which in this app means every
 * Urdu name and the Rs. sign.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoke on the next tick so the download has definitely started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `devices-2026-08-17.csv` */
export function timestampedFilename(prefix: string): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  return `${prefix}-${date}.csv`;
}

export function exportCsv<T>(prefix: string, rows: T[], columns: CsvColumn<T>[]): void {
  downloadCsv(timestampedFilename(prefix), toCsv(rows, columns));
}

// ---------------------------------------------------------------------------
// Formatting helpers so exported columns stay consistent across pages
// ---------------------------------------------------------------------------

/** Plain number, no "Rs." or thousands separators — spreadsheets need to sum it. */
export const csvMoney = (n: number | null | undefined): number => Math.round(Number(n) || 0);

export const csvDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().split('T')[0];
};

export const csvDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toISOString().split('T')[0]} ${d.toTimeString().slice(0, 5)}`;
};

export const csvBool = (v: boolean | null | undefined): string => (v ? 'Yes' : 'No');
