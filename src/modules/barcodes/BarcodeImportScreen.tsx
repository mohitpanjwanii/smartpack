import { useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import { applyBarcodeImport, planBarcodeImport, type BarcodePlan } from '../../domain/barcodeImport';
import { readSpreadsheet } from '../../domain/spreadsheet';

const LABEL = { new: 'New', already: 'Already in', error: 'Problem' } as const;

export function BarcodeImportScreen() {
  const { db, user } = useSession();
  const { back } = useNav();
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<BarcodePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPlan(null);
    setDone(null);
    setFileName(file.name);
    try {
      const { rows, unsafeNumberRows } = await readSpreadsheet(file, file.name);
      setPlan(await planBarcodeImport(db, rows, unsafeNumberRows));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirm = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const n = await applyBarcodeImport(db, plan, user.id, fileName);
      setDone(`Saved ${n} barcode${n === 1 ? '' : 's'}.`);
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <ScreenHeader title="Import barcodes" />
      <div className="card subtle">
        The file needs a <b>Barcode</b> column and an <b>Item Code</b> (or <b>Product Name</b>) column. A
        <b> Serial No</b> column is optional. Format the barcode column as Text in Excel so long numbers are not rounded.
      </div>
      <label className="btn btn-primary btn-block file-btn">
        Choose file
        <input type="file" accept=".xlsx,.csv,text/csv" onChange={choose} hidden />
      </label>
      {error && <div className="banner banner-bad" role="alert">{error}</div>}
      {done && (
        <>
          <div className="banner banner-ok">{done}</div>
          <button className="btn btn-block" onClick={back}>Done</button>
        </>
      )}
      {plan && (
        <>
          <div className="stat-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat"><b>{plan.counts.new}</b><span>New</span></div>
            <div className="stat"><b>{plan.counts.already}</b><span>Already in</span></div>
            <div className={`stat${plan.counts.error ? ' stat-bad' : ''}`}><b>{plan.counts.error}</b><span>Problems</span></div>
          </div>
          {plan.counts.error > 0 && <div className="banner banner-warn">Rows with problems will be skipped.</div>}
          <ul className="list">
            {plan.rows.filter((r) => r.action !== 'already').slice(0, 300).map((r) => (
              <li key={r.rowNo} className={`import-row import-${r.action === 'new' ? 'new' : 'error'}`}>
                <span className="tag">{LABEL[r.action]}</span>
                <span>
                  <b>Row {r.rowNo}</b> <span className="mono">{r.barcode}</span> {r.productLabel && `· ${r.productLabel}`}
                  {r.error && <span className="row-error" style={{ display: 'block' }}>{r.error}</span>}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy || plan.counts.new === 0}>
            {busy ? 'Saving…' : plan.counts.new === 0 ? 'Nothing new to save' : `Save ${plan.counts.new} barcodes`}
          </button>
        </>
      )}
    </div>
  );
}
