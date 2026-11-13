/**
 * Reads the first sheet of an Excel (.xlsx) or CSV file into rows of text.
 * Every cell becomes a trimmed string so later steps never deal with
 * Excel's mix of numbers, dates and blanks.
 */
export type Table = string[][];

export class SpreadsheetError extends Error {}

/** Excel stores long numeric codes as numbers; print them without exponents or ".0". */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return Number.isSafeInteger(value) ? String(value) : BigInt(Math.round(value)).toString();
    }
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).trim();
}

/** Numbers beyond 15 digits lose precision in Excel. Such barcodes must be stored as text. */
export function isUnsafeNumericCell(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value);
}

/** RFC 4180 CSV parsing: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): Table {
  const src = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(src);
  const rows: Table = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delimiter) {
      row.push(field.trim());
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

export interface ReadResult {
  rows: Table;
  /** Row numbers (1-based) where a long number was stored as a number and may be wrong. */
  unsafeNumberRows: number[];
}

export async function readSpreadsheet(file: Blob, fileName: string): Promise<ReadResult> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return { rows: parseCsv(await file.text()), unsafeNumberRows: [] };
  }
  if (lower.endsWith('.xls')) {
    throw new SpreadsheetError('Old .xls files are not supported. In Excel, use File > Save As > Excel Workbook (.xlsx).');
  }
  if (!lower.endsWith('.xlsx')) throw new SpreadsheetError('Please choose an Excel (.xlsx) or CSV file.');
  const { readSheet } = await import('read-excel-file/universal');
  let raw: unknown[][];
  try {
    raw = (await readSheet(file)) as unknown[][];
  } catch (err) {
    throw new SpreadsheetError(`Could not read the Excel file: ${err instanceof Error ? err.message : String(err)}`);
  }
  const unsafeNumberRows: number[] = [];
  const rows = raw
    .map((r, i) => {
      if (r.some(isUnsafeNumericCell)) unsafeNumberRows.push(i + 1);
      return r.map(cellToText);
    })
    .filter((r) => r.some((c) => c !== ''));
  return { rows, unsafeNumberRows };
}

/** Lower-case, collapse spaces and drop punctuation so "Item Code:" matches "item code". */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Find the header row (it may sit below title rows, as in Tally exports) and
 * map each wanted field to a column index.
 */
export function findColumns<K extends string>(
  rows: Table,
  synonyms: Record<K, string[]>,
  required: NoInfer<K>[],
  searchRows = 10,
): { headerRow: number; columns: Partial<Record<K, number>> } | null {
  for (let r = 0; r < Math.min(searchRows, rows.length); r++) {
    const headers = rows[r].map(normalizeHeader);
    const columns: Partial<Record<K, number>> = {};
    for (const key of Object.keys(synonyms) as K[]) {
      const idx = headers.findIndex((h) => synonyms[key].includes(h));
      if (idx >= 0) columns[key] = idx;
    }
    if (required.every((k) => columns[k] !== undefined)) return { headerRow: r, columns };
  }
  return null;
}
