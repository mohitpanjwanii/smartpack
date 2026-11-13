import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import { listProducts, type ProductWithCounts } from '../../db/repositories/products';
import { createOrder, updateDraftOrderItems } from '../../db/repositories/orders';
import { findCustomerByGstin, searchCustomers, type Customer } from '../../db/repositories/customers';
import { isValidGstin } from '../../domain/gstin';
import { saveInvoiceFile } from '../../services/invoiceFiles';
import { Modal } from '../../ui/components/Modal';
import { ProductPicker } from '../barcodes/ProductPicker';
import { draftBlockers, draftStore, emptyLine, lineNeedsCheck, type DraftLine, type OrderDraft } from './draft';

const UNITS = ['box', 'pack', 'pcs'];

const MATCH_NOTE: Record<DraftLine['match'], string> = {
  alias: 'Matched (remembered)',
  exact: 'Matched (same name)',
  suggested: 'Suggested match: confirm it is the right product',
  ambiguous: 'Several products have this name: choose the right one',
  none: 'No match found: choose the product',
  manual: '',
};

/**
 * The editable review screen. Nothing read from an invoice becomes an
 * order until a person has checked it; every uncertain line must be ticked.
 */
export function OrderReviewScreen() {
  const { db, user } = useSession();
  const { back, push, home } = useNav();
  const [draft, setDraft] = useState<OrderDraft | null>(() => draftStore.get());
  const [products, setProducts] = useState<ProductWithCounts[]>([]);
  const [picking, setPicking] = useState<string | null>(null);
  const [known, setKnown] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showText, setShowText] = useState(false);
  const [suggest, setSuggest] = useState<Customer[]>([]);

  useEffect(() => {
    const q = draft?.customerName.trim() ?? '';
    if (draft?.mode !== 'manual' || q.length < 2) return setSuggest([]);
    searchCustomers(db, q, 5).then((c) => setSuggest(c.filter((x) => x.name !== q)));
  }, [db, draft?.mode, draft?.customerName]);

  useEffect(() => {
    listProducts(db).then(setProducts);
  }, [db]);

  useEffect(() => {
    const g = draft?.gstin.trim().toUpperCase() ?? '';
    if (isValidGstin(g)) findCustomerByGstin(db, g).then((c) => setKnown(c ?? null));
    else setKnown(null);
  }, [db, draft?.gstin]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  if (!draft) return <div className="screen"><ScreenHeader title="Review order" /><p>Nothing to review.</p></div>;

  const update = (patch: Partial<OrderDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setDraft((d) => (d ? { ...d, lines: d.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } : d));
  const removeLine = (key: string) => setDraft((d) => (d ? { ...d, lines: d.lines.filter((l) => l.key !== key) } : d));

  const blockers = draftBlockers(draft);
  const gstinState = !draft.gstin.trim() ? null : isValidGstin(draft.gstin) ? 'ok' : 'bad';
  const totalQty = draft.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const items = draft.lines.map((l) => ({ productId: l.productId!, qty: Number(l.qty), unit: l.unit, sourceText: l.text }));
      if (draft.mode === 'edit' && draft.orderId) {
        await updateDraftOrderItems(db, draft.orderId, items, user.id);
        draftStore.clear();
        back();
        return;
      }
      const file = draft.file ? await saveInvoiceFile(draft.file.blob, draft.file.name) : null;
      const id = await createOrder(
        db,
        {
          customer: { name: known?.name ?? draft.customerName, gstin: draft.gstin || null, address: draft.address || null },
          invoiceNo: draft.invoiceNo || null,
          invoiceDate: draft.invoiceDate || null,
          source: draft.mode === 'invoice' ? 'invoice' : 'manual',
          items,
          invoiceFile: file && draft.file
            ? { path: file.path, mimeType: file.mimeType, source: draft.file.source, method: 'ocr', rawResult: draft.ocrText ?? '' }
            : null,
        },
        user.id,
      );
      draftStore.clear();
      home();
      push({ name: 'orders' });
      push({ name: 'orderDetail', id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <ScreenHeader title={draft.mode === 'edit' ? 'Edit order' : 'Check and create order'} />

      {draft.mode === 'invoice' && (
        <div className="banner banner-warn">Read from the invoice photo. Compare every line with the paper before creating the order.</div>
      )}

      {draft.globalIssues.length > 0 && (
        <div className="card card-warn">
          <b>Please check:</b>
          <ul className="issues">{draft.globalIssues.map((i) => <li key={i}>{i}</li>)}</ul>
          <label className="check">
            <input type="checkbox" checked={draft.issuesAcknowledged} onChange={(e) => update({ issuesAcknowledged: e.target.checked })} />
            I have checked these against the invoice
          </label>
        </div>
      )}

      {draft.mode !== 'edit' ? (
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <div className="field">
            <label htmlFor="cust">Customer</label>
            <input id="cust" value={known?.name ?? draft.customerName} disabled={!!known} onChange={(e) => update({ customerName: e.target.value })} />
            {known && <span className="ok-note">Existing customer, found by GSTIN</span>}
            {suggest.length > 0 && (
              <div className="chips">
                {suggest.map((c) => (
                  <button key={c.id} type="button" className="chip" onClick={() => update({ customerName: c.name, gstin: c.gstin ?? '', address: c.address ?? '' })}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor="gstin">Customer GSTIN (optional)</label>
            <input id="gstin" value={draft.gstin} onChange={(e) => update({ gstin: e.target.value.toUpperCase().replace(/\s/g, '') })} autoCapitalize="characters" maxLength={15} />
            {gstinState === 'ok' && <span className="ok-note">✓ GSTIN is valid</span>}
            {gstinState === 'bad' && <span className="bad-note">✗ GSTIN check failed. Correct it from the invoice.</span>}
          </div>
          <div className="two-col two-col-wide">
            <div className="field">
              <label htmlFor="invno">Invoice no.{draft.mode === 'manual' && ' (optional)'}</label>
              <input id="invno" value={draft.invoiceNo} onChange={(e) => update({ invoiceNo: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="invdate">Invoice date</label>
              <input id="invdate" type="date" value={draft.invoiceDate} onChange={(e) => update({ invoiceDate: e.target.value })} />
            </div>
          </div>
        </div>
      ) : (
        <div className="card"><b>{draft.customerName}</b><div className="subtle">{draft.invoiceNo}</div></div>
      )}

      <h2 className="section-title">Products ({draft.lines.length} lines, {totalQty} units)</h2>
      <ul className="list">
        {draft.lines.map((l, i) => {
          const p = l.productId ? byId.get(l.productId) : undefined;
          const needs = lineNeedsCheck(l);
          return (
            <li key={l.key} className={`line-card${needs && !l.checked ? ' line-attention' : ''}`}>
              <div className="line-head">
                <span className="line-no">{i + 1}</span>
                <button className="line-product" onClick={() => setPicking(l.key)}>
                  {p ? <><b>{p.name}</b><span className="subtle"> {p.sku}</span></> : <b className="bad-note">Choose product…</b>}
                </button>
              </div>
              {l.text && <div className="subtle">Invoice says: “{l.text}”</div>}
              {MATCH_NOTE[l.match] && <div className={l.match === 'alias' || l.match === 'exact' ? 'ok-note' : 'warn-note'}>{MATCH_NOTE[l.match]}</div>}
              {l.issues.map((iss) => <div key={iss} className="bad-note">{iss}</div>)}
              {(l.match === 'ambiguous' || l.match === 'suggested') && l.options && l.options.length > 1 && (
                <div className="chips">
                  {l.options.slice(0, 4).map((id) => byId.get(id)).filter(Boolean).map((op) => (
                    <button key={op!.id} type="button" className={`chip chip-small${l.productId === op!.id ? ' chip-on' : ''}`} onClick={() => updateLine(l.key, { productId: op!.id })}>
                      {op!.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="line-qty">
                <input aria-label={`Quantity line ${i + 1}`} inputMode="numeric" value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value.replace(/[^\d]/g, '') })} />
                <div className="chips">
                  {UNITS.map((u) => (
                    <button key={u} type="button" className={`chip${l.unit === u ? ' chip-on' : ''}`} onClick={() => updateLine(l.key, { unit: u })}>{u}</button>
                  ))}
                </div>
              </div>
              <div className="line-actions">
                {needs && (
                  <label className="check">
                    <input type="checkbox" checked={l.checked} onChange={(e) => updateLine(l.key, { checked: e.target.checked })} /> Right product and quantity
                  </label>
                )}
                <button className="btn btn-small" onClick={() => removeLine(l.key)}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>
      <button className="btn btn-block" onClick={() => update({ lines: [...draft.lines, emptyLine()] })}>+ Add a product line</button>

      {draft.ocrText && (
        <>
          <button className="btn btn-small" onClick={() => setShowText((v) => !v)}>{showText ? 'Hide' : 'Show'} text read from invoice</button>
          {showText && <pre className="ocr-text">{draft.ocrText}</pre>}
        </>
      )}

      {blockers.length > 0 && (
        <div className="card">
          <b>Before creating the order:</b>
          <ul className="issues">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {error && <div className="banner banner-bad" role="alert">{error}</div>}
      <button className="btn btn-primary btn-block" onClick={save} disabled={busy || blockers.length > 0}>
        {busy ? 'Saving…' : draft.mode === 'edit' ? 'Save changes' : 'Create order'}
      </button>

      {picking && (
        <Modal title="Choose product" onClose={() => setPicking(null)}>
          <ProductPicker
            db={db}
            onPick={(p) => {
              const line = draft.lines.find((x) => x.key === picking);
              updateLine(picking, { productId: p.id, match: 'manual', checked: !line?.issues.length });
              setPicking(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
