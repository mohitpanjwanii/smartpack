/**
 * Migration 002: remembered product names.
 * When staff confirm that an invoice line such as "Special Kaju Cookies"
 * is the product "Kaju Cookies 250g", the normalised invoice text is saved
 * here, so the next invoice with that wording is matched automatically.
 */
export const migration002 = {
  version: 2,
  name: 'product_aliases',
  sql: /* sql */ `
CREATE TABLE product_aliases (
  alias        TEXT PRIMARY KEY CHECK (length(alias) > 0),
  product_id   TEXT NOT NULL REFERENCES products (id),
  created_by   TEXT REFERENCES users (id),
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_aliases_product ON product_aliases (product_id);
`,
};
