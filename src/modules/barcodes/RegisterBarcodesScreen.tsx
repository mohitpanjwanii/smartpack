import { useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader } from '../../app/nav';
import { registerBarcode, BarcodeError, type BarcodeInfo } from '../../db/repositories/barcodes';
import type { ProductWithCounts } from '../../db/repositories/products';
import { ScanInput } from '../../ui/components/ScanInput';
import { ProductPicker } from './ProductPicker';

type Result = { ok: true; info: BarcodeInfo } | { ok: false; code: string; message: string };

/**
 * Register packets: choose the product once, then scan each packet. Every
 * scan is saved immediately; a code already in the system is refused and the
 * screen shows which product it belongs to.
 */
export function RegisterBarcodesScreen() {
  const { db, user } = useSession();
  const [product, setProduct] = useState<ProductWithCounts | null>(null);
  const [session, setSession] = useState<BarcodeInfo[]>([]);
  const [last, setLast] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  const onCode = async (code: string) => {
    if (!product) return;
    setBusy(true);
    try {
      const info = await registerBarcode(db, { barcode: code, productId: product.id }, user.id);
      setSession((s) => [info, ...s]);
      setLast({ ok: true, info });
    } catch (err) {
      setLast({ ok: false, code, message: err instanceof BarcodeError ? err.message : String(err) });
      navigator.vibrate?.(300);
    } finally {
      setBusy(false);
    }
  };

  if (!product) {
    return (
      <div className="screen">
        <ScreenHeader title="Register packets" />
        <p className="subtle">Step 1: choose the product you are about to scan.</p>
        <ProductPicker db={db} onPick={setProduct} />
      </div>
    );
  }

  return (
    <div className="screen">
      <ScreenHeader title="Register packets" />
      <div className="card">
        <div className="subtle">Scanning packets of</div>
        <div className="list-title" style={{ fontSize: '1.25rem' }}>{product.name}</div>
        <div className="subtle">{product.sku}</div>
        <button className="btn btn-small" style={{ marginTop: 10 }} onClick={() => { setProduct(null); setSession([]); setLast(null); }}>
          Change product
        </button>
      </div>

      <ScanInput onCode={onCode} busy={busy} />

      {last && (last.ok ? (
        <div className="result result-ok" role="status">
          Registered ✓ {last.info.barcode}
          <small>{last.info.product_name}</small>
        </div>
      ) : (
        <div className="result result-bad" role="alert">
          Not registered: {last.code}
          <small>{last.message}</small>
        </div>
      ))}

      <div className="big-count">
        <b>{session.length}</b>
        <span>registered in this session</span>
      </div>
      {session.length > 0 && (
        <ul className="list">
          {session.slice(0, 20).map((b) => (
            <li key={b.id} className="mono-row">{b.barcode}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
