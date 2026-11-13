import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { createFirstAdmin } from '../src/db/repositories/users';
import { listProducts } from '../src/db/repositories/products';
import { applyProductImport, planProductImport } from '../src/domain/productImport';
import { parseCsv } from '../src/domain/spreadsheet';
import { createOrder, getOrderDetail, listOrders, updateDraftOrderItems, cancelOrder, OrderError } from '../src/db/repositories/orders';
import { getAliasMap } from '../src/db/repositories/aliases';
import { CustomerError } from '../src/db/repositories/customers';
import { matchProduct } from '../src/domain/productMatch';
import { parseTallyInvoice } from '../src/domain/invoiceParser';

const csv = readFileSync(new URL('./fixtures/perfect-veg-products.csv', import.meta.url), 'utf8');
const ocr = readFileSync(new URL('./fixtures/invoices/invoice-1125.ocr.txt', import.meta.url), 'utf8');

async function setup() {
  const db = await freshDb();
  const admin = await createFirstAdmin(db, { name: 'Mohit', pin: '2468', businessName: 'SMP Bakers' });
  await applyProductImport(db, planProductImport(parseCsv(csv), []), admin.id, 'p.csv');
  const products = await listProducts(db);
  const sku = (s: string) => products.find((p) => p.sku === s)!.id;
  return { db, admin, products, sku };
}

describe('orders from an invoice', () => {
  it('creates the order with the invoice number, customer by GSTIN, lines and remembered names', async () => {
    const { db, admin, products, sku } = await setup();
    const inv = parseTallyInvoice(ocr);
    // Staff confirm the matches on the review screen:
    const chosen: Record<string, string> = {
      'Fruit Jam Cookies': sku('PV-CK-01'),
      'Jeera Cookies': sku('PV-CK-12'),
      'Special Kaju Cookies': sku('PV-CK-06'),
      'Vanilla Cup Cake': sku('PV-CA-07'),
    };
    const id = await createOrder(db, {
      customer: { name: inv.buyerName!, gstin: inv.buyerGstin, address: inv.buyerAddress },
      invoiceNo: inv.invoiceNo,
      invoiceDate: inv.invoiceDate,
      source: 'invoice',
      items: inv.lines.map((l) => ({ productId: chosen[l.description], qty: l.qty, unit: l.unit, sourceText: l.description })),
      invoiceFile: { path: 'invoices/x.png', mimeType: 'image/png', source: 'upload', method: 'ocr', rawResult: ocr },
    }, admin.id);
    const o = (await getOrderDetail(db, id))!;
    expect(o).toMatchObject({ order_no: 'SMP/25-26/1125', customer_name: 'Ratnadeep Retail Pvt Limited', customer_gstin: '36AABCR8939B1ZB', status: 'draft', lines: 4, total_qty: 863 });
    expect(o.invoice_file?.file_path).toBe('invoices/x.png');

    // Next time "Special Kaju Cookies" is matched automatically.
    const m = matchProduct('Special Kaju Cookies', products, await getAliasMap(db));
    expect(m).toMatchObject({ kind: 'alias', productId: sku('PV-CK-06') });
  });

  it('refuses the same invoice twice', async () => {
    const { db, admin, sku } = await setup();
    const input = { customer: { name: 'Milk Corner', gstin: '27AAKPY6539N1ZM' }, invoiceNo: 'SMP/26-27/1546', invoiceDate: '2026-11-07', source: 'invoice' as const, items: [{ productId: sku('PV-CK-01'), qty: 10, unit: 'box' }] };
    await createOrder(db, input, admin.id);
    await expect(createOrder(db, input, admin.id)).rejects.toThrow(/already exists/);
  });

  it('reuses an existing customer by GSTIN even if OCR spelled the name differently', async () => {
    const { db, admin, sku } = await setup();
    const item = [{ productId: sku('PV-CA-07'), qty: 50, unit: 'pack' }];
    await createOrder(db, { customer: { name: 'HARSHA ENTERPRISES', gstin: '36BCLPB0667C1ZY' }, invoiceNo: 'A/1', invoiceDate: null, source: 'invoice', items: item }, admin.id);
    await createOrder(db, { customer: { name: 'ARSHA Co PRISES', gstin: '36BCLPB0667C1ZY' }, invoiceNo: 'A/2', invoiceDate: null, source: 'invoice', items: item }, admin.id);
    const orders = await listOrders(db, 'all');
    expect(new Set(orders.map((o) => o.customer_name))).toEqual(new Set(['HARSHA ENTERPRISES']));
  });

  it('rejects invalid GSTINs, empty orders and bad quantities', async () => {
    const { db, admin, sku } = await setup();
    const base = { invoiceNo: null, invoiceDate: null, source: 'manual' as const };
    await expect(createOrder(db, { ...base, customer: { name: 'X', gstin: '27AAKPY6539N1ZN' }, items: [{ productId: sku('PV-CK-01'), qty: 1, unit: 'box' }] }, admin.id)).rejects.toBeInstanceOf(CustomerError);
    await expect(createOrder(db, { ...base, customer: { name: 'X' }, items: [] }, admin.id)).rejects.toBeInstanceOf(OrderError);
    await expect(createOrder(db, { ...base, customer: { name: 'X' }, items: [{ productId: sku('PV-CK-01'), qty: 0, unit: 'box' }] }, admin.id)).rejects.toThrow(/above zero/);
    await expect(createOrder(db, { ...base, customer: { name: 'X' }, items: [{ productId: sku('PV-CK-01'), qty: 2.5, unit: 'box' }] }, admin.id)).rejects.toThrow(/whole number/);
    expect(await listOrders(db, 'all')).toHaveLength(0);
  });
});

