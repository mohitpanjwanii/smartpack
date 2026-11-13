import type { Db } from '../types';
import { newId, nowIso } from '../../domain/ids';
import { isUniqueViolation } from '../errors';
import { writeAudit } from './audit';
import { getDeviceId } from './settings';
import { findOrCreateCustomer, type CustomerInput } from './customers';
import { rememberAlias } from './aliases';

export type OrderStatus = 'draft' | 'packing' | 'packed' | 'dispatched' | 'cancelled';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Ready to pack',
  packing: 'Packing',
  packed: 'Packed',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

export interface OrderItemInput {
  productId: string;
  qty: number;
  unit: string;
  /** Text as printed on the invoice, kept for traceability and to learn the name. */
  sourceText?: string | null;
}

export interface OrderInput {
  customer: CustomerInput;
  invoiceNo: string | null;
  invoiceDate: string | null;
  source: 'manual' | 'invoice';
  notes?: string | null;
  items: OrderItemInput[];
  invoiceFile?: { path: string; mimeType: string; source: 'camera' | 'upload'; method: 'ocr' | 'manual' | 'ai'; rawResult: string } | null;
}

export class OrderError extends Error {}

export interface OrderSummary {
  id: string;
  order_no: string;
  status: OrderStatus;
  invoice_no: string | null;
  invoice_date: string | null;
  customer_name: string;
  lines: number;
  total_qty: number;
  created_at: string;
}

export interface OrderItemRow {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  ordered_qty: number;
  unit: string;
  source_text: string | null;
}

export interface OrderDetail extends OrderSummary {
  customer_id: string;
  customer_gstin: string | null;
  customer_address: string | null;
  source: 'manual' | 'invoice';
  notes: string | null;
  items: OrderItemRow[];
  invoice_file: { id: string; file_path: string; mime_type: string | null } | null;
}

function validateItems(items: OrderItemInput[]): OrderItemInput[] {
  if (!items.length) throw new OrderError('Add at least one product');
  const merged = new Map<string, OrderItemInput>();
  for (const it of items) {
    if (!it.productId) throw new OrderError('Every line needs a product');
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new OrderError('Every quantity must be a whole number above zero');
    const prev = merged.get(it.productId);
    // The same product twice on one invoice becomes one order line.
    if (prev) merged.set(it.productId, { ...prev, qty: prev.qty + it.qty, sourceText: [prev.sourceText, it.sourceText].filter(Boolean).join(' + ') });
    else merged.set(it.productId, { ...it });
  }
  return [...merged.values()];
}

async function nextManualOrderNo(tx: Db): Promise<string> {
  const d = new Date();
  const prefix = `M-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-`;
  const row = await tx.get<{ n: number }>("SELECT count(*) AS n FROM orders WHERE order_no LIKE ? || '%'", [prefix]);
  return prefix + String((row?.n ?? 0) + 1).padStart(3, '0');
}

/**
 * Create an order with its lines in one transaction. Invoice orders use the
 * invoice number as the order number, so staff see the number they know.
 * Confirmed invoice wordings are remembered for future matching.
 */
