import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { createFirstAdmin, createUser } from '../src/db/repositories/users';
import { listProducts, setProductActive } from '../src/db/repositories/products';
import { applyProductImport, planProductImport } from '../src/domain/productImport';
import { parseCsv } from '../src/domain/spreadsheet';
import { normalizeBarcode } from '../src/domain/barcode';
import { registerBarcode, lookupBarcode, changeBarcodeStatus, BarcodeError, listBarcodesForProduct } from '../src/db/repositories/barcodes';
import { applyBarcodeImport, planBarcodeImport } from '../src/domain/barcodeImport';
import { can } from '../src/domain/permissions';

const csv = readFileSync(new URL('./fixtures/perfect-veg-products.csv', import.meta.url), 'utf8');

async function setup() {
  const db = await freshDb();
  const admin = await createFirstAdmin(db, { name: 'Mohit', pin: '2468', businessName: 'SMP Bakers' });
  await applyProductImport(db, planProductImport(parseCsv(csv), []), admin.id, 'products.csv');
  const products = await listProducts(db);
  const bySku = (s: string) => products.find((p) => p.sku === s)!;
  return { db, admin, jam: bySku('PV-CK-01'), rusk: bySku('PV-SN-05') };
}

describe('cleaning scanned values', () => {
  it('removes Enter, Tab and invisible characters a scanner adds, keeps letter case', () => {
    expect(normalizeBarcode('  PV0001aB\r\n')).toBe('PV0001aB');
    expect(normalizeBarcode('\tX\u001d1')).toBe('X1');
  });
});

describe('registering unique packet barcodes', () => {
  it('registers a barcode and uses it as the serial number', async () => {
    const { db, admin, jam } = await setup();
    const info = await registerBarcode(db, { barcode: ' 8901000000011\n', productId: jam.id }, admin.id);
    expect(info).toMatchObject({ barcode: '8901000000011', serial_no: '8901000000011', status: 'registered', product_name: 'Fruit Jam Cookies 250g' });
    expect((await listProducts(db)).find((p) => p.id === jam.id)!.registered).toBe(1);
  });

  it('refuses the same packet twice and names the product it already belongs to', async () => {
    const { db, admin, jam, rusk } = await setup();
    await registerBarcode(db, { barcode: 'PKT-1', productId: jam.id }, admin.id);
    const err = await registerBarcode(db, { barcode: 'PKT-1', productId: rusk.id }, admin.id).catch((e) => e);
    expect(err).toBeInstanceOf(BarcodeError);
    expect(err.message).toContain('Fruit Jam Cookies 250g');
    expect(err.existing.product_id).toBe(jam.id);
  });

  it('two phones/screens registering the same code at once: only one wins', async () => {
    const { db, admin, jam, rusk } = await setup();
    const results = await Promise.allSettled([
      registerBarcode(db, { barcode: 'RACE-1', productId: jam.id }, admin.id),
      registerBarcode(db, { barcode: 'RACE-1', productId: rusk.id }, admin.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('refuses blank codes and switched-off products', async () => {
    const { db, admin, jam } = await setup();
    await expect(registerBarcode(db, { barcode: '  \n', productId: jam.id }, admin.id)).rejects.toThrow(/empty/);
    await setProductActive(db, jam.id, false, admin.id);
    await expect(registerBarcode(db, { barcode: 'X9', productId: jam.id }, admin.id)).rejects.toThrow(/switched off/);
  });

  it('looks up a barcode and lists a product barcodes newest first', async () => {
    const { db, admin, jam } = await setup();
    await registerBarcode(db, { barcode: 'A1', productId: jam.id }, admin.id);
    await new Promise((r) => setTimeout(r, 5));
    await registerBarcode(db, { barcode: 'A2', productId: jam.id }, admin.id);
    expect((await lookupBarcode(db, 'A1\r'))?.sku).toBe('PV-CK-01');
    expect(await lookupBarcode(db, 'nope')).toBeUndefined();
    expect((await listBarcodesForProduct(db, jam.id)).map((b) => b.barcode)).toEqual(['A2', 'A1']);
  });
});

describe('void and damaged packets', () => {
  it('needs a reason, is audited, and can be restored', async () => {
    const { db, admin, jam } = await setup();
    const b = await registerBarcode(db, { barcode: 'D1', productId: jam.id }, admin.id);
    await expect(changeBarcodeStatus(db, b.id, 'damaged', ' ', admin.id)).rejects.toThrow(/reason/);
    await changeBarcodeStatus(db, b.id, 'damaged', 'Packet torn', admin.id);
    expect((await lookupBarcode(db, 'D1'))?.status).toBe('damaged');
    await changeBarcodeStatus(db, b.id, 'registered', 'Repacked', admin.id);
    const log = await db.all<{ action: string; after_json: string }>("SELECT action, after_json FROM audit_logs WHERE entity_id = ? ORDER BY rowid", [b.id]);
    expect(log.map((l) => l.action)).toEqual(['barcode.register', 'barcode.status_damaged', 'barcode.status_registered']);
    expect(log[1].after_json).toContain('Packet torn');
  });

  it('packers cannot change status; supervisors can', async () => {
    const { db, admin } = await setup();
    const packer = await createUser(db, { name: 'Ravi', role: 'packer', pin: '1357' }, admin.id);
    expect(can(packer.role, 'barcodes.register')).toBe(true);
    expect(can(packer.role, 'barcodes.changeStatus')).toBe(false);
    expect(can('supervisor', 'barcodes.changeStatus')).toBe(true);
  });
});

describe('importing a barcode list', () => {
  it('previews, skips already-registered, flags conflicts, then saves', async () => {
    const { db, admin, jam } = await setup();
    await registerBarcode(db, { barcode: 'OLD-1', productId: jam.id }, admin.id);
    const file = [
      'Barcode,Item Code,Serial No',
      'NEW-1,PV-CK-01,S1',
      'NEW-2,PV-SN-05,',
      'OLD-1,PV-CK-01,',
      'OLD-1,PV-SN-05,',
      'NEW-1,PV-CK-02,',
      'NEW-3,NO-SUCH,',
      ',PV-CK-01,',
    ].join('\n');
    const plan = await planBarcodeImport(db, parseCsv(file));
    expect(plan.counts).toEqual({ new: 2, already: 1, error: 4 });
    const errors = plan.rows.filter((r) => r.action === 'error').map((r) => r.error);
    expect(errors.some((e) => /different product/.test(e!))).toBe(true);
    expect(errors.some((e) => /repeated/.test(e!))).toBe(true);
    expect(errors.some((e) => /No product/.test(e!))).toBe(true);
    expect(await applyBarcodeImport(db, plan, admin.id, 'codes.csv')).toBe(2);
    expect((await lookupBarcode(db, 'NEW-1'))?.serial_no).toBe('S1');
    expect((await lookupBarcode(db, 'NEW-2'))?.serial_no).toBe('NEW-2');
  });

  it('flags long numbers that Excel may have rounded', async () => {
    const { db } = await setup();
    const plan = await planBarcodeImport(db, parseCsv('Barcode,Item Code\n12345678901234567890,PV-CK-01'), [2]);
    expect(plan.rows[0].error).toMatch(/rounded/);
  });

  it('matches by product name when there is no item code column', async () => {
    const { db } = await setup();
    const plan = await planBarcodeImport(db, parseCsv('Barcode,Product Name\nZ1,Kaju Cake Rusk 200g'));
    expect(plan.counts.new).toBe(1);
  });
});
