import type { Db } from '../db/types';
import type { Product, ProductInput } from '../db/repositories/products';
import { cleanProductInput, ProductError } from '../db/repositories/products';
import { writeAudit } from '../db/repositories/audit';
import { getDeviceId } from '../db/repositories/settings';
import { newId, nowIso } from './ids';
import { findColumns, type Table } from './spreadsheet';

/** Column headings we recognise, after normalising (lower case, no punctuation). */
export const PRODUCT_COLUMNS = {
  sku: ['sku', 'code', 'item code', 'product code', 'item no', 'item number', 'article', 'article code', 'part no', 'stock code', 'sku code'],
  name: ['name', 'product', 'product name', 'item', 'item name', 'description', 'item description', 'particulars', 'stock item', 'name of item'],
  unit: ['unit', 'uom', 'units', 'unit of measure', 'unit of measurement'],
  pack_size: ['pack size', 'pack', 'size', 'weight', 'net weight', 'net wt', 'qty per pack'],
  hsn: ['hsn', 'hsn code', 'hsn/sac', 'hsn sac', 'hsn/sac code'],
};
type Field = keyof typeof PRODUCT_COLUMNS;

export type RowAction = 'new' | 'update' | 'unchanged' | 'error';

export interface PlannedRow {
  rowNo: number; // spreadsheet row number, as the user sees it
  action: RowAction;
  input?: ProductInput;
  existingId?: string;
  changes?: string[];
  error?: string;
}

export interface ImportPlan {
  rows: PlannedRow[];
  generatedSkus: boolean;
  counts: Record<RowAction, number>;
}

export class ImportError extends Error {}

function parsePackSize(raw: string): number | null | 'bad' {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/^\s*(\d+(?:\.\d+)?)/);
  if (!m) return 'bad';
  const n = Number(m[1]);
  return n > 0 ? n : 'bad';
}

/**
 * Build a preview of what an import would do, without saving anything.
 * Products are matched to existing ones by SKU. If the file has no SKU
 * column, codes are generated (P0001, P0002, ...) and products are matched by
 * exact name instead.
 */
export function planProductImport(table: Table, existing: Product[]): ImportPlan {
  let found = findColumns(table, PRODUCT_COLUMNS, ['sku', 'name']);
  let generatedSkus = false;
  if (!found) {
    found = findColumns(table, PRODUCT_COLUMNS, ['name']);
    generatedSkus = true;
  }
  if (!found) {
    throw new ImportError('Could not find a "Product name" column. The first rows should have headings such as Item Code, Product Name, Unit.');
  }
  const { headerRow, columns } = found;
  const col = (r: string[], f: Field) => (columns[f] === undefined ? '' : (r[columns[f]!] ?? '').trim());

  const bySku = new Map(existing.map((p) => [p.sku.toLowerCase(), p]));
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));
  let nextCode =
    existing.reduce((max, p) => {
      const m = p.sku.match(/^P(\d+)$/i);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0) + 1;

  const seen = new Set<string>();
  const rows: PlannedRow[] = [];
  for (let i = headerRow + 1; i < table.length; i++) {
    const r = table[i];
    const rowNo = i + 1;
    const name = col(r, 'name');
    let sku = col(r, 'sku');
    if (!name && !sku) continue;
    const pack = parsePackSize(col(r, 'pack_size'));
    if (pack === 'bad') {
      rows.push({ rowNo, action: 'error', error: `Pack size "${col(r, 'pack_size')}" is not a number` });
      continue;
    }
    const match = generatedSkus ? byName.get(name.toLowerCase()) : bySku.get(sku.toLowerCase());
    if (generatedSkus) sku = match ? match.sku : `P${String(nextCode++).padStart(4, '0')}`;

    let input: ProductInput;
    try {
      input = cleanProductInput({ sku, name, unit: col(r, 'unit') || match?.unit || 'pcs', pack_size: pack, hsn_code: col(r, 'hsn') || null });
    } catch (err) {
      rows.push({ rowNo, action: 'error', error: err instanceof ProductError ? err.message : String(err) });
      continue;
    }
    const key = (generatedSkus ? input.name : input.sku).toLowerCase();
    if (seen.has(key)) {
      rows.push({ rowNo, action: 'error', error: `Repeated in this file: ${generatedSkus ? input.name : input.sku}` });
      continue;
    }
    seen.add(key);

    if (!match) {
      rows.push({ rowNo, action: 'new', input });
      continue;
    }
    const changes: string[] = [];
    if (match.name !== input.name) changes.push(`name: ${match.name} → ${input.name}`);
    if (match.unit !== input.unit) changes.push(`unit: ${match.unit} → ${input.unit}`);
    if ((match.pack_size ?? null) !== input.pack_size && columns.pack_size !== undefined)
      changes.push(`pack size: ${match.pack_size ?? '-'} → ${input.pack_size ?? '-'}`);
    if ((match.hsn_code ?? null) !== input.hsn_code && columns.hsn !== undefined)
      changes.push(`HSN: ${match.hsn_code ?? '-'} → ${input.hsn_code ?? '-'}`);
    // Keep existing values for columns the file does not have.
    if (columns.pack_size === undefined) input.pack_size = match.pack_size;
    if (columns.hsn === undefined) input.hsn_code = match.hsn_code;
    rows.push({ rowNo, action: changes.length ? 'update' : 'unchanged', input, existingId: match.id, changes });
  }

  const counts: Record<RowAction, number> = { new: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  return { rows, generatedSkus, counts };
}

/** Save an import plan: all new and changed products in one transaction (all or nothing). */
export async function applyProductImport(db: Db, plan: ImportPlan, userId: string, fileName: string) {
  const deviceId = await getDeviceId(db);
  const now = nowIso();
  await db.transaction(async (tx) => {
    for (const row of plan.rows) {
      if (!row.input) continue;
      const p = row.input;
      if (row.action === 'new') {
        const id = newId();
        await tx.run(
          `INSERT INTO products (id, sku, name, unit, pack_size, hsn_code, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [id, p.sku, p.name, p.unit, p.pack_size, p.hsn_code, now, now],
        );
        await writeAudit(tx, { userId, action: 'product.import_create', entity: 'products', entityId: id, after: p, deviceId });
      } else if (row.action === 'update' && row.existingId) {
        await tx.run(`UPDATE products SET name = ?, unit = ?, pack_size = ?, hsn_code = ?, updated_at = ? WHERE id = ?`, [
          p.name, p.unit, p.pack_size, p.hsn_code, now, row.existingId,
        ]);
        await writeAudit(tx, { userId, action: 'product.import_update', entity: 'products', entityId: row.existingId, after: { ...p, changes: row.changes }, deviceId });
      }
    }
    await writeAudit(tx, { userId, action: 'product.import', entity: 'products', after: { fileName, ...plan.counts }, deviceId });
  });
}
