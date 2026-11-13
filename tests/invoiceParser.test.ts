import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTallyInvoice, parseItemLine } from '../src/domain/invoiceParser';
import { isValidGstin, gstinCheckChar } from '../src/domain/gstin';
import { matchProduct, normalizeName, similarity } from '../src/domain/productMatch';

const fx = (n: string) => readFileSync(new URL(`./fixtures/invoices/${n}`, import.meta.url), 'utf8');

describe('GSTIN check digit', () => {
  it('accepts real GSTINs and rejects single-character misreads', () => {
    for (const g of ['36AGIPP2654D1ZF', '27AAKPY6539N1ZM', '36AABCR8939B1ZB', '36BCLPB0667C1ZY']) expect(isValidGstin(g)).toBe(true);
    expect(isValidGstin('27TAAKPY6539N1ZM')).toBe(false);
    expect(isValidGstin('27AAKPY6539N1ZN')).toBe(false);
    expect(gstinCheckChar('27AAKPY6539N1Z')).toBe('M');
  });
});

describe('Milk Corner invoice SMP/26-27/1546', () => {
  const inv = parseTallyInvoice(fx('invoice-1546.ocr.txt'));
  it('reads the header', () => {
    expect(inv.invoiceNo).toBe('SMP/26-27/1546');
    expect(inv.invoiceDate).toBe('2026-11-07');
    expect(inv.buyerName).toBe('MILK CORNER');
    expect(inv.buyerGstin).toBe('27AAKPY6539N1ZM');
    expect(inv.buyerGstinValid).toBe(true);
  });
  it('reads all 13 lines with correct quantities and units', () => {
    expect(inv.lines.map((l) => [l.slNo, l.qty, l.unit])).toEqual([
      [1, 20, 'box'], [2, 10, 'box'], [3, 10, 'box'], [4, 10, 'box'], [5, 10, 'box'], [6, 45, 'box'], [7, 45, 'box'],
      [8, 40, 'box'], [9, 25, 'pack'], [10, 30, 'box'], [11, 20, 'pack'], [12, 10, 'box'], [13, 6, 'box'],
    ]);
    expect(inv.lines[0].description).toBe('ATTA GUD GHEE COOKIES -250G');
    expect(inv.lines[12].description).toBe('Milky Bliss Cake');
  });
  it('passes every cross-check', () => {
    expect(inv.totalUnits).toEqual({ box: 236, pack: 45 });
    expect(inv.issues).toEqual([]);
    expect(inv.lines.flatMap((l) => l.issues)).toEqual([]);
  });
});

describe('Ratnadeep invoice SMP/25-26/1125', () => {
  const inv = parseTallyInvoice(fx('invoice-1125.ocr.txt'));
  it('reads header, buyer and all 4 lines', () => {
    expect(inv.invoiceNo).toBe('SMP/25-26/1125');
    expect(inv.invoiceDate).toBe('2026-03-10');
    expect(inv.buyerName).toBe('Ratnadeep Retail Pvt Limited');
    expect(inv.buyerGstin).toBe('36AABCR8939B1ZB');
    expect(inv.lines.map((l) => [l.description, l.qty, l.unit])).toEqual([
      ['Fruit Jam Cookies', 164, 'box'], ['Jeera Cookies', 89, 'box'], ['Special Kaju Cookies', 105, 'box'], ['Vanilla Cup Cake', 505, 'pack'],
    ]);
    expect(inv.issues).toEqual([]);
  });
});

describe('Harsha Enterprises invoice SMP/25-26/1113', () => {
  const inv = parseTallyInvoice(fx('invoice-1113.ocr.txt'));
  it('reads lines and GSTIN even when the name is misread, and flags nothing else', () => {
    expect(inv.invoiceNo).toBe('SMP/25-26/1113');
    expect(inv.invoiceDate).toBe('2026-03-07');
    expect(inv.buyerGstin).toBe('36BCLPB0667C1ZY');
    expect(inv.buyerGstinValid).toBe(true);
    expect(inv.lines.map((l) => [l.qty, l.unit])).toEqual([[50, 'pack'], [50, 'box']]);
    expect(inv.issues).toEqual([]);
  });
});

