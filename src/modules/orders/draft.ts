import type { ParsedInvoice } from '../../domain/invoiceParser';
import { matchProduct, type MatchCandidate } from '../../domain/productMatch';
import { isValidGstin } from '../../domain/gstin';

export type MatchKind = 'alias' | 'exact' | 'suggested' | 'ambiguous' | 'none' | 'manual';

export interface DraftLine {
  key: string;
  /** Wording from the invoice, if any. */
  text: string | null;
  productId: string | null;
  match: MatchKind;
  qty: string;
  unit: string;
  issues: string[];
  /** Staff ticked "checked against paper". */
  checked: boolean;
  /** Close candidates to offer first when choosing. */
  options?: string[];
}

export interface OrderDraft {
  mode: 'invoice' | 'manual' | 'edit';
  orderId?: string;
  customerName: string;
  gstin: string;
  address: string;
  invoiceNo: string;
  invoiceDate: string;
  lines: DraftLine[];
  globalIssues: string[];
  issuesAcknowledged: boolean;
  file?: { blob: Blob; name: string; source: 'camera' | 'upload' };
  ocrText?: string;
}

let current: OrderDraft | null = null;
export const draftStore = {
  set(d: OrderDraft) {
    current = d;
  },
  get(): OrderDraft | null {
    return current;
  },
  clear() {
    current = null;
  },
};

let keySeq = 0;
export const newLineKey = () => `l${++keySeq}`;

export function emptyLine(): DraftLine {
  return { key: newLineKey(), text: null, productId: null, match: 'manual', qty: '', unit: 'box', issues: [], checked: true };
}

export function draftFromInvoice(
  inv: ParsedInvoice,
  products: MatchCandidate[],
  aliases: Map<string, string>,
  file: OrderDraft['file'],
  ocrText: string,
): OrderDraft {
  return {
    mode: 'invoice',
    customerName: inv.buyerName ?? '',
    gstin: inv.buyerGstin ?? '',
    address: inv.buyerAddress ?? '',
    invoiceNo: inv.invoiceNo ?? '',
    invoiceDate: inv.invoiceDate ?? '',
    lines: inv.lines.map((l) => {
      const m = matchProduct(l.description, products, aliases);
      return {
        key: newLineKey(),
        text: l.description,
        productId: m.productId,
        match: m.kind,
        qty: String(l.qty),
        unit: l.unit,
        issues: l.issues,
        checked: false,
        options: m.alternatives.map((a) => a.id),
      };
    }),
    globalIssues: inv.issues,
    issuesAcknowledged: inv.issues.length === 0,
    file,
    ocrText,
  };
}

/** A line needs a human tick when anything about it is uncertain. */
export function lineNeedsCheck(l: DraftLine): boolean {
  return l.issues.length > 0 || l.match === 'suggested' || l.match === 'ambiguous' || l.match === 'none';
}

/** Everything that still blocks creating the order, in plain words. */
export function draftBlockers(d: OrderDraft): string[] {
  const out: string[] = [];
  if (d.mode !== 'edit') {
    if (!d.customerName.trim()) out.push('Enter the customer name');
    if (d.gstin.trim() && !isValidGstin(d.gstin)) out.push('Correct the GSTIN (or clear it)');
    if (d.mode === 'invoice' && !d.invoiceNo.trim()) out.push('Enter the invoice number');
  }
  if (!d.lines.length) out.push('Add at least one product');
  d.lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.productId) out.push(`Line ${n}: choose the product`);
    const q = Number(l.qty);
    if (!Number.isInteger(q) || q <= 0) out.push(`Line ${n}: enter a whole-number quantity`);
    else if (lineNeedsCheck(l) && !l.checked) out.push(`Line ${n}: tick "Right product and quantity" after comparing with the invoice`);
  });
  if (d.globalIssues.length && !d.issuesAcknowledged) out.push('Tick that you have checked the warnings at the top');
  return out;
}
