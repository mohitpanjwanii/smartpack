import type { Db } from '../types';
import { newId, nowIso } from '../../domain/ids';
import { isValidGstin } from '../../domain/gstin';

export interface Customer {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  address: string | null;
}

export class CustomerError extends Error {}

export async function findCustomerByGstin(db: Db, gstin: string): Promise<Customer | undefined> {
  return db.get<Customer>('SELECT id, name, gstin, phone, address FROM customers WHERE gstin = ?', [gstin.trim().toUpperCase()]);
}

export async function searchCustomers(db: Db, q: string, limit = 20): Promise<Customer[]> {
  const like = `%${q.trim()}%`;
  return db.all<Customer>(
    'SELECT id, name, gstin, phone, address FROM customers WHERE name LIKE ? OR gstin LIKE ? ORDER BY name COLLATE NOCASE LIMIT ?',
    [like, like, limit],
  );
}

export interface CustomerInput {
  name: string;
  gstin?: string | null;
  address?: string | null;
  phone?: string | null;
}

/** Validate and tidy customer details. A GSTIN, if given, must pass its check digit. */
export function cleanCustomer(input: CustomerInput): Required<CustomerInput> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new CustomerError('Customer name is required');
  const gstin = input.gstin?.trim().toUpperCase() || null;
  if (gstin && !isValidGstin(gstin)) throw new CustomerError(`GSTIN ${gstin} is not valid. Check each character.`);
  return { name, gstin, address: input.address?.trim() || null, phone: input.phone?.trim() || null };
}

/**
 * Inside a transaction: reuse the customer with this GSTIN (or this exact
 * name when there is no GSTIN), otherwise create it.
 */
export async function findOrCreateCustomer(tx: Db, input: CustomerInput): Promise<{ id: string; created: boolean }> {
  const c = cleanCustomer(input);
  const existing = c.gstin
    ? await tx.get<{ id: string }>('SELECT id FROM customers WHERE gstin = ?', [c.gstin])
    : await tx.get<{ id: string }>('SELECT id FROM customers WHERE gstin IS NULL AND name = ? COLLATE NOCASE', [c.name]);
  if (existing) return { id: existing.id, created: false };
  const id = newId();
  const now = nowIso();
  await tx.run('INSERT INTO customers (id, name, gstin, phone, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, c.name, c.gstin, c.phone, c.address, now, now,
  ]);
  return { id, created: true };
}
