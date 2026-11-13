# Stage 1: project setup and database (2026-11-13)

## Delivered

- React 19 + TypeScript 5.9 app built with Vite 8, wrapped by Capacitor 8.
  Android (`android/`) and iOS (`ios/`) native projects generated.
  App id `in.smpbakers.smartpack`.
- Database layer (`src/db/`)
  - One `Db` interface used by every screen; transactions queue so they never interleave.
  - Native SQLite on phones via `@capacitor-community/sqlite`.
  - sql.js (SQLite in WebAssembly) for the browser preview (saved in IndexedDB) and for tests.
  - Migration runner with `schema_migrations`; migration 001 creates all 14 tables.
- Rules enforced by the database itself (migration 001)
  - Barcode unique across the whole system; no blank or space-padded barcodes.
  - Serial number unique per product; SKU unique ignoring letter case.
  - One active scan per physical barcode, ever (partial unique index). A rescan is
    only possible after a recorded reversal with a reason.
  - A scan must match the barcode's product, and go into an open carton of the same order.
  - Manual adjustments, reversals, reopenings and overrides require a reason.
  - Scanned and manual quantities stored separately, never negative.
  - A barcode marked packed must have an order and carton.
  - Packing events and audit log are permanent: cannot be edited or deleted
    (the only allowed change is marking a scan as reversed, once).
- First-run setup (business name + admin with PIN), user picker and PIN-pad login.
  PINs stored as salted PBKDF2-SHA256 hashes; every login attempt is audited.
- Each phone gets a permanent device id, stamped on events for traceability.
- High-contrast, large-button design; home screen shows modules and the stage each arrives in.

## Tested

- `npm test`: 29 automated tests pass (schema rules, transactions, PIN security, login).
- Type-check and production build pass.
- Browser walk-through at phone size (Pixel 7): setup, sign out, reload,
  wrong PIN rejected, correct PIN accepted, data kept after reload. No console errors.

## Not yet verified

- The native SQLite driver (`src/db/capacitorDriver.ts`) is written but can only be
  tested on a real phone build, planned for Stage 4.

## Next: Stage 2

Product master (add/edit, Excel/CSV import) and unique barcode registration
(scan to register, or import a list of existing barcodes).
