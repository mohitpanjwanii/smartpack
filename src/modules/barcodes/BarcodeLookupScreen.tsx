import { useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader } from '../../app/nav';
import { changeBarcodeStatus, lookupBarcode, STATUS_LABEL, type BarcodeInfo } from '../../db/repositories/barcodes';
import { can } from '../../domain/permissions';
import { normalizeBarcode } from '../../domain/barcode';
import { ScanInput } from '../../ui/components/ScanInput';

export function BarcodeLookupScreen() {
  const { db, user } = useSession();
  const [info, setInfo] = useState<BarcodeInfo | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [action, setAction] = useState<'void' | 'damaged' | 'registered' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const supervisor = can(user.role, 'barcodes.changeStatus');

  const onCode = async (code: string) => {
    setError(null);
    setAction(null);
    const found = await lookupBarcode(db, code);
    setInfo(found ?? null);
    setMissing(found ? null : normalizeBarcode(code));
  };

  const apply = async () => {
    if (!info || !action) return;
    try {
      await changeBarcodeStatus(db, info.id, action, reason, user.id);
      setInfo((await lookupBarcode(db, info.barcode)) ?? null);
      setAction(null);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const statusClass = info?.status === 'registered' ? 'result-ok' : info?.status === 'packed' ? 'result-warn' : 'result-bad';

  return (
    <div className="screen">
      <ScreenHeader title="Check a barcode" />
      <ScanInput onCode={onCode} />
      {missing && (
        <div className="result result-bad" role="alert">
          Not registered: {missing}
          <small>This barcode is not in SmartPack. Register it under its product first.</small>
        </div>
      )}
      {info && (
        <>
          <div className={`result ${statusClass}`}>
            {info.product_name}
            <small>{STATUS_LABEL[info.status]}</small>
          </div>
          <div className="card">
            <dl className="kv">
              <dt>Barcode</dt><dd className="mono">{info.barcode}</dd>
              <dt>Item code</dt><dd>{info.sku}</dd>
              <dt>Serial</dt><dd className="mono">{info.serial_no}</dd>
              <dt>Registered</dt><dd>{new Date(info.created_at).toLocaleString('en-IN')}</dd>
              {info.order_no && (<><dt>Order</dt><dd>{info.order_no}</dd></>)}
              {info.carton_no && (<><dt>Carton</dt><dd>{info.carton_no}</dd></>)}
            </dl>
          </div>
          {supervisor && info.status !== 'packed' && !action && (
            <div className="row-buttons">
              {info.status === 'registered' ? (
                <>
                  <button className="btn" onClick={() => setAction('damaged')}>Mark damaged</button>
                  <button className="btn" onClick={() => setAction('void')}>Mark void</button>
                </>
              ) : (
                <button className="btn" onClick={() => setAction('registered')}>Restore to ready</button>
              )}
            </div>
          )}
          {action && (
            <div className="card" style={{ display: 'grid', gap: 10 }}>
              <div className="field">
                <label htmlFor="reason">Reason (required)</label>
                <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <div className="row-buttons">
                <button className="btn btn-primary" onClick={apply} disabled={!reason.trim()}>Confirm</button>
                <button className="btn" onClick={() => { setAction(null); setReason(''); }}>Cancel</button>
              </div>
            </div>
          )}
          {error && <div className="banner banner-bad">{error}</div>}
        </>
      )}
    </div>
  );
}
