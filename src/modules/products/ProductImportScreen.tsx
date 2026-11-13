import { useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import { listProducts } from '../../db/repositories/products';
import { applyProductImport, planProductImport, type ImportPlan } from '../../domain/productImport';
import { readSpreadsheet } from '../../domain/spreadsheet';

const LABEL = { new: 'New', update: 'Will change', unchanged: 'No change', error: 'Problem' } as const;

/** Pick an Excel/CSV file, preview exactly what will change, then confirm. */
export function ProductImportScreen() {
  const { db, user } = useSession();
  const { back } = useNav();
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPlan(null);
    setDone(null);
    setFileName(file.name);
    try {
      const { rows } = await readSpreadsheet(file, file.name);
      setPlan(planProductImport(rows, await listProducts(db, { includeInactive: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirm = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await applyProductImport(db, plan, user.id, fileName);
      setDone(`Saved: ${plan.counts.new} new, ${plan.counts.update} changed.`);
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toSave = plan ? plan.counts.new + plan.counts.update : 0;

  return (
    <div className="screen">
      <ScreenHeader title="Import products" />
      <div className="card subtle">
        Use an Excel (.xlsx) or CSV file with headings such as <b>Item Code</b>, <b>Product Name</b>, <b>Unit</b>,
        <b> Pack Size</b>, <b>HSN</b>. Products are matched by item code. Nothing is saved until you confirm.
      </div>
      <label className="btn btn-primary btn-block file-btn">
        Choose file
        <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={choose} hidden />
      </label>
      {error && <div className="banner banner-bad" role="alert">{error}</div>}
      {done && (
        <>
          <div className="banner banner-ok">{done}</div>
          <button className="btn btn-block" onClick={back}>Back to products</button>
        </>
      )}
      {plan && (
        <>
          <div className="stat-row">
            <div className="stat"><b>{plan.counts.new}</b><span>New</span></div>
            <div className="stat"><b>{plan.counts.update}</b><span>Will change</span></div>
            <div className="stat"><b>{plan.counts.unchanged}</b><span>No change</span></div>
            <div className={`stat${plan.counts.error ? ' stat-bad' : ''}`}><b>{plan.counts.error}</b><span>Problems</span></div>
          </div>
          {plan.generatedSkus && (
            <div className="banner banner-warn">This file has no item code column. Codes P0001, P0002… will be created.</div>
          )}
          {plan.counts.error > 0 && (
            <div className="banner banner-warn">Rows with problems will be skipped. Fix them in the file and import again if needed.</div>
          )}
          <ul className="list">
            {plan.rows.filter((r) => r.action !== 'unchanged').map((r) => (
              <li key={r.rowNo} className={`import-row import-${r.action}`}>
                <span className="tag">{LABEL[r.action]}</span>
                <span>
                  <b>Row {r.rowNo}</b> {r.input ? `${r.input.sku} · ${r.input.name}` : ''}
                  {r.error && <span className="row-error"> {r.error}</span>}
                  {r.changes?.map((c) => <span key={c} className="subtle" style={{ display: 'block' }}>{c}</span>)}
                </span>
              </li>
            ))}
          </ul>
          <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy || toSave === 0}>
            {busy ? 'Saving…' : toSave === 0 ? 'Nothing to save' : `Save ${toSave} product${toSave === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </div>
  );
}
