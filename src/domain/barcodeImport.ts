import type { Db } from '../db/types';
import { writeAudit } from '../db/repositories/audit';
import { getDeviceId } from '../db/repositories/settings';
import { barcodeProblem, normalizeBarcode } from './barcode';
import { newId, nowIso } from './ids';
import { findColumns, type Table } from './spreadsheet';

export const BARCODE_COLUMNS = {
  barcode: ['barcode', 'bar code', 'barcode no', 'barcode number', 'code', 'unique code', 'serial barcode', 'qr', 'qr code'],
  sku: ['sku', 'item code', 'product code', 'sku code', 'article code', 'stock code'],
  name: ['product', 'product name', 'item name', 'name', 'description'],
  serial: ['serial', 'serial no', 'serial number', 'sr no', 'sl no'],
};

export type BarcodeRowAction = 'new' | 'already' | 'error';

export interface PlannedBarcode {
  rowNo: number;
  action: BarcodeRowAction;
  barcode?: string;
  productId?: string;
  productLabel?: string;
  serial?: string;
  error?: string;
}

export interface BarcodePlan {
  rows: PlannedBarcode[];
  counts: Record<BarcodeRowAction, number>;
}

export class BarcodeImportError extends Error {}

interface ProductRef {
  id: string;
  sku: string;
  name: string;
  active: number;
}

/**
 * Preview a barcode list import. Each row needs a barcode and a product
 * (by SKU, or by exact product name). Nothing is saved here.
 * Barcodes already registered to the same product are skipped quietly;
 * registered to a different product, they are errors.
 */
export async function planBarcodeImport(db: Db, table: Table, unsafeNumberRows: number[] = []): Promise<BarcodePlan> {
  const found = findColumns(table, BARCODE_COLUMNS, ['barcode', 'sku']) ?? findColumns(table, BARCODE_COLUMNS, ['barcode', 'name']);
  if (!found) throw new BarcodeImportError('Could not find the columns. The file needs a "Barcode" column and an "Item code" (SKU) or "Product name" column.');
  const { headerRow, columns } = found;
  const products = await db.all<ProductRef>('SELECT id, sku, name, active FROM products');
  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));
  const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
  const existing = new Map(
    (await db.all<{ barcode: string; product_id: string }>('SELECT barcode, product_id FROM product_barcodes')).map((b) => [b.barcode, b.product_id]),
  );
  const unsafe = new Set(unsafeNumberRows);
  const seen = new Set<string>();
  const rows: PlannedBarcode[] = [];
  const get = (r: string[], k: keyof typeof BARCODE_COLUMNS) => (columns[k] === undefined ? '' : (r[columns[k]!] ?? '').trim());

  for (let i = headerRow + 1; i < table.length; i++) {
    const r = table[i];
    const rowNo = i + 1;
    const barcode = normalizeBarcode(get(r, 'barcode'));
    const sku = get(r, 'sku');
    const name = get(r, 'name');
    if (!barcode && !sku && !name) continue;
    const fail = (error: string) => rows.push({ rowNo, action: 'error', barcode, error });
    if (unsafe.has(rowNo)) {
      fail('Barcode is a long number Excel may have rounded. Format the column as Text and re-type it, or save as CSV.');
      continue;
    }
    const problem = barcodeProblem(barcode);
    if (problem) {
      fail(problem);
      continue;
    }
    const product = (sku && bySku.get(sku.toLowerCase())) || (!sku && name ? byName.get(name.toLowerCase()) : undefined);
    if (!product) {
      fail(`No product with ${sku ? `SKU "${sku}"` : `name "${name}"`}. Add it in Products first.`);
      continue;
    }
    if (!product.active) {
      fail(`${product.name} is switched off`);
      continue;
    }
    const owner = existing.get(barcode);
    if (owner && owner !== product.id) {
      const other = products.find((p) => p.id === owner);
      fail(`Already registered to a different product: ${other?.name ?? 'unknown'}`);
      continue;
    }
    if (seen.has(barcode)) {
      fail('Barcode repeated in this file');
      continue;
    }
    seen.add(barcode);
    if (owner) {
      rows.push({ rowNo, action: 'already', barcode, productId: product.id, productLabel: product.name });
      continue;
    }
    rows.push({ rowNo, action: 'new', barcode, productId: product.id, productLabel: product.name, serial: get(r, 'serial') || barcode });
  }
  const counts: Record<BarcodeRowAction, number> = { new: 0, already: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  return { rows, counts };
}

/** Save all new barcodes from a plan in one transaction. */
export async function applyBarcodeImport(db: Db, plan: BarcodePlan, userId: string, fileName: string): Promise<number> {
  const deviceId = await getDeviceId(db);
  const now = nowIso();
  let n = 0;
  await db.transaction(async (tx) => {
    for (const row of plan.rows) {
      if (row.action !== 'new') continue;
      await tx.run(
        `INSERT INTO product_barcodes (id, barcode, product_id, serial_no, status, registered_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'registered', ?, ?, ?)`,
        [newId(), row.barcode!, row.productId!, row.serial!, userId, now, now],
      );
      n++;
    }
    await writeAudit(tx, { userId, action: 'barcode.import', entity: 'product_barcodes', after: { fileName, added: n, ...plan.counts }, deviceId });
  });
  return n;
}
