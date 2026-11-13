import { describe, expect, it } from 'vitest';
import { freshDb, insertScan, seedPackingGraph } from './helpers';
import { migrate, currentVersion } from '../src/db/migrate';
import { isUniqueViolation, ruleMessage } from '../src/db/errors';
import { newId, nowIso } from '../src/domain/ids';

const REQUIRED_TABLES = [
  'products', 'product_barcodes', 'customers', 'orders', 'order_items', 'cartons', 'carton_items',
  'packing_events', 'users', 'invoice_files', 'audit_logs', 'sync_queue', 'settings', 'schema_migrations',
];

describe('migrations', () => {
  it('creates every required table', async () => {
    const db = await freshDb();
    const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = rows.map((r) => r.name);
    for (const t of REQUIRED_TABLES) expect(names, t).toContain(t);
    expect(await currentVersion(db)).toBe(1);
  });

  it('is safe to run again (nothing re-applied)', async () => {
    const db = await freshDb();
    expect(await migrate(db)).toEqual([]);
    expect(await currentVersion(db)).toBe(1);
  });

  it('enforces foreign keys', async () => {
    const db = await freshDb();
    const t = nowIso();
    await expect(
      db.run(`INSERT INTO product_barcodes (id, barcode, product_id, serial_no, created_at, updated_at) VALUES (?, 'X1', 'no-such-product', '1', ?, ?)`, [newId(), t, t]),
    ).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('unique barcodes', () => {
  it('rejects the same barcode registered twice, even for another product', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    const err = await db
      .run(`INSERT INTO product_barcodes (id, barcode, product_id, serial_no, created_at, updated_at) VALUES (?, 'SMP0001', ?, '0099', ?, ?)`, [newId(), ids.product2, t, t])
      .catch((e) => e);
    expect(isUniqueViolation(err, 'product_barcodes.barcode')).toBe(true);
  });

  it('rejects blank barcodes and barcodes with stray spaces', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    for (const bad of ['', ' SMP0009', 'SMP0009 ']) {
      await expect(
        db.run(`INSERT INTO product_barcodes (id, barcode, product_id, serial_no, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, [newId(), bad, ids.product, newId(), t, t]),
      ).rejects.toThrow(/CHECK/);
    }
  });

  it('rejects a duplicate serial number for the same product', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    await expect(
      db.run(`INSERT INTO product_barcodes (id, barcode, product_id, serial_no, created_at, updated_at) VALUES (?, 'NEW1', ?, '0001', ?, ?)`, [newId(), ids.product, t, t]),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('rejects duplicate SKUs regardless of letter case', async () => {
    const db = await freshDb();
    await seedPackingGraph(db);
    const t = nowIso();
    await expect(
      db.run(`INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, 'bis-200', 'Copy', ?, ?)`, [newId(), t, t]),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('does not allow a barcode marked packed without an order and carton', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    await expect(db.run(`UPDATE product_barcodes SET status = 'packed' WHERE id = ?`, [ids.barcode])).rejects.toThrow(/CHECK/);
    await db.run(`UPDATE product_barcodes SET status = 'packed', order_id = ?, carton_id = ? WHERE id = ?`, [ids.order, ids.carton, ids.barcode]);
  });
});

describe('never count a barcode twice', () => {
  it('rejects a second active scan of the same physical barcode', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    await insertScan(db, ids);
    const err = await insertScan(db, ids).catch((e) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('rejects the second scan even in a different carton or order', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    const order2 = newId();
    const carton2 = newId();
    await db.run(`INSERT INTO orders (id, order_no, customer_id, created_at, updated_at) VALUES (?, 'ORD-2', ?, ?, ?)`, [order2, ids.customer, t, t]);
    await db.run(`INSERT INTO cartons (id, carton_no, order_id, seq, opened_at, updated_at) VALUES (?, 'ORD-2-C1', ?, 1, ?, ?)`, [carton2, order2, t, t]);
    await insertScan(db, ids);
    await expect(insertScan(db, ids, { order_id: order2, carton_id: carton2 })).rejects.toThrow(/UNIQUE/);
  });

  it('allows a fresh scan only after the earlier one is formally reversed with a reason', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const first = await insertScan(db, ids);
    await expect(insertScan(db, ids, { event_type: 'scan_reversed', barcode_id: ids.barcode })).rejects.toThrow(/CHECK/);
    const rev = await insertScan(db, ids, { event_type: 'scan_reversed', reason: 'Wrong carton' });
    await db.run('UPDATE packing_events SET reversed_by_event_id = ? WHERE id = ?', [rev, first]);
    await insertScan(db, ids); // allowed now
    // and still only one active scan
    const n = await db.get<{ n: number }>(
      "SELECT count(*) AS n FROM packing_events WHERE event_type = 'scan' AND reversed_by_event_id IS NULL AND barcode_id = ?",
      [ids.barcode],
    );
    expect(n?.n).toBe(1);
  });

  it('rejects a scan whose barcode belongs to a different product', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const err = await insertScan(db, ids, { product_id: ids.product2 }).catch((e) => e);
    expect(ruleMessage(err)).toMatch(/does not belong/);
  });

  it('rejects scans into a closed carton or a carton of another order', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    await db.run(`UPDATE cartons SET status = 'closed', closed_at = ?, closure_status = 'verified' WHERE id = ?`, [t, ids.carton]);
    expect(ruleMessage(await insertScan(db, ids).catch((e) => e))).toMatch(/not open/);
  });
});

describe('manual adjustments and overrides', () => {
  it('requires a reason for manual quantity changes', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    await expect(insertScan(db, ids, { event_type: 'manual_add', barcode_id: null, qty: 2 })).rejects.toThrow(/CHECK/);
    await expect(insertScan(db, ids, { event_type: 'manual_add', barcode_id: null, qty: 2, reason: '   ' })).rejects.toThrow(/CHECK/);
    await insertScan(db, ids, { event_type: 'manual_add', barcode_id: null, qty: 2, reason: 'Label torn' });
  });

  it('requires a reason when a carton is closed by supervisor override', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    await expect(
      db.run(`UPDATE cartons SET status = 'closed', closed_at = ?, closure_status = 'override' WHERE id = ?`, [t, ids.carton]),
    ).rejects.toThrow(/CHECK/);
    await db.run(`UPDATE cartons SET status = 'closed', closed_at = ?, closure_status = 'override', override_reason = 'Customer approved short' WHERE id = ?`, [t, ids.carton]);
  });

  it('keeps scanned and manual quantities as separate, non-negative numbers', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    await db.run(`INSERT INTO carton_items (carton_id, product_id, scanned_qty, manual_qty, updated_at) VALUES (?, ?, 3, 1, ?)`, [ids.carton, ids.product, t]);
    await expect(db.run(`UPDATE carton_items SET manual_qty = -1 WHERE carton_id = ?`, [ids.carton])).rejects.toThrow(/CHECK/);
  });

  it('rejects zero or negative ordered quantities', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    await expect(
      db.run(`INSERT INTO order_items (id, order_id, product_id, ordered_qty, unit, created_at, updated_at) VALUES (?, ?, ?, 0, 'pcs', ?, ?)`, [newId(), ids.order, ids.product, t, t]),
    ).rejects.toThrow(/CHECK/);
  });

  it('rejects duplicate carton numbers', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const t = nowIso();
    await expect(
      db.run(`INSERT INTO cartons (id, carton_no, order_id, seq, opened_at, updated_at) VALUES (?, 'ORD-1-C1', ?, 2, ?, ?)`, [newId(), ids.order, t, t]),
    ).rejects.toThrow(/UNIQUE/);
  });
});

describe('permanent records', () => {
  it('packing events cannot be deleted or edited', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const ev = await insertScan(db, ids);
    expect(ruleMessage(await db.run('DELETE FROM packing_events WHERE id = ?', [ev]).catch((e) => e))).toMatch(/cannot be deleted/);
    expect(ruleMessage(await db.run('UPDATE packing_events SET qty = 5 WHERE id = ?', [ev]).catch((e) => e))).toMatch(/cannot be edited/);
  });

  it('a reversal mark can be set once and never changed', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    const ev = await insertScan(db, ids);
    const r1 = await insertScan(db, ids, { event_type: 'scan_reversed', reason: 'Mistake' });
    await db.run('UPDATE packing_events SET reversed_by_event_id = ? WHERE id = ?', [r1, ev]);
    const r2 = await insertScan(db, ids, { event_type: 'scan_reversed', reason: 'Again' });
    expect(ruleMessage(await db.run('UPDATE packing_events SET reversed_by_event_id = ? WHERE id = ?', [r2, ev]).catch((e) => e))).toMatch(/cannot be edited/);
  });

  it('audit log rows cannot be changed or removed', async () => {
    const db = await freshDb();
    const id = newId();
    await db.run(`INSERT INTO audit_logs (id, action, entity, device_id, created_at) VALUES (?, 'test', 'x', 'd', ?)`, [id, nowIso()]);
    await expect(db.run(`UPDATE audit_logs SET action = 'changed' WHERE id = ?`, [id])).rejects.toThrow(/cannot be edited/);
    await expect(db.run(`DELETE FROM audit_logs WHERE id = ?`, [id])).rejects.toThrow(/cannot be deleted/);
  });
});

describe('transactions', () => {
  it('saves nothing when any step fails', async () => {
    const db = await freshDb();
    const ids = await seedPackingGraph(db);
    await expect(
      db.transaction(async (tx) => {
        await tx.run(`UPDATE product_barcodes SET status = 'packed', order_id = ?, carton_id = ? WHERE id = ?`, [ids.order, ids.carton, ids.barcode]);
        await tx.run(`INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, 'BIS-200', 'dup', 'x', 'x')`, [newId()]);
      }),
    ).rejects.toThrow(/UNIQUE/);
    const row = await db.get<{ status: string }>('SELECT status FROM product_barcodes WHERE id = ?', [ids.barcode]);
    expect(row?.status).toBe('registered');
  });

  it('runs concurrent transactions one after another, never interleaved', async () => {
    const db = await freshDb();
    await db.run(`INSERT INTO settings (key, value) VALUES ('counter', '0')`);
    const bump = () =>
      db.transaction(async (tx) => {
        const r = await tx.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'counter'`);
        await new Promise((res) => setTimeout(res, 1));
        await tx.run(`UPDATE settings SET value = ? WHERE key = 'counter'`, [String(Number(r!.value) + 1)]);
      });
    await Promise.all(Array.from({ length: 20 }, bump));
    const r = await db.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'counter'`);
    expect(r?.value).toBe('20');
  });
});
