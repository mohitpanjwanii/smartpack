import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { RawDriver, SqlValue } from './types';

const DB_NAME = 'smartpack';

/**
 * Driver for native SQLite on Android and iPhone via
 * @capacitor-community/sqlite. The plugin's own automatic transactions are
 * switched off (the `false` arguments) because SmartPack manages its own,
 * so that a scan and all its side effects are saved together.
 */
export async function createCapacitorDriver(): Promise<RawDriver> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await sqlite.checkConnectionsConsistency().catch(() => undefined);
  const existing = (await sqlite.isConnection(DB_NAME, false)).result;
  const conn: SQLiteDBConnection = existing
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  await conn.open();
  await conn.execute('PRAGMA foreign_keys = ON;', false);

  return {
    async exec(sql) {
      await conn.execute(sql, false);
    },
    async run(sql, params: SqlValue[]) {
      const res = await conn.run(sql, params, false);
      return { changes: res.changes?.changes ?? 0 };
    },
    async all(sql, params: SqlValue[]) {
      const res = await conn.query(sql, params);
      return (res.values ?? []) as Record<string, unknown>[];
    },
    async begin() {
      await conn.execute('BEGIN IMMEDIATE TRANSACTION;', false);
    },
    async commit() {
      await conn.execute('COMMIT TRANSACTION;', false);
    },
    async rollback() {
      await conn.execute('ROLLBACK TRANSACTION;', false);
    },
  };
}
