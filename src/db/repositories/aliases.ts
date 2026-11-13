import type { Db } from '../types';
import { nowIso } from '../../domain/ids';
import { normalizeName } from '../../domain/productMatch';

export async function getAliasMap(db: Db): Promise<Map<string, string>> {
  const rows = await db.all<{ alias: string; product_id: string }>('SELECT alias, product_id FROM product_aliases');
  return new Map(rows.map((r) => [r.alias, r.product_id]));
}

/** Remember (or update) that this invoice wording means this product. */
export async function rememberAlias(db: Db, text: string, productId: string, userId: string): Promise<void> {
  const alias = normalizeName(text);
  if (!alias) return;
  await db.run(
    `INSERT INTO product_aliases (alias, product_id, created_by, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (alias) DO UPDATE SET product_id = excluded.product_id`,
    [alias, productId, userId, nowIso()],
  );
}
