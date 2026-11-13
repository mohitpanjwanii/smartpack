import { useEffect, useState } from 'react';
import type { Db } from '../../db/types';
import { listProducts, type ProductWithCounts } from '../../db/repositories/products';

/** Searchable list of active products with large tap targets. */
export function ProductPicker({ db, onPick }: { db: Db; onPick: (p: ProductWithCounts) => void }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ProductWithCounts[] | null>(null);
  useEffect(() => {
    let live = true;
    listProducts(db, { search }).then((p) => live && setItems(p));
    return () => {
      live = false;
    };
  }, [db, search]);
  return (
    <>
      <div className="field">
        <input placeholder="Search product name or code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
      </div>
      {items?.length === 0 && <div className="card">No matching product. Add products first.</div>}
      <ul className="list">
        {items?.map((p) => (
          <li key={p.id}>
            <button className="list-row" onClick={() => onPick(p)}>
              <span className="list-main">
                <span className="list-title">{p.name}</span>
                <span className="subtle">{p.sku}</span>
              </span>
              <span className="list-side">{p.registered}<small>barcodes</small></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
