import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { freshDb } from './helpers';
import { createFirstAdmin } from '../src/db/repositories/users';
import { createProduct, listProducts, updateProduct, setProductActive, ProductError } from '../src/db/repositories/products';
import { applyProductImport, planProductImport, ImportError } from '../src/domain/productImport';
import { parseCsv, cellToText } from '../src/domain/spreadsheet';

const realCsv = readFileSync(new URL('./fixtures/perfect-veg-products.csv', import.meta.url), 'utf8');

async function setup() {
  const db = await freshDb();
  const admin = await createFirstAdmin(db, { name: 'Mohit', pin: '2468', businessName: 'SMP Bakers' });
  return { db, admin };
}

describe('CSV and cell parsing', () => {
  it('handles quotes, commas inside quotes and blank lines', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n\n1,2\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  });
  it('detects semicolon and tab separated files', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('prints long Excel numbers without exponent or decimals', () => {
    expect(cellToText(8901234567890)).toBe('8901234567890');
    expect(cellToText(250)).toBe('250');
    expect(cellToText(null)).toBe('');
  });
});

describe('product import from the Perfect Veg list', () => {
  it('previews 34 new products and saves them all', async () => {
    const { db, admin } = await setup();
    const plan = planProductImport(parseCsv(realCsv), []);
    expect(plan.counts).toEqual({ new: 34, update: 0, unchanged: 0, error: 0 });
    expect(await listProducts(db)).toHaveLength(0); // preview saves nothing
    await applyProductImport(db, plan, admin.id, 'perfect-veg.csv');
    const products = await listProducts(db);
    expect(products).toHaveLength(34);
    const jam = products.find((p) => p.sku === 'PV-CK-01')!;
    expect(jam).toMatchObject({ name: 'Fruit Jam Cookies 250g', unit: 'pkt', pack_size: 250 });
  });

  it('a second import of the same file changes nothing', async () => {
    const { db, admin } = await setup();
    await applyProductImport(db, planProductImport(parseCsv(realCsv), []), admin.id, 'a.csv');
    const again = planProductImport(parseCsv(realCsv), await listProducts(db));
    expect(again.counts).toEqual({ new: 0, update: 0, unchanged: 34, error: 0 });
  });

  it('shows renamed products as updates with the change spelled out', async () => {
    const { db, admin } = await setup();
    await applyProductImport(db, planProductImport(parseCsv(realCsv), []), admin.id, 'a.csv');
    const edited = realCsv.replace('PV-CK-01,Fruit Jam Cookies 250g', 'PV-CK-01,Fruit Jam Cookies 250 g');
    const plan = planProductImport(parseCsv(edited), await listProducts(db));
    expect(plan.counts.update).toBe(1);
    expect(plan.rows.find((r) => r.action === 'update')!.changes![0]).toContain('Fruit Jam Cookies 250 g');
  });

  it('finds the heading row below title rows and reports bad rows without saving them', async () => {
    const csv = 'SMP Bakers stock list\n\nItem Code,Product Name,UOM,Pack Size\nA1,Rusk,pkt,200\n,No code,pkt,1\nA1,Duplicate,pkt,1\nA2,Bad pack,pkt,abc\n';
    const plan = planProductImport(parseCsv(csv), []);
    expect(plan.counts).toEqual({ new: 1, update: 0, unchanged: 0, error: 3 });
    expect(plan.rows.filter((r) => r.action === 'error').map((r) => r.rowNo)).toEqual([4, 5, 6]);
  });

  it('generates codes when the file has no code column', async () => {
    const plan = planProductImport(parseCsv('Product Name,Unit\nPlum Cake,pkt\nTea Rusk,pkt\n'), []);
    expect(plan.generatedSkus).toBe(true);
    expect(plan.rows.map((r) => r.input!.sku)).toEqual(['P0001', 'P0002']);
  });

  it('explains when no product name column exists', () => {
    expect(() => planProductImport(parseCsv('foo,bar\n1,2'), [])).toThrow(ImportError);
  });
});

describe('product editing', () => {
  it('creates, edits and switches off products, refusing duplicate codes', async () => {
    const { db, admin } = await setup();
    const p = await createProduct(db, { sku: 'X1', name: ' Plum   Cake ', unit: 'PKT', pack_size: 500, hsn_code: null }, admin.id);
    expect(p.name).toBe('Plum Cake');
    expect(p.unit).toBe('pkt');
    await expect(createProduct(db, { sku: 'x1', name: 'Other', unit: 'pkt', pack_size: null, hsn_code: null }, admin.id)).rejects.toThrow(/already used/);
    await expect(createProduct(db, { sku: 'X2', name: '', unit: 'pkt', pack_size: null, hsn_code: null }, admin.id)).rejects.toBeInstanceOf(ProductError);
    await updateProduct(db, p.id, { sku: 'X1', name: 'Plum Cake 500g', unit: 'pkt', pack_size: 500, hsn_code: '1905' }, admin.id);
    await setProductActive(db, p.id, false, admin.id);
    expect(await listProducts(db)).toHaveLength(0);
    expect((await listProducts(db, { includeInactive: true }))[0].name).toBe('Plum Cake 500g');
    const audit = await db.all<{ action: string }>("SELECT action FROM audit_logs WHERE entity = 'products' ORDER BY rowid");
    expect(audit.map((a) => a.action)).toEqual(['product.create', 'product.update', 'product.deactivate']);
  });

  it('searches by name or code', async () => {
    const { db, admin } = await setup();
    await applyProductImport(db, planProductImport(parseCsv(realCsv), []), admin.id, 'a.csv');
    expect((await listProducts(db, { search: 'khari' })).length).toBe(4);
    expect((await listProducts(db, { search: 'PV-CA' })).length).toBe(10);
  });
});

describe('Excel import', () => {
  it('reads an .xlsx file with title rows above the headings', async () => {
    const { readSpreadsheet } = await import('../src/domain/spreadsheet');
    const bytes = readFileSync(new URL('./fixtures/perfect-veg-products.xlsx', import.meta.url));
    const { rows } = await readSpreadsheet(new Blob([bytes]), 'perfect-veg-products.xlsx');
    const plan = planProductImport(rows, []);
    expect(plan.counts.new).toBe(34);
    expect(plan.rows[0].input).toMatchObject({ sku: 'PV-CK-01', pack_size: 250 });
  });

  it('refuses old .xls files with a clear instruction', async () => {
    const { readSpreadsheet } = await import('../src/domain/spreadsheet');
    await expect(readSpreadsheet(new Blob(['x']), 'old.xls')).rejects.toThrow(/Save As/);
  });
});
