import initSqlJs from 'sql.js';
import { createSqlJsDriver } from '../src/db/sqljsDriver';
import { createLockedDb } from '../src/db/lockedDb';
import { migrate } from '../src/db/migrate';
import type { Db } from '../src/db/types';
import { newId, nowIso } from '../src/domain/ids';

/** A fresh, fully migrated in-memory database using the real schema. */
export async function freshDb(): Promise<Db> {
  const SQL = await initSqlJs();
  const { driver } = createSqlJsDriver(SQL);
  const db = createLockedDb(driver);
  await migrate(db);
  return db;
}

/** Inserts the minimum linked records needed to exercise packing rules. */
export async function seedPackingGraph(db: Db) {
  const t = nowIso();
  const ids = {
    user: newId(),
    product: newId(),
    product2: newId(),
    customer: newId(),
    order: newId(),
    carton: newId(),
    barcode: newId(),
    barcode2: newId(),
  };
  await db.run(
    `INSERT INTO users (id, name, role, pin_hash, pin_salt, created_at, updated_at) VALUES (?, 'Ravi', 'packer', 'h', 's', ?, ?)`,
    [ids.user, t, t],
  );
  await db.run(`INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, 'BIS-200', 'Butter biscuit 200g', ?, ?)`, [ids.product, t, t]);
  await db.run(`INSERT INTO products (id, sku, name, created_at, updated_at) VALUES (?, 'CAK-500', 'Plum cake 500g', ?, ?)`, [ids.product2, t, t]);
  await db.run(`INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, 'Test customer', ?, ?)`, [ids.customer, t, t]);
  await db.run(`INSERT INTO orders (id, order_no, customer_id, created_at, updated_at) VALUES (?, 'ORD-1', ?, ?, ?)`, [ids.order, ids.customer, t, t]);
  await db.run(`INSERT INTO cartons (id, carton_no, order_id, seq, opened_at, updated_at) VALUES (?, 'ORD-1-C1', ?, 1, ?, ?)`, [ids.carton, ids.order, t, t]);
  await db.run(
    `INSERT INTO product_barcodes (id, barcode, product_id, serial_no, created_at, updated_at) VALUES (?, 'SMP0001', ?, '0001', ?, ?)`,
    [ids.barcode, ids.product, t, t],
  );
  await db.run(
    `INSERT INTO product_barcodes (id, barcode, product_id, serial_no, created_at, updated_at) VALUES (?, 'SMP0002', ?, '0001', ?, ?)`,
    [ids.barcode2, ids.product2, t, t],
  );
  return ids;
}

export async function insertScan(db: Db, ids: Awaited<ReturnType<typeof seedPackingGraph>>, over: Partial<Record<string, string | number | null>> = {}) {
  const id = (over.id as string) ?? newId();
  await db.run(
    `INSERT INTO packing_events (id, event_type, order_id, carton_id, product_id, barcode_id, qty, reason, user_id, device_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'dev-1', ?)`,
    [
      id,
      (over.event_type as string) ?? 'scan',
      (over.order_id as string) ?? ids.order,
      over.carton_id === undefined ? ids.carton : (over.carton_id as string | null),
      over.product_id === undefined ? ids.product : (over.product_id as string | null),
      over.barcode_id === undefined ? ids.barcode : (over.barcode_id as string | null),
      (over.qty as number) ?? 1,
      (over.reason as string | null) ?? null,
      ids.user,
      nowIso(),
    ],
  );
  return id;
}