describe('a poor read is never trusted silently', () => {
  it('reports missing lines, the unit total mismatch and the bad GSTIN', () => {
    const inv = parseTallyInvoice(fx('invoice-1546.noisy.ocr.txt'));
    expect(inv.lines.length).toBeLessThan(13);
    expect(inv.issues.some((i) => /could not be read/.test(i))).toBe(true);
    expect(inv.issues.some((i) => /Invoice total says/.test(i))).toBe(true);
  });

  it('flags a line whose quantity does not match its amount, and suggests the right number', () => {
    const l = parseItemLine('6| Chocolate Bar Cake   19059010   46 Box   155.000 | Box | 107.76   4,849.284')!;
    expect(l.issues[0]).toMatch(/looks like 45/);
  });

  it('flags a GSTIN that fails its check digit', () => {
    const text = fx('invoice-1546.ocr.txt').replace('27AAKPY6539N1ZM', '27AAKPY6539N1ZN');
    const inv = parseTallyInvoice(text);
    expect(inv.buyerGstinValid).toBe(false);
    expect(inv.issues.some((i) => /check digit/.test(i))).toBe(true);
  });

  it('reports when nothing could be read', () => {
    expect(parseTallyInvoice('blurry nonsense').issues.some((i) => /No item lines/.test(i))).toBe(true);
  });
});

describe('product matching', () => {
  const products = [
    { id: 'a', name: 'Atta Gud Ghee Cookies 250g', sku: 'PV-CK-07' },
    { id: 'b', name: 'Butter Choco Cookies 250g', sku: 'PV-CK-03' },
    { id: 'k', name: 'Kaju Cookies 250g', sku: 'PV-CK-06' },
    { id: 'c', name: 'Choco Bar Cake 250g', sku: 'PV-CA-03' },
  ];
  it('treats weight and punctuation differences as the same name', () => {
    expect(normalizeName('ATTA GUD GHEE COOKIES -250G')).toBe(normalizeName('Atta Gud Ghee Cookies 250g'));
    expect(matchProduct('ATTA GUD GHEE COOKIES -250G', products, new Map()).kind).toBe('exact');
  });
  it('only suggests a near match, never confirms it', () => {
    const r = matchProduct('Special Kaju Cookies', products, new Map());
    expect(r).toMatchObject({ kind: 'suggested', productId: 'k' });
    expect(matchProduct('Chocolate Bar Cake', products, new Map()).productId).toBe('c');
  });
  it('trusts a remembered alias', () => {
    const r = matchProduct('Special Kaju Cookies', products, new Map([[normalizeName('Special Kaju Cookies'), 'k']]));
    expect(r).toMatchObject({ kind: 'alias', productId: 'k' });
  });
  it('returns no match for unknown items', () => {
    expect(matchProduct('Milky Bliss Cake', products, new Map()).kind).toBe('none');
    expect(similarity('abc', 'xyz')).toBeLessThan(0.2);
  });
});

describe('merging two readings', () => {
  it('recovers lines that one reading missed', () => {
    const good = fx('invoice-1546.ocr.txt');
    const noisy = fx('invoice-1546.noisy.ocr.txt');
    const merged = parseTallyInvoice([noisy, good]);
    expect(merged.lines).toHaveLength(13);
    expect(merged.issues).toEqual([]);
    expect(merged.buyerGstin).toBe('27AAKPY6539N1ZM');
  });
});

describe('matching safety', () => {
  const products = [
    { id: 'v6', name: 'Vanilla Cup Cake 6 Pcs 125g', sku: 'PV-CA-07' },
    { id: 'v12', name: 'Vanilla Cup Cake 12 Pcs 250g', sku: 'PV-CA-08' },
    { id: 'm', name: 'Marble Cake 250g', sku: 'PV-CA-02' },
  ];
  it('never auto-picks between two packs with the same name', () => {
    const r = matchProduct('Vanilla Cup Cake', products, new Map());
    expect(r.kind).toBe('ambiguous');
    expect(r.productId).toBeNull();
    expect(r.alternatives.map((a) => a.id).sort()).toEqual(['v12', 'v6']);
  });
  it('does not suggest a different cake just because both are cakes', () => {
    expect(matchProduct('Milky Bliss Cake', products, new Map()).kind).toBe('none');
  });
});

describe('matching on the real product list', () => {
  it('suggests the bar cake, not the cup cake, for "Chocolate Bar Cake"', async () => {
    const { parseCsv } = await import('../src/domain/spreadsheet');
    const rows = parseCsv(readFileSync(new URL('./fixtures/perfect-veg-products.csv', import.meta.url), 'utf8')).slice(1);
    const products = rows.map((r) => ({ id: r[0], sku: r[0], name: r[1] }));
    expect(matchProduct('Chocolate Bar Cake', products, new Map()).productId).toBe('PV-CA-03');
    expect(matchProduct('Brownie Cake', products, new Map()).productId).toBe('PV-CA-05');
    expect(matchProduct('Special Badam Cookies', products, new Map()).productId).toBe('PV-CK-14');
    expect(matchProduct('Milky Bliss Cake', products, new Map()).kind).toBe('none');
  });
});
