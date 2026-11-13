import { useEffect, useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import {
  createProduct, getProduct, setProductActive, updateProduct, ProductError, type Product,
} from '../../db/repositories/products';

const UNITS = ['pkt', 'pcs', 'box', 'tray', 'case', 'kg'];

export function ProductFormScreen({ id }: { id?: string }) {
  const { db, user } = useSession();
  const { back } = useNav();
  const [loaded, setLoaded] = useState<Product | null>(null);
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('pkt');
  const [pack, setPack] = useState('');
  const [hsn, setHsn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getProduct(db, id).then((p) => {
      if (!p) return;
      setLoaded(p);
      setSku(p.sku);
      setName(p.name);
      setUnit(p.unit);
      setPack(p.pack_size?.toString() ?? '');
      setHsn(p.hsn_code ?? '');
    });
  }, [db, id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const packNum = pack.trim() ? Number(pack) : null;
    if (packNum !== null && !(packNum > 0)) return setError('Pack size must be a positive number');
    setBusy(true);
    try {
      const input = { sku, name, unit, pack_size: packNum, hsn_code: hsn || null };
      if (id) await updateProduct(db, id, input, user.id);
      else await createProduct(db, input, user.id);
      back();
    } catch (err) {
      setError(err instanceof ProductError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!loaded) return;
    await setProductActive(db, loaded.id, !loaded.active, user.id);
    back();
  };

  return (
    <form className="screen" onSubmit={save}>
      <ScreenHeader title={id ? 'Edit product' : 'Add product'} />
      <div className="field">
        <label htmlFor="sku">Item code (SKU)</label>
        <input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} autoCapitalize="characters" />
      </div>
      <div className="field">
        <label htmlFor="name">Product name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Unit</label>
        <div className="chips">
          {UNITS.map((u) => (
            <button type="button" key={u} className={`chip${unit === u ? ' chip-on' : ''}`} onClick={() => setUnit(u)}>{u}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="pack">Pack size / weight in grams (optional)</label>
        <input id="pack" inputMode="decimal" value={pack} onChange={(e) => setPack(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="hsn">HSN code (optional)</label>
        <input id="hsn" inputMode="numeric" value={hsn} onChange={(e) => setHsn(e.target.value)} />
      </div>
      {error && <div className="banner banner-bad" role="alert">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button>
      {loaded && (
        <button type="button" className="btn btn-block" onClick={toggle}>
          {loaded.active ? 'Switch off this product' : 'Switch this product back on'}
        </button>
      )}
    </form>
  );
}
