import type { Db } from './types';
import { migrations as allMigrations, type Migration } from './migrations';

/**
 * Bring the database up to the latest version. Each pending migration runs in
 * its own transaction and is recorded in schema_migrations, so running this
 * again does nothing and a failed upgrade leaves the previous version intact.
 */
export async function migrate(db: Db, migrations: Migration[] = allMigrations): Promise<number[]> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
  const done = new Set(
    (await db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version),
  );
  const applied: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        m.version,
        m.name,
        new Date().toISOString(),
      ]);
    });
    applied.push(m.version);
  }
  return applied;
}

export async function currentVersion(db: Db): Promise<number> {
  const row = await db.get<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations');
  return row?.v ?? 0;
}
