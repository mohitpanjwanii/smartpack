import type { Database, SqlJsStatic } from 'sql.js';
import type { RawDriver, SqlValue } from './types';

/**
 * Driver for sql.js (SQLite in WebAssembly). Used by automated tests and by
 * the browser preview. `persist` is called after every committed write so the
 * browser preview can save its copy; tests pass nothing.
 */
export function createSqlJsDriver(
  SQL: SqlJsStatic,
  initialBytes?: Uint8Array | null,
  persist?: (bytes: Uint8Array) => Promise<void>,
): { driver: RawDriver; database: Database } {
  const database = initialBytes ? new SQL.Database(initialBytes) : new SQL.Database();
  database.run('PRAGMA foreign_keys = ON;');

  const driver: RawDriver = {
    async exec(sql) {
      database.exec(sql);
    },
    async run(sql, params: SqlValue[]) {
      database.run(sql, params);
      return { changes: database.getRowsModified() };
    },
    async all(sql, params: SqlValue[]) {
      const stmt = database.prepare(sql);
      try {
        stmt.bind(params);
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
      }
    },
    async begin() {
      database.exec('BEGIN IMMEDIATE;');
    },
    async commit() {
      database.exec('COMMIT;');
    },
    async rollback() {
      database.exec('ROLLBACK;');
    },
    afterWrite: persist ? () => persist(database.export()) : undefined,
  };
  return { driver, database };
}