export async function createOrder(db: Db, input: OrderInput, userId: string): Promise<string> {
  const items = validateItems(input.items);
  const invoiceNo = input.invoiceNo?.trim() || null;
  if (input.source === 'invoice' && !invoiceNo) throw new OrderError('Invoice number is required');
  const deviceId = await getDeviceId(db);
  const now = nowIso();
  const orderId = newId();
  try {
    await db.transaction(async (tx) => {
      const customer = await findOrCreateCustomer(tx, input.customer);
      const orderNo = invoiceNo ?? (await nextManualOrderNo(tx));
      await tx.run(
        `INSERT INTO orders (id, order_no, customer_id, invoice_no, invoice_date, source, status, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [orderId, orderNo, customer.id, invoiceNo, input.invoiceDate, input.source, input.notes ?? null, userId, now, now],
      );
      for (const it of items) {
        await tx.run(
          `INSERT INTO order_items (id, order_id, product_id, ordered_qty, unit, source_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId(), orderId, it.productId, it.qty, it.unit, it.sourceText ?? null, now, now],
        );
        if (it.sourceText && input.source === 'invoice') {
          for (const part of it.sourceText.split(' + ')) await rememberAlias(tx, part, it.productId, userId);
        }
      }
      if (input.invoiceFile) {
        const f = input.invoiceFile;
        await tx.run(
          `INSERT INTO invoice_files (id, order_id, file_path, mime_type, source, extraction_method, raw_result, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId(), orderId, f.path, f.mimeType, f.source, f.method, f.rawResult, userId, now],
        );
      }
      await writeAudit(tx, {
        userId,
        action: 'order.create',
        entity: 'orders',
        entityId: orderId,
        after: { orderNo, source: input.source, customerCreated: customer.created, items: items.map((i) => ({ p: i.productId, q: i.qty, u: i.unit })) },
        deviceId,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'orders.order_no') || isUniqueViolation(err, 'orders.customer_id')) {
      throw new OrderError(`An order for invoice ${invoiceNo} already exists`);
    }
    throw err;
  }
  return orderId;
}

/** Replace the lines of an order that has not started packing. */
export async function updateDraftOrderItems(db: Db, orderId: string, items: OrderItemInput[], userId: string): Promise<void> {
  const clean = validateItems(items);
  const deviceId = await getDeviceId(db);
  const now = nowIso();
  await db.transaction(async (tx) => {
    const o = await tx.get<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = ?', [orderId]);
    if (!o) throw new OrderError('Order not found');
    if (o.status !== 'draft') throw new OrderError('Only orders that have not started packing can be edited');
    const before = await tx.all('SELECT product_id, ordered_qty, unit FROM order_items WHERE order_id = ?', [orderId]);
    await tx.run('DELETE FROM order_items WHERE order_id = ?', [orderId]);
    for (const it of clean) {
      await tx.run(
        `INSERT INTO order_items (id, order_id, product_id, ordered_qty, unit, source_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), orderId, it.productId, it.qty, it.unit, it.sourceText ?? null, now, now],
      );
    }
    await tx.run('UPDATE orders SET updated_at = ? WHERE id = ?', [now, orderId]);
    await writeAudit(tx, { userId, action: 'order.edit_items', entity: 'orders', entityId: orderId, before, after: clean, deviceId });
  });
}

export async function cancelOrder(db: Db, orderId: string, reason: string, userId: string): Promise<void> {
  if (!reason.trim()) throw new OrderError('A reason is required');
  const deviceId = await getDeviceId(db);
  await db.transaction(async (tx) => {
    const o = await tx.get<{ status: OrderStatus }>('SELECT status FROM orders WHERE id = ?', [orderId]);
    if (!o) throw new OrderError('Order not found');
    if (o.status !== 'draft') throw new OrderError('Only orders that have not started packing can be cancelled here');
    await tx.run("UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ?", [nowIso(), orderId]);
    await writeAudit(tx, { userId, action: 'order.cancel', entity: 'orders', entityId: orderId, before: { status: o.status }, after: { reason: reason.trim() }, deviceId });
  });
}

const SUMMARY_SQL = `SELECT o.id, o.order_no, o.status, o.invoice_no, o.invoice_date, c.name AS customer_name, o.created_at,
  (SELECT count(*) FROM order_items i WHERE i.order_id = o.id) AS lines,
  (SELECT coalesce(sum(i.ordered_qty), 0) FROM order_items i WHERE i.order_id = o.id) AS total_qty
  FROM orders o JOIN customers c ON c.id = o.customer_id`;

export async function listOrders(db: Db, filter: 'open' | 'done' | 'all', search = ''): Promise<OrderSummary[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (filter === 'open') where.push("o.status IN ('draft', 'packing')");
  if (filter === 'done') where.push("o.status IN ('packed', 'dispatched', 'cancelled')");
  if (search.trim()) {
    where.push('(o.order_no LIKE ? OR c.name LIKE ?)');
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }
  return db.all<OrderSummary>(`${SUMMARY_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT 200`, params);
}

export async function getOrderDetail(db: Db, id: string): Promise<OrderDetail | undefined> {
  const o = await db.get<OrderDetail>(
    `SELECT s.*, o.customer_id, c.gstin AS customer_gstin, c.address AS customer_address, o.source, o.notes
     FROM (${SUMMARY_SQL} WHERE o.id = ?) s JOIN orders o ON o.id = s.id JOIN customers c ON c.id = o.customer_id`,
    [id],
  );
  if (!o) return undefined;
  o.items = await db.all<OrderItemRow>(
    `SELECT i.id, i.product_id, p.name AS product_name, p.sku, i.ordered_qty, i.unit, i.source_text
     FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY p.name`,
    [id],
  );
  o.invoice_file = (await db.get('SELECT id, file_path, mime_type FROM invoice_files WHERE order_id = ? ORDER BY created_at DESC LIMIT 1', [id])) ?? null;
  return o;
}
