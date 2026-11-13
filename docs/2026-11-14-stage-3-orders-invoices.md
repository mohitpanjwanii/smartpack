# Stage 3: customer orders and invoice reading (2026-11-14)

Decision recorded: invoice reading must be free (Mohit, 2026-11-14). It runs fully on the
phone with open-source Tesseract text recognition; no AI service, no internet, no cost.
Supabase is not needed until Stage 8 (sync).

## Delivered

- **Order from invoice**: take a photo (phone camera) or choose a photo/PDF. The invoice is read on the
  phone in up to three passes (two layout modes, then finer detail); passes are merged line by line.
- **Tally invoice reader** (`src/domain/invoiceParser.ts`): invoice no., date, buyer name and address,
  buyer GSTIN, and every item line (description, HSN, quantity, unit, rate, actual rate, amount).
- **Cross-checks that flag problems instead of guessing**:
  - quantity × actual rate must equal the line amount (suggests the likely quantity when it does not);
  - serial numbers must run 1..N (missing lines are named);
  - quantities per unit must equal the invoice's "Total Unit" line;
  - buyer GSTIN must pass its check character.
- **Product matching** (`src/domain/productMatch.ts`): remembered names (aliases, migration 002) and
  exact names are matched; close names are only *suggested*; names fitting several products
  (e.g. 6-piece and 12-piece cup cakes) must be chosen by a person; weak matches are not suggested.
  Confirmed wordings are remembered for the next invoice.
- **Review screen**: everything editable; uncertain lines highlighted and must be ticked
  "Right product and quantity"; warnings must be acknowledged; the order cannot be created until
  every blocker is resolved. The raw text read is viewable.
- **Customers**: found by GSTIN (so OCR spelling slips do not create duplicates), or created.
  Manual orders suggest existing customers by name.
- **Orders**: invoice orders use the invoice number as the order number; manual orders are numbered
  M-YYMMDD-001. Same invoice cannot be entered twice. Order list (To pack / Finished / All, search),
  order details, invoice photo kept on the phone and viewable, edit lines and cancel (with reason)
  before packing starts. Supervisors/admins edit and cancel; everyone can create.
- Database migration 002: `product_aliases`.

## Tested

- 77 automated tests pass, including all three real invoices (1546 Milk Corner, 1125 Ratnadeep,
  1113 Harsha Enterprises): 19 of 19 lines, invoice numbers, dates and GSTINs read correctly;
  a deliberately poor reading is flagged (missing lines, unit-total mismatch, bad GSTIN).
- In the app (browser, phone size): invoice 1546 PDF read in about 14 s with all 13 lines; order created;
  invoice 1125 image read in about 8 s with "Special Kaju Cookies" matched automatically from the
  earlier confirmation, and "Vanilla Cup Cake" correctly held for a person to choose 6 or 12 pieces.

## Known limits

- Phone photos (angle, shadow, crumpled paper) will read less cleanly than PDFs; the cross-checks will
  flag what is missed. To be measured on a real phone in Stage 4.
- Product names on invoices are Tally stock item names; several differ from the menu list
  (e.g. "Milky Bliss Cake" has no product). Importing the Tally stock item list is recommended.
- App size grows by about 15 MB for the offline reading engine.

## Next: Stage 4

Barcode scanning and packing verification, and the first build on a real Android phone.
