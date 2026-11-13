# Stage 2: product master and unique barcode registration (2026-11-13)

Decision recorded: every packet carries its own unique barcode (Mohit, 2026-11-13).

## Delivered

- Navigation between screens; Android back button supported.
- Roles: packers register and check barcodes; supervisors/admins edit products,
  import files and mark packets void/damaged.
- **Products**: list with search (name or code), switched-off filter, add, edit,
  switch off / on (products are never deleted because orders refer to them). Every change audited.
- **Product import** from Excel (.xlsx) or CSV: finds the heading row even under
  title rows, recognises common headings (Item Code, Product Name, UOM, Pack Size, HSN...),
  shows New / Will change / No change / Problems before saving, saves all in one transaction.
  Files with no code column get codes P0001, P0002... Old .xls files are refused with instructions.
- **Perfect Veg product list**: 34 products from the October menu PDF
  (`tests/fixtures/perfect-veg-products.csv`, codes PV-CK-xx cookies, PV-CA-xx cakes, PV-SN-xx snacks).
- **Register packets**: choose a product, then scan packets one after another (camera,
  USB/Bluetooth barcode gun, or typing). Each packet is saved instantly; a barcode already in
  the system is refused with the product it belongs to. Scanner extras (Enter, Tab, invisible
  characters) are stripped. Serial number defaults to the barcode.
- **Import barcode list** (Barcode + Item Code or Product Name, optional Serial No): preview,
  conflicts with other products flagged, repeats in the file flagged, long numbers Excel may
  have rounded flagged.
- **Check a barcode**: product, status, serial, registration time, order/carton once packed.
  Supervisors can mark damaged or void, or restore, with a required reason (audited).
  Packed packets cannot be changed here.
- Camera scanning service (Google ML Kit) and camera permission text for Android and iPhone.

## Tested

- 53 automated tests pass, including the real 34-product list in CSV and Excel form,
  duplicate and simultaneous barcode registration, import conflicts, status changes and permissions.
- Browser walk-through at phone size: import 34 products, register 3 packets, duplicate refused,
  import a barcode list, check a barcode, mark damaged with reason. No console errors.

## Not yet verified

- Camera scanning needs a real phone (Stage 4).

## Next: Stage 3

Customer orders and invoice processing (photo/upload, AI extraction with offline fallback,
editable review screen). Needs: 5 to 10 sample invoice photos, and the backend decision (Supabase).
