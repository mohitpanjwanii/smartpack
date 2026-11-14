import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTallyInvoice } from '../src/domain/invoiceParser';
import { parseCsv } from '../src/domain/spreadsheet';
import { matchProduct, normalizeName } from '../src/domain/productMatch';
import { KNOWN_INVOICE_NAMES, withKnownInvoiceNames } from '../src/domain/invoiceNameMap';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const products = parseCsv(fx('perfect-veg-products.csv'))
  .slice(1)
  .map((r) => ({ id: `id-${r[0]}`, sku: r[0], name: r[1] }));
const nameOf = (id: string | null) => products.find((p) => p.id === id)?.name ?? null;

describe('built-in invoice names', () => {
  it('every item code exists on the product list', () => {
    for (const [, code] of KNOWN_INVOICE_NAMES) expect(products.some((p) => p.sku === code)).toBe(true);
  });

  it('maps every line of the 3 real invoices except the two that need a person', () => {
    const aliases = withKnownInvoiceNames(new Map(), products);
    const result: Record<string, string | null> = {};
    for (const f of ['invoice-1113.ocr.txt', 'invoice-1125.ocr.txt', 'invoice-1546.ocr.txt']) {
      for (const l of parseTallyInvoice(fx(`invoices/${f}`)).lines) {
        const m = matchProduct(l.description, products, aliases);
        result[normalizeName(l.description)] = m.kind === 'alias' || m.kind === 'exact' ? nameOf(m.productId) : m.kind;
      }
    }
    expect(result).toEqual({
      'atta gud ghee cookies': 'Atta Gud Ghee Cookies 250g',
      'butter choco cookies': 'Butter Choco Cookies 250g',
      'fruit jam cookies': 'Fruit Jam Cookies 250g',
      'jeera cookies': 'Jeera Cookies 250g',
      'special badam cookies': 'Badam Cookies 250g',
      'special kaju cookies': 'Kaju Cookies 250g',
      'chocolate bar cake': 'Choco Bar Cake 250g',
      'vanilla bar cake': 'Vanilla Bar Cake 250g',
      'marble cake': 'Marble Cake 250g',
      'red velvet marble cake': 'Red Velvet Marble Cake 250g',
      'dry fruit cake': 'Dry Fruit Cake 250g',
      'brownie cake': 'Choco Brownie 150g',
      'mawa toast': 'Mawa Toast 200g',
      'vanilla cup cake': 'ambiguous',
      'milky bliss cake': 'none',
    });
  });

  it("staff's own confirmed match wins over the built-in list", () => {
    const own = new Map([[normalizeName('Brownie Cake'), 'id-PV-CA-02']]);
    expect(withKnownInvoiceNames(own, products).get('brownie cake')).toBe('id-PV-CA-02');
  });

  it('skips names whose product is not loaded', () => {
    expect(withKnownInvoiceNames(new Map(), []).size).toBe(0);
  });
});
