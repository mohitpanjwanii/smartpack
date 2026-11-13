/** A value that can be bound to a SQL parameter. */
export type SqlValue = string | number | null;

/**
 * The database interface every part of SmartPack uses.
 * Two implementations exist: native SQLite on the phone (Capacitor) and
 * sql.js (SQLite compiled to WebAssembly) for the browser preview and tests.
 * Both run exactly the same SQL and migrations.
 */
export interface Db {
  /** Run one or more statements with no parameters (used by migrations). */
  exec(sql: string): Promise<void>;
  /** Run a single statement that changes data. */
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Fetch all matching rows. */
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Fetch the first matching row, or undefined. */
  get<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  /**
   * Run `fn` inside one transaction: either every change inside it is saved,
   * or (on any error) none are. Transactions never interleave.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/** The minimal operations a storage engine must provide. */
export interface RawDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlValue[]): Promise<{ changes: number }>;
  all(sql: string, params: SqlValue[]): Promise<Record<string, unknown>[]>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /** Called after a committed write, e.g. to persist the browser copy. */
  afterWrite?(): Promise<void>;
}
