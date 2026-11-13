import type { Db } from '../types';
import { newId, nowIso } from '../../domain/ids';
import { isUniqueViolation } from '../errors';
import { writeAudit } from './audit';
import { getDeviceId } from './settings';

export interface Product {
  id: string;
  sku: string;
  name: string;
  unit: string;
  pack_size: number | null;
  hsn_code: string | null;
  active: number;
}

export interface ProductWithCounts extends Product {
  registered: number;
  packed: number;
}

export interface ProductInput {
  sku: string;
  name: string;
  unit: string;
  pack_size: number | null;
  hsn_code: string | null;
}

export class ProductError extends Error {}

const COLS = 'p.id, p.sku, p.name, p.unit, p.pack_size, p.hsn_code, p.active';

export function cleanProductInput(input: ProductInput): ProductInput {
  const out: ProductInput = {
    sku: input.sku.trim(),
    name: input.name.trim().replace(/\s+/g, ' '),
    unit: (input.unit || 'pcs').trim().toLowerCase(),
    pack_size: input.pack_size,
    hsn_code: input.hsn_code?.trim() || null,
  };
  if (!out.sku) throw new ProductError('SKU / product code is required');
  if (!out.name) throw new ProductError('Product name is required');
  if (out.pack_size !== null && !(out.pack_size > 0)) throw new ProductError('Pack size must be a positive number');
  return out;
}

export async function listProducts(
  db: Db,
  opts: { search?: string; includeInactive?: boolean } = {},
): Promise<ProductWithCounts[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (!opts.includeInactive) where.push('p.active = 1');
  if (opts.search?.trim()) {
    where.push('(p.name LIKE ? OR p.sku LIKE ?)');
    const like = `%${opts.search.trim()}%`;
    params.push(like, like);
  }
  return db.all<ProductWithCounts>(
    `SELECT ${COLS},
       (SELECT count(*) FROM product_barcodes b WHERE b.product_id = p.id AND b.status = 'registered') AS registered,
       (SELECT count(*) FROM product_barcodes b WHERE b.product_id = p.id AND b.status = 'packed') AS packed
     FROM products p ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.name COLLATE NOCASE`,
    params,
  );
}

export async function getProduct(db: Db, id: string): Promise<Product | undefined> {
  return db.get<Product>(`SELECT ${COLS} FROM products p WHERE p.id = ?`, [id]);
}

export async function findProductBySku(db: Db, sku: string): Promise<Product | undefined> {
  return db.get<Product>(`SELECT ${COLS} FROM products p WHERE p.sku = ? COLLATE NOCASE`, [sku.trim()]);
}

export async function createProduct(db: Db, input: ProductInput, userId: string): Promise<Product> {
  const p = cleanProductInput(input);
  const now = nowIso();
  const product: Product = { id: newId(), ...p, active: 1 };
  const deviceId = await getDeviceId(db);
  try {
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO products (id, sku, name, unit, pack_size, hsn_code, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [product.id, p.sku, p.name, p.unit, p.pack_size, p.hsn_code, now, now],
      );
      await writeAudit(tx, { userId, action: 'product.create', entity: 'products', entityId: product.id, after: p, deviceId });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'products.sku')) throw new ProductError(`SKU "${p.sku}" is already used by another product`);
    throw err;
  }
  return product;
}

export async function updateProduct(db: Db, id: string, input: ProductInput, userId: string): Promise<void> {
  const p = cleanProductInput(input);
  const deviceId = await getDeviceId(db);
  try {
    await db.transaction(async (tx) => {
      const before = await tx.get<Product>(`SELECT ${COLS} FROM products p WHERE p.id = ?`, [id]);
      if (!before) throw new ProductError('Product not found');
      await tx.run(
        `UPDATE products SET sku = ?, name = ?, unit = ?, pack_size = ?, hsn_code = ?, updated_at = ? WHERE id = ?`,
        [p.sku, p.name, p.unit, p.pack_size, p.hsn_code, nowIso(), id],
      );
      await writeAudit(tx, { userId, action: 'product.update', entity: 'products', entityId: id, before, after: p, deviceId });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'products.sku')) throw new ProductError(`SKU "${p.sku}" is already used by another product`);
    throw err;
  }
}

/** Products are never deleted (orders and barcodes refer to them); they are switched off instead. */
export async function setProductActive(db: Db, id: string, active: boolean, userId: string): Promise<void> {
  const deviceId = await getDeviceId(db);
  await db.transaction(async (tx) => {
    await tx.run('UPDATE products SET active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, nowIso(), id]);
    await writeAudit(tx, {
      userId,
      action: active ? 'product.activate' : 'product.deactivate',
      entity: 'products',
      entityId: id,
      deviceId,
    });
  });
}
