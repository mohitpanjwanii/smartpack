/**
 * Migration 001: the full SmartPack database.
 *
 * Design notes
 * - Every id is a UUID text so records made on different phones never clash
 *   when they are synced later.
 * - Times are ISO-8601 text in UTC.
 * - Rules that must never be broken (one barcode = one physical item, never
 *   counted twice; reasons for manual changes; an untouchable audit trail)
 *   are enforced by the database itself, not only by the screens.
 */
export const migration001 = {
  version: 1,
  name: 'init',
  sql: /* sql */ `
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  role        TEXT NOT NULL CHECK (role IN ('packer', 'supervisor', 'admin')),
  pin_hash    TEXT NOT NULL,
  pin_salt    TEXT NOT NULL,
  language    TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'te')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  sku         TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(sku)) > 0),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  unit        TEXT NOT NULL DEFAULT 'pcs' CHECK (length(trim(unit)) > 0),
  pack_size   REAL CHECK (pack_size IS NULL OR pack_size > 0),
  hsn_code    TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ix_products_name ON products (name);

CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  gstin       TEXT UNIQUE,
  phone       TEXT,
  address     TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ix_customers_name ON customers (name);

CREATE TABLE orders (
  id                  TEXT PRIMARY KEY,
  order_no            TEXT NOT NULL UNIQUE,
  customer_id         TEXT NOT NULL REFERENCES customers (id),
  invoice_no          TEXT,
  invoice_date        TEXT,
  source              TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'invoice')),
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'packing', 'packed', 'dispatched', 'cancelled')),
  checked_out_device  TEXT,
  checked_out_at      TEXT,
  notes               TEXT,
  created_by          TEXT REFERENCES users (id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (customer_id, invoice_no)
);
CREATE INDEX ix_orders_status ON orders (status);

CREATE TABLE order_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products (id),
  ordered_qty   INTEGER NOT NULL CHECK (ordered_qty > 0),
  unit          TEXT NOT NULL,
  source_text   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (order_id, product_id)
);

CREATE TABLE cartons (
  id               TEXT PRIMARY KEY,
  carton_no        TEXT NOT NULL UNIQUE,
  order_id         TEXT NOT NULL REFERENCES orders (id),
  seq              INTEGER NOT NULL CHECK (seq > 0),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'reopened')),
  packed_by        TEXT REFERENCES users (id),
  verified_by      TEXT REFERENCES users (id),
  closure_status   TEXT CHECK (closure_status IS NULL OR closure_status IN ('verified', 'override')),
  override_reason  TEXT,
  opened_at        TEXT NOT NULL,
  closed_at        TEXT,
  updated_at       TEXT NOT NULL,
  UNIQUE (order_id, seq),
  CHECK (status <> 'closed' OR (closed_at IS NOT NULL AND closure_status IS NOT NULL)),
  CHECK (closure_status IS NOT 'override' OR length(trim(coalesce(override_reason, ''))) > 0)
);

CREATE TABLE product_barcodes (
  id             TEXT PRIMARY KEY,
  barcode        TEXT NOT NULL UNIQUE CHECK (length(barcode) > 0 AND barcode = trim(barcode)),
  product_id     TEXT NOT NULL REFERENCES products (id),
  serial_no      TEXT NOT NULL CHECK (length(trim(serial_no)) > 0),
  status         TEXT NOT NULL DEFAULT 'registered'
                 CHECK (status IN ('registered', 'packed', 'void', 'damaged')),
  order_id       TEXT REFERENCES orders (id),
  carton_id      TEXT REFERENCES cartons (id),
  registered_by  TEXT REFERENCES users (id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (product_id, serial_no),
  CHECK (status <> 'packed' OR (order_id IS NOT NULL AND carton_id IS NOT NULL))
);
CREATE INDEX ix_barcodes_product ON product_barcodes (product_id, status);
CREATE INDEX ix_barcodes_order ON product_barcodes (order_id);

CREATE TABLE carton_items (
  carton_id    TEXT NOT NULL REFERENCES cartons (id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES products (id),
  scanned_qty  INTEGER NOT NULL DEFAULT 0 CHECK (scanned_qty >= 0),
  manual_qty   INTEGER NOT NULL DEFAULT 0 CHECK (manual_qty >= 0),
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (carton_id, product_id)
);

CREATE TABLE packing_events (
  id                    TEXT PRIMARY KEY,
  event_type            TEXT NOT NULL CHECK (event_type IN (
                          'scan', 'scan_reversed', 'manual_add', 'manual_remove',
                          'override', 'carton_open', 'carton_close', 'carton_reopen')),
  order_id              TEXT NOT NULL REFERENCES orders (id),
  carton_id             TEXT REFERENCES cartons (id),
  product_id            TEXT REFERENCES products (id),
  barcode_id            TEXT REFERENCES product_barcodes (id),
  qty                   INTEGER NOT NULL DEFAULT 1,
  reason                TEXT,
  user_id               TEXT NOT NULL REFERENCES users (id),
  device_id             TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  reversed_by_event_id  TEXT REFERENCES packing_events (id),
  CHECK (event_type <> 'scan'
         OR (barcode_id IS NOT NULL AND product_id IS NOT NULL AND carton_id IS NOT NULL AND qty = 1)),
  CHECK (event_type NOT IN ('manual_add', 'manual_remove')
         OR (product_id IS NOT NULL AND carton_id IS NOT NULL AND qty > 0)),
  CHECK (event_type NOT IN ('manual_add', 'manual_remove', 'override', 'scan_reversed', 'carton_reopen')
         OR length(trim(coalesce(reason, ''))) > 0)
);
-- The heart of the system: a physical barcode can have only one active scan, ever.
CREATE UNIQUE INDEX ux_one_active_scan_per_barcode
  ON packing_events (barcode_id)
  WHERE event_type = 'scan' AND reversed_by_event_id IS NULL;
CREATE INDEX ix_events_order ON packing_events (order_id, created_at);
CREATE INDEX ix_events_carton ON packing_events (carton_id);

-- A scanned barcode must really belong to the product recorded.
CREATE TRIGGER trg_scan_product_matches_barcode
BEFORE INSERT ON packing_events
WHEN NEW.event_type = 'scan'
 AND NEW.product_id IS NOT (SELECT product_id FROM product_barcodes WHERE id = NEW.barcode_id)
BEGIN
  SELECT RAISE(ABORT, 'SMARTPACK_RULE: Scanned barcode does not belong to this product');
END;

-- Units can only go into an open carton of the same order.
CREATE TRIGGER trg_event_carton_open_and_same_order
BEFORE INSERT ON packing_events
WHEN NEW.event_type IN ('scan', 'manual_add', 'manual_remove')
 AND NOT EXISTS (SELECT 1 FROM cartons c
                 WHERE c.id = NEW.carton_id AND c.order_id = NEW.order_id
                   AND c.status IN ('open', 'reopened'))
BEGIN
  SELECT RAISE(ABORT, 'SMARTPACK_RULE: Carton is not open for this order');
END;

-- Packing events are a permanent record. The only change allowed is marking
-- a scan as reversed (once), and they can never be deleted.
CREATE TRIGGER trg_packing_events_no_edit
BEFORE UPDATE ON packing_events
WHEN OLD.reversed_by_event_id IS NOT NULL
  OR NEW.reversed_by_event_id IS NULL
  OR NEW.id IS NOT OLD.id OR NEW.event_type IS NOT OLD.event_type
  OR NEW.order_id IS NOT OLD.order_id OR NEW.carton_id IS NOT OLD.carton_id
  OR NEW.product_id IS NOT OLD.product_id OR NEW.barcode_id IS NOT OLD.barcode_id
  OR NEW.qty IS NOT OLD.qty OR NEW.reason IS NOT OLD.reason
  OR NEW.user_id IS NOT OLD.user_id OR NEW.device_id IS NOT OLD.device_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'SMARTPACK_RULE: Packing events cannot be edited');
END;

CREATE TRIGGER trg_packing_events_no_delete
BEFORE DELETE ON packing_events
BEGIN
  SELECT RAISE(ABORT, 'SMARTPACK_RULE: Packing events cannot be deleted');
END;

CREATE TABLE invoice_files (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT REFERENCES orders (id) ON DELETE SET NULL,
  file_path          TEXT NOT NULL,
  mime_type          TEXT,
  source             TEXT NOT NULL CHECK (source IN ('camera', 'upload')),
  extraction_method  TEXT CHECK (extraction_method IS NULL OR extraction_method IN ('ai', 'ocr', 'manual')),
  raw_result         TEXT,
  uploaded_by        TEXT REFERENCES users (id),
  created_at         TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users (id),
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  before_json  TEXT,
  after_json   TEXT,
  device_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_audit_entity ON audit_logs (entity, entity_id);

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'SMARTPACK_RULE: Audit log cannot be edited'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'SMARTPACK_RULE: Audit log cannot be deleted'); END;

CREATE TABLE sync_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
  payload     TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  synced_at   TEXT
);
CREATE INDEX ix_sync_pending ON sync_queue (synced_at, id);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`,
};
