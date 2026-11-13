import { useEffect, useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import { listProducts, type ProductWithCounts } from '../../db/repositories/products';
import { can } from '../../domain/permissions';

export function ProductListScreen() {
  const { db, user } = useSession();
  const { push } = useNav();
  const [search, setSearch] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [products, setProducts] = useState<ProductWithCounts[] | null>(null);
  const editor = can(user.role, 'products.edit');

  useEffect(() => {
    let live = true;
    listProducts(db, { search, includeInactive: showOff }).then((p) => live && setProducts(p));
    return () => {
      live = false;
    };
  }, [db, search, showOff]);

  return (
    <div className="screen">
      <ScreenHeader title="Products" />
      {editor && (
        <div className="row-buttons">
          <button className="btn btn-primary" onClick={() => push({ name: 'productForm' })}>+ Add product</button>
          {can(user.role, 'products.import') && (
            <button className="btn" onClick={() => push({ name: 'productImport' })}>Import from Excel</button>
          )}
        </div>
      )}
      <div className="field">
        <input placeholder="Search by name or code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
      </div>
      <label className="check">
        <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Show switched-off products
      </label>
      {products === null ? (
        <p className="subtle">Loading…</p>
      ) : products.length === 0 ? (
        <div className="card">
          {search ? 'No product matches your search.' : 'No products yet. Add one, or import your list from Excel.'}
        </div>
      ) : (
        <>
          <p className="subtle">{products.length} product{products.length === 1 ? '' : 's'}</p>
          <ul className="list">
            {products.map((p) => (
              <li key={p.id}>
                <button
                  className="list-row"
                  onClick={() => push({ name: 'productForm', id: p.id })}
                  disabled={!editor}
                >
                  <span className="list-main">
                    <span className="list-title">{p.name}{!p.active && <span className="tag tag-off">Off</span>}</span>
                    <span className="subtle">{p.sku} · {p.unit}{p.pack_size ? ` · ${p.pack_size}` : ''}</span>
                  </span>
                  <span className="list-side">{p.registered}<small>barcodes</small></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
