/**
 * Reads the text of a Tally "Tax Invoice" (as produced by on-phone OCR) and
 * pulls out the invoice number, date, buyer, GSTIN and item lines.
 *
 * It never guesses silently. Every line is cross-checked:
 * - quantity × actual rate must match the line amount;
 * - the serial numbers must run 1, 2, 3… with no gaps;
 * - quantities per unit must add up to the "Total Unit" line;
 * - the buyer GSTIN must pass its check character.
 * Anything that fails is reported as an issue for the review screen.
 */
import { findGstinCandidates, isValidGstin } from './gstin';

export interface InvoiceLine {
  slNo: number;
  description: string;
  hsn: string | null;
  qty: number;
  unit: string;
  rate: number | null;
  actualRate: number | null;
  amount: number | null;
  raw: string;
  issues: string[];
}

export interface ParsedInvoice {
  invoiceNo: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  buyerName: string | null;
  buyerAddress: string | null;
  buyerGstin: string | null;
  buyerGstinValid: boolean;
  lines: InvoiceLine[];
  totalUnits: Record<string, number> | null;
  issues: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const UNIT_WORDS = 'box|boxes|pack|packs|pkt|pkts|pcs|pc|nos|no|kg|kgs|tray|trays|case|cases|jar|jars|bag|bags|ctn|ctns';

export function canonicalUnit(u: string): string {
  const s = u.toLowerCase().replace(/\.$/, '');
  if (/^box(es)?$/.test(s)) return 'box';
  if (/^(packs?|pkts?)$/.test(s)) return 'pack';
  if (/^(pcs|pc|nos|no)$/.test(s)) return 'pcs';
  if (/^kgs?$/.test(s)) return 'kg';
  return s.replace(/s$/, '');
}

const num = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** OCR draws table borders as | [ ] { } and similar; turn them into spaces. */
function clean(line: string): string {
  return line.replace(/[|[\]{}¦]/g, ' ').replace(/\s+/g, ' ').trim();
}

const ITEM_RE = new RegExp(
  '^(\\d{1,3})\\s*[).:;,_~-]?\\s*' + // Sl no
    '(.+?)\\s+' + // description
    '(\\d{8}|\\d{6}|\\d{4})?\\s*' + // HSN (optional)
    '(\\d{1,6})\\s*(' + UNIT_WORDS + ')\\.?\\s+' + // quantity + unit
    '([\\d,]+\\.\\d{1,3})\\s*' + // rate
    '(?:(?:' + UNIT_WORDS + ')\\.?\\s*)?' + // per
    '([\\d,]+\\.\\d{1,2})?\\s*' + // actual rate (optional)
    '([\\d,]+\\.\\d{2,3})$', // amount
  'i',
);

export function parseItemLine(rawLine: string): InvoiceLine | null {
  const line = clean(rawLine);
  const m = line.match(ITEM_RE);
  if (!m) return null;
  const description = m[2].replace(/[~_=]+/g, ' ').replace(/\s+/g, ' ').trim();
  const out: InvoiceLine = {
    slNo: Number(m[1]),
    description,
    hsn: m[3] ?? null,
    qty: Number(m[4]),
    unit: canonicalUnit(m[5]),
    rate: num(m[6]),
    actualRate: num(m[7]),
    amount: num(m[8]),
    raw: rawLine.trim(),
    issues: [],
  };
  // Cross-check the quantity against the money columns.
  if (out.amount !== null) {
    const unitPrice = out.actualRate ?? out.rate;
    if (unitPrice) {
      const expected = out.qty * unitPrice;
      const tolerance = out.qty * 0.006 + 0.05;
      if (Math.abs(expected - out.amount) > tolerance) {
        const implied = out.amount / unitPrice;
        out.issues.push(
          `Quantity check failed: ${out.qty} × ${unitPrice} = ${expected.toFixed(2)}, but amount is ${out.amount.toFixed(2)}` +
            (Math.abs(implied - Math.round(implied)) < 0.02 ? ` (looks like ${Math.round(implied)})` : ''),
        );
      }
    }
  }
  if (!out.description || out.description.length < 3) out.issues.push('Product name could not be read');
  return out;
}

function parseDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/](\d{2,4})\b/);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2].toLowerCase());
  if (mon < 0) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return `${year}-${String(mon + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function leftColumn(line: string): string {
  // OCR keeps big gaps between columns; the buyer block is the left column.
  return line.split(/\s{3,}/)[0].trim();
}

export function parseTotalUnits(text: string): Record<string, number> | null {
  const m = text.match(/Total\s*Unit[s]?\s*[:;]?\s*(.+)/i);
  if (!m) return null;
  const totals: Record<string, number> = {};
  for (const part of m[1].matchAll(new RegExp('(\\d+)\\s*(' + UNIT_WORDS + ')\\b', 'gi'))) {
    const u = canonicalUnit(part[2]);
    totals[u] = (totals[u] ?? 0) + Number(part[1]);
  }
  return Object.keys(totals).length ? totals : null;
}

/**
 * Parse one or more OCR readings of the same invoice. Several readings (e.g.
 * two layout modes) are merged line by line: for each serial number the
 * reading that passes its cross-check wins. This recovers lines that one
 * reading missed.
 */
export function parseTallyInvoice(input: string | string[], ownGstin = '36AGIPP2654D1ZF'): ParsedInvoice {
  const texts = (Array.isArray(input) ? input : [input]).filter((t) => t.trim());
  const heads = texts.map((t) => parseHeader(t, ownGstin));
  const pick = <K extends keyof Header>(k: K): Header[K] => (heads.find((h) => h[k]) ?? heads[0] ?? emptyHeader())[k];
  const validGstin = heads.find((h) => h.buyerGstinValid);
  const header: Header = {
    invoiceNo: pick('invoiceNo'),
    invoiceDate: pick('invoiceDate'),
    buyerName: pick('buyerName'),
    buyerAddress: pick('buyerAddress'),
    buyerGstin: validGstin ? validGstin.buyerGstin : pick('buyerGstin'),
    buyerGstinValid: !!validGstin,
    totalUnits: pick('totalUnits'),
  };
  const best = new Map<number, InvoiceLine>();
  for (const t of texts) {
    for (const l of t.split(/\r?\n/)) {
      const it = parseItemLine(l);
      if (!it) continue;
      const prev = best.get(it.slNo);
      if (!prev || it.issues.length < prev.issues.length) best.set(it.slNo, it);
    }
  }
  const items = [...best.values()].sort((a, b) => a.slNo - b.slNo);
  return validate(header, items);
}

interface Header {
  invoiceNo: string | null;
  invoiceDate: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  buyerGstin: string | null;
  buyerGstinValid: boolean;
  totalUnits: Record<string, number> | null;
}

function emptyHeader(): Header {
  return { invoiceNo: null, invoiceDate: null, buyerName: null, buyerAddress: null, buyerGstin: null, buyerGstinValid: false, totalUnits: null };
}

function parseHeader(text: string, ownGstin: string): Header {
  const lines = text.split(/\r?\n/);

  // Invoice number: a token like SMP/26-27/1546 near "Invoice No."
  let invoiceNo: string | null = null;
  const invMatch = text.match(/\b([A-Z]{1,6}\s?\/\s?\d{2}-\d{2}\s?\/\s?\d{1,6})\b/);
  if (invMatch) invoiceNo = invMatch[1].replace(/\s+/g, '');
  else {
    const idx = lines.findIndex((l) => /Invoice\s*No/i.test(l));
    if (idx >= 0) {
      const tok = lines.slice(idx + 1, idx + 3).map((l) => l.split(/\s{3,}/).find((s) => /\d/.test(s) && /[\/-]/.test(s))).find(Boolean);
      if (tok) invoiceNo = tok.trim();
    }
  }

  // Date: first d-Mon-yy after the invoice number line.
  const invLine = invoiceNo ? lines.findIndex((l) => l.replace(/\s+/g, '').includes(invoiceNo!)) : -1;
  const invoiceDate = parseDate(invLine >= 0 ? lines[invLine] : '') ?? parseDate(text);

  // Buyer block: the lines after "Buyer (Bill to)" up to "GSTIN" / "State Name".
  let buyerName: string | null = null;
  const addr: string[] = [];
  const bIdx = lines.findIndex((l) => /^\W*Buyer\b/i.test(l.trim()));
  if (bIdx >= 0) {
    for (let i = bIdx + 1; i < Math.min(lines.length, bIdx + 9); i++) {
      const left = leftColumn(lines[i]).replace(/^[^A-Za-z0-9(]+/, '');
      if (/^(GSTIN|State Name|Sl\b|SI\b)/i.test(left)) break;
      if (!left || left.length < 3 || /^(Dispatch|Destination|Terms of)/i.test(left)) continue;
      if (!buyerName) buyerName = left.replace(/\s+/g, ' ');
      else addr.push(left);
    }
  }

  // Buyer GSTIN: any GSTIN that is not our own.
  const own = ownGstin.toUpperCase();
  const gstins = findGstinCandidates(text).filter((g) => g !== own);
  const buyerGstin = gstins.find(isValidGstin) ?? gstins[0] ?? null;
  const buyerGstinValid = buyerGstin ? isValidGstin(buyerGstin) : false;

  return {
    invoiceNo,
    invoiceDate,
    buyerName,
    buyerAddress: addr.length ? addr.join(', ') : null,
    buyerGstin,
    buyerGstinValid,
    totalUnits: parseTotalUnits(text),
  };
}

function validate(h: Header, items: InvoiceLine[]): ParsedInvoice {
  const issues: string[] = [];
  if (!h.invoiceNo) issues.push('Invoice number could not be read');
  if (!h.invoiceDate) issues.push('Invoice date could not be read');
  if (!h.buyerName) issues.push('Customer name could not be read');
  if (h.buyerGstin && !h.buyerGstinValid) issues.push(`Customer GSTIN "${h.buyerGstin}" fails its check digit; please correct it`);
  if (!items.length) issues.push('No item lines could be read. Retake the photo flat, in good light, with the whole table visible.');

  // Serial numbers must run 1..N.
  const seen = new Set(items.map((i) => i.slNo));
  const maxSl = Math.max(0, ...items.map((i) => i.slNo));
  const missing: number[] = [];
  for (let n = 1; n <= maxSl; n++) if (!seen.has(n)) missing.push(n);
  if (missing.length) issues.push(`Line${missing.length > 1 ? 's' : ''} ${missing.join(', ')} could not be read. Add ${missing.length > 1 ? 'them' : 'it'} by hand.`);

  // Units must add up to the invoice's own total.
  const totalUnits = h.totalUnits;
  if (totalUnits) {
    const sums: Record<string, number> = {};
    for (const it of items) sums[it.unit] = (sums[it.unit] ?? 0) + it.qty;
    for (const [u, n] of Object.entries(totalUnits)) {
      if ((sums[u] ?? 0) !== n) issues.push(`Invoice total says ${n} ${u}, but the lines read add up to ${sums[u] ?? 0} ${u}`);
    }
  } else if (items.length) {
    issues.push('The "Total Unit" line could not be read, so quantities could not be cross-checked. Check them against the paper.');
  }

  return {
    invoiceNo: h.invoiceNo,
    invoiceDate: h.invoiceDate,
    buyerName: h.buyerName,
    buyerAddress: h.buyerAddress,
    buyerGstin: h.buyerGstin,
    buyerGstinValid: h.buyerGstinValid,
    lines: items,
    totalUnits,
    issues,
  };
}
