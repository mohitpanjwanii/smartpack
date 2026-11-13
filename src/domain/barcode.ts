/**
 * Clean up a value read from a scanner, camera or spreadsheet before it is
 * stored or looked up. Scanners often append Enter/Tab or invisible control
 * characters; those are removed. Letters and digits are kept exactly, since
 * barcodes are case-sensitive.
 */
export function normalizeBarcode(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

export const MAX_BARCODE_LENGTH = 128;

export function barcodeProblem(code: string): string | null {
  if (!code) return 'Barcode is empty';
  if (code.length > MAX_BARCODE_LENGTH) return `Barcode is longer than ${MAX_BARCODE_LENGTH} characters`;
  if (/\s{2,}/.test(code)) return 'Barcode contains repeated spaces';
  return null;
}
