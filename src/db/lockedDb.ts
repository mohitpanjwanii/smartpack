import type { Db, RawDriver, SqlValue } from './types';

/**
 * Wraps a driver so that work is strictly one-at-a-time.
 * JavaScript is asynchronous, so without this two screens could start
 * transactions that interleave and corrupt each other. Every call waits its
 * turn in a queue; calls made inside a transaction use the transaction handle
 * and skip the queue.
 */
export function createLockedDb(driver: RawDriver): Db {
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  const direct = (afterWrite: boolean): Db => {
    const handle: Db = {
      exec: async (sql) => {
        await driver.exec(sql);
      },
      run: async (sql, params: SqlValue[] = []) => driver.run(sql, params),
      all: async <T,>(sql: string, params: SqlValue[] = []) => (await driver.all(sql, params)) as T[],
      get: async <T,>(sql: string, params: SqlValue[] = []) => (await driver.all(sql, params))[0] as T | undefined,
      transaction: async () => {
        throw new Error('Nested transactions are not supported');
      },
    };
    if (!afterWrite) return handle;
    return {
      ...handle,
      exec: async (sql) => {
        await driver.exec(sql);
        await driver.afterWrite?.();
      },
      run: async (sql, params = []) => {
        const r = await driver.run(sql, params);
        await driver.afterWrite?.();
        return r;
      },
    };
  };

  const autoCommit = direct(true);
  const inTx = direct(false);

  return {
    exec: (sql) => enqueue(() => autoCommit.exec(sql)),
    run: (sql, params) => enqueue(() => autoCommit.run(sql, params)),
    all: <T,>(sql: string, params?: SqlValue[]) => enqueue(() => autoCommit.all<T>(sql, params)),
    get: <T,>(sql: string, params?: SqlValue[]) => enqueue(() => autoCommit.get<T>(sql, params)),
    transaction: <T,>(fn: (tx: Db) => Promise<T>) =>
      enqueue(async () => {
        await driver.begin();
        try {
          const result = await fn(inTx);
          await driver.commit();
          await driver.afterWrite?.();
          return result;
        } catch (err) {
          try {
            await driver.rollback();
          } catch {
            /* the original error matters more */
          }
          throw err;
        }
      }),
  };
}
