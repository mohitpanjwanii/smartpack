import { normalizeName, type MatchCandidate } from './productMatch';

/**
 * How SMP Bakers' Tally invoices name each product, mapped to the item code
 * on the Perfect Veg menu (Oct 2026 product list). Built from invoices
 * SMP/25-26/1113, SMP/25-26/1125 and SMP/26-27/1546, and checked against menu
 * prices: e.g. "Brownie Cake" is billed at Rs 115, the MRP of Choco Brownie 150g.
 *
 * Deliberately left out (staff must choose on the review screen):
 *  - "Vanilla Cup Cake": the menu has a 6-piece and a 12-piece pack.
 *  - "Milky Bliss Cake": not on the menu yet.
 */
export const KNOWN_INVOICE_NAMES: ReadonlyArray<readonly [invoiceName: string, itemCode: string]> = [
  ['Atta Gud Ghee Cookies -250G', 'PV-CK-07'],
  ['Butter Choco Cookies -250G', 'PV-CK-03'],
  ['Fruit Jam Cookies', 'PV-CK-01'],
  ['Jeera Cookies', 'PV-CK-12'],
  ['Special Badam Cookies', 'PV-CK-14'],
  ['Special Kaju Cookies', 'PV-CK-06'],
  ['Chocolate Bar Cake', 'PV-CA-03'],
  ['Vanilla Bar Cake', 'PV-CA-01'],
  ['Marble Cake', 'PV-CA-02'],
  ['Red Velvet Marble Cake', 'PV-CA-04'],
  ['Dry Fruit Cake', 'PV-CA-06'],
  ['Brownie Cake', 'PV-CA-05'],
  ['Mawa Toast', 'PV-SN-03'],
];

/**
 * Adds the built-in invoice names to the remembered names. A name staff
 * have confirmed themselves always wins over the built-in list, and an
 * entry is skipped when its item code is not in the product list.
 */
export function withKnownInvoiceNames(aliases: Map<string, string>, products: MatchCandidate[]): Map<string, string> {
  const bySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p.id]));
  const merged = new Map(aliases);
  for (const [name, code] of KNOWN_INVOICE_NAMES) {
    const key = normalizeName(name);
    const id = bySku.get(code);
    if (id && !merged.has(key)) merged.set(key, id);
  }
  return merged;
}
