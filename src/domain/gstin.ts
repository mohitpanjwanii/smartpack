/**
 * Indian GSTIN validation. A GSTIN is 15 characters: 2-digit state code,
 * 10-character PAN, entity number, 'Z', and a check character computed from
 * the first 14. The check character catches almost every misread character,
 * which makes it a reliable test of an OCR result.
 */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(raw: string): boolean {
  const g = raw.trim().toUpperCase();
  return PATTERN.test(g) && gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** Find GSTIN-shaped tokens in OCR text (valid or not). */
export function findGstinCandidates(text: string): string[] {
  return [...text.toUpperCase().matchAll(/\b[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]\b/g)].map((m) => m[0]);
}

export const STATE_CODES: Record<string, string> = {
  '27': 'Maharashtra', '29': 'Karnataka', '32': 'Kerala', '33': 'Tamil Nadu', '36': 'Telangana', '37': 'Andhra Pradesh',
};
