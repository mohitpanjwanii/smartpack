import type { Db } from '../types';
import { newId, nowIso } from '../../domain/ids';
import { barcodeProblem, normalizeBarcode } from '../../domain/barcode';
import { isUniqueViolation } from '../errors';
import { writeAudit } from './audit';
import { getDeviceId } from './settings';

export type BarcodeStatus = 'registered' | 'packed' | 'void' | 'damaged';

export interface BarcodeInfo {
  id: string;
  barcode: string;
  serial_no: string;
  status: BarcodeStatus;
  product_id: string;
  product_name: string;
  sku: string;
  order_no: string | null;
  carton_no: string | null;
  created_at: string;
}

export const STATUS_LABEL: Record<BarcodeStatus, string> = {
  registered: 'Ready to pack',
  packed: 'Packed',
  void: 'Void (cancelled)',
  damaged: 'Damaged',
};

export class BarcodeError extends Error {
  constructor(message: string, readonly existing?: BarcodeInfo) {
    super(message);
  }
}

const INFO_SQL = `SELECT b.id, b.barcode, b.serial_no, b.status, b.product_id, p.name AS product_name, p.sku,
  o.order_no, c.carton_no, b.created_at
  FROM product_barcodes b
  JOIN products p ON p.id = b.product_id
  LEFT JOIN orders o ON o.id = b.order_id
  LEFT JOIN cartons c ON c.id = b.carton_id`;

export async function lookupBarcode(db: Db, raw: string): Promise<BarcodeInfo | undefined> {
  return db.get<BarcodeInfo>(`${INFO_SQL} WHERE b.barcode = ?`, [normalizeBarcode(raw)]);
}

export async function listBarcodesForProduct(db: Db, productId: string, limit = 50): Promise<BarcodeInfo[]> {
  return db.all<BarcodeInfo>(`${INFO_SQL} WHERE b.product_id = ? ORDER BY b.created_at DESC LIMIT ?`, [productId, limit]);
}

function describeExisting(e: BarcodeInfo): string {
  return `Already registered to ${e.product_name} (${e.sku}), status: ${STATUS_LABEL[e.status]}${e.order_no ? `, order ${e.order_no}` : ''}`;
}

/**
 * Register one physical item's barcode against a product. Refuses blanks and
 * any barcode already in the system, naming the product it belongs to.
 * The serial number defaults to the barcode itself.
 */
export async function registerBarcode(
  db: Db,
  input: { barcode: string; productId: string; serialNo?: string },
  userId: string,
): Promise<BarcodeInfo> {
  const code = normalizeBarcode(input.barcode);
  const problem = barcodeProblem(code);
  if (problem) throw new BarcodeError(problem);
  const existing = await lookupBarcode(db, code);
  if (existing) throw new BarcodeError(describeExisting(existing), existing);

  const product = await db.get<{ id: string; active: number }>('SELECT id, active FROM products WHERE id = ?', [input.productId]);
  if (!product) throw new BarcodeError('Product not found');
  if (!product.active) throw new BarcodeError('This product is switched off. Switch it on before registering barcodes.');

  const id = newId();
  const now = nowIso();
  const serial = normalizeBarcode(input.serialNo ?? '') || code;
  const deviceId = await getDeviceId(db);
  try {
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO product_barcodes (id, barcode, product_id, serial_no, status, registered_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'registered', ?, ?, ?)`,
        [id, code, input.productId, serial, userId, now, now],
      );
      await writeAudit(tx, { userId, action: 'barcode.register', entity: 'product_barcodes', entityId: id, after: { barcode: code, productId: input.productId, serial }, deviceId });
    });
  } catch (err) {
    // Another screen or phone may have registered it a moment ago.
    if (isUniqueViolation(err, 'product_barcodes.barcode')) {
      const now2 = await lookupBarcode(db, code);
      throw new BarcodeError(now2 ? describeExisting(now2) : 'Barcode already registered', now2);
    }
    if (isUniqueViolation(err, 'product_barcodes.product_id')) throw new BarcodeError(`Serial number ${serial} is already used for this product`);
    throw err;
  }
  return (await lookupBarcode(db, code))!;
}

/**
 * Supervisors can mark an unpacked item void or damaged (so it can never be
 * packed), or restore it. Packed items cannot be changed here: they must be
 * removed from their carton first (Stage 4). A reason is always required.
 */
export async function changeBarcodeStatus(
  db: Db,
  barcodeId: string,
  to: 'registered' | 'void' | 'damaged',
  reason: string,
  userId: string,
): Promise<void> {
  if (!reason.trim()) throw new BarcodeError('A reason is required');
  const deviceId = await getDeviceId(db);
  await db.transaction(async (tx) => {
    const row = await tx.get<{ status: BarcodeStatus }>('SELECT status FROM product_barcodes WHERE id = ?', [barcodeId]);
    if (!row) throw new BarcodeError('Barcode not found');
    if (row.status === 'packed') throw new BarcodeError('This item is packed. Remove it from its carton first.');
    if (row.status === to) return;
    await tx.run('UPDATE product_barcodes SET status = ?, updated_at = ? WHERE id = ?', [to, nowIso(), barcodeId]);
    await writeAudit(tx, { userId, action: `barcode.status_${to}`, entity: 'product_barcodes', entityId: barcodeId, before: { status: row.status }, after: { status: to, reason: reason.trim() }, deviceId });
  });
}