describe('manual orders', () => {
  it('numbers manual orders M-YYMMDD-001, 002 and merges repeated products', async () => {
    const { db, admin, sku } = await setup();
    const mk = () => createOrder(db, { customer: { name: 'Walk-in shop' }, invoiceNo: null, invoiceDate: null, source: 'manual', items: [{ productId: sku('PV-CK-01'), qty: 3, unit: 'box' }, { productId: sku('PV-CK-01'), qty: 2, unit: 'box' }] }, admin.id);
    const a = (await getOrderDetail(db, await mk()))!;
    const b = (await getOrderDetail(db, await mk()))!;
    expect(a.order_no).toMatch(/^M-\d{6}-001$/);
    expect(b.order_no).toMatch(/^M-\d{6}-002$/);
    expect(a.items).toHaveLength(1);
    expect(a.items[0].ordered_qty).toBe(5);
    expect((await listOrders(db, 'all')).filter((o) => o.customer_name === 'Walk-in shop')).toHaveLength(2); // one customer reused
  });

  it('edits and cancels orders that have not started packing; cancelled orders leave the open list', async () => {
    const { db, admin, sku } = await setup();
    const id = await createOrder(db, { customer: { name: 'Shop' }, invoiceNo: null, invoiceDate: null, source: 'manual', items: [{ productId: sku('PV-CK-01'), qty: 3, unit: 'box' }] }, admin.id);
    await updateDraftOrderItems(db, id, [{ productId: sku('PV-CK-02'), qty: 7, unit: 'box' }], admin.id);
    expect((await getOrderDetail(db, id))!.items.map((i) => [i.sku, i.ordered_qty])).toEqual([['PV-CK-02', 7]]);
    await expect(cancelOrder(db, id, '', admin.id)).rejects.toThrow(/reason/);
    await cancelOrder(db, id, 'Customer cancelled', admin.id);
    expect(await listOrders(db, 'open')).toHaveLength(0);
    expect((await listOrders(db, 'done'))[0].status).toBe('cancelled');
    await expect(updateDraftOrderItems(db, id, [{ productId: sku('PV-CK-02'), qty: 1, unit: 'box' }], admin.id)).rejects.toThrow(/not started packing/);
  });
});
