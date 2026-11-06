/**
 * Minimal CSV writer (RFC 4180) for Excel — design §2, R9.
 * No library needed: the only rules are quoting, escaping quotes and CRLF line endings.
 */

/**
 * UTF-8 Byte Order Mark. Without it Excel assumes the file is in the PC's legacy code page
 * and shows "₹" or Tamil/Hindi text as garbage (R9 AC3).
 */
export const UTF8_BOM = '﻿';

/**
 * Escapes one field:
 * - Wrap in quotes when it contains a comma, quote or line break; double any inner quotes.
 * - Prefix `'` when it starts with = + - @ (or tab/CR) so Excel doesn't run it as a formula
 *   ("CSV injection" — e.g. a note "=HYPERLINK(...)"). Numbers are passed as numbers, so
 *   amounts are never affected.
 */
export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);

  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Builds the whole CSV text: BOM + header row + data rows, CRLF line endings (Excel's default). */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}
