# SmartPack

Packing and carton verification app for SMP Bakers. Factory staff scan the
unique barcode on every product to verify customer orders carton by carton.
Works fully offline on Android and iPhone.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Run the app in a desktop browser (preview database) |
| `npm test` | Run the automated tests |
| `npm run build` | Type-check and build the web bundle into `dist/` |
| `npx cap sync` | Copy the build into the Android and iOS projects |
| `npx cap open android` | Open in Android Studio (on a Mac or PC) |
| `npx cap open ios` | Open in Xcode (Mac only) |

## Layout

- `src/db/` database layer: drivers, migrations, repositories
- `src/domain/` business rules with no screens
- `src/app/` app shell and screens; `src/modules/` feature screens (from Stage 2)
- `src/ui/` shared design
- `tests/` automated tests, run against the real schema with sql.js
- `docs/` dated notes for each stage

See `docs/` for what each stage delivered.
