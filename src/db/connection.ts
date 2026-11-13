import { Capacitor } from '@capacitor/core';
import { createLockedDb } from './lockedDb';
import { migrate } from './migrate';
import type { Db } from './types';

let dbPromise: Promise<Db> | null = null;

/** Where the data lives on this device, shown on the About screen. */
export function storageDescription(): string {
  return Capacitor.isNativePlatform()
    ? `Native SQLite on this ${Capacitor.getPlatform() === 'ios' ? 'iPhone' : 'Android phone'}`
    : 'Browser preview database (for testing only)';
}

async function openDb(): Promise<Db> {
  let db: Db;
  if (Capacitor.isNativePlatform()) {
    const { createCapacitorDriver } = await import('./capacitorDriver');
    db = createLockedDb(await createCapacitorDriver());
  } else {
    const [{ default: initSqlJs }, { default: wasmUrl }, store, { createSqlJsDriver }] = await Promise.all([
      import('sql.js'),
      import('sql.js/dist/sql-wasm.wasm?url'),
      import('./browserStore'),
      import('./sqljsDriver'),
    ]);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const { driver } = createSqlJsDriver(SQL, await store.loadBytes(), store.saveBytes);
    db = createLockedDb(driver);
  }
  await migrate(db);
  return db;
}

/** The single shared database for the app, opened and upgraded on first use. */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = openDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}
