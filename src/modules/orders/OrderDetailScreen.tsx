import { useEffect, useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import { cancelOrder, getOrderDetail, ORDER_STATUS_LABEL, type OrderDetail } from '../../db/repositories/orders';
import { can } from '../../domain/permissions';
import { loadInvoiceFileUrl } from '../../services/invoiceFiles';
import { draftStore, newLineKey } from './draft';
import { formatDate } from './OrdersListScreen';

export function OrderDetailScreen({ id }: { id: string }) {
  const { db, user } = useSession();
  const { push, back } = useNav();
  const [o, setO] = useState<OrderDetail | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOrderDetail(db, id).then((d) => setO(d ?? null));
  }, [db, id]);

  if (!o) return <div className="screen"><ScreenHeader title="Order" /><p className="subtle">Loading…</p></div>;
  const editable = o.status === 'draft' && can(user.role, 'orders.edit');
  const totals = o.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.unit]: (acc[i.unit] ?? 0) + i.ordered_qty }), {});

  const edit = () => {
    draftStore.set({
      mode: 'edit', orderId: o.id, customerName: o.customer_name, gstin: o.customer_gstin ?? '', address: '', invoiceNo: o.order_no,
      invoiceDate: o.invoice_date ?? '', globalIssues: [], issuesAcknowledged: true,
      lines: o.items.map((i) => ({ key: newLineKey(), text: i.source_text, productId: i.product_id, match: 'manual', qty: String(i.ordered_qty), unit: i.unit, issues: [], checked: true })),
    });
    push({ name: 'orderReview' });
  };

  const doCancel = async () => {
    try {
      await cancelOrder(db, o.id, reason, user.id);
      back();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const showInvoice = async () => {
    if (!o.invoice_file) return;
    setFileUrl(await loadInvoiceFileUrl(o.invoice_file.file_path, o.invoice_file.mime_type));
  };

  return (
    <div className="screen">
      <ScreenHeader title={o.order_no} />
      <div className="card">
        <div className="list-title" style={{ fontSize: '1.3rem' }}>{o.customer_name}</div>
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>Status</dt><dd>{ORDER_STATUS_LABEL[o.status]}</dd>
          {o.invoice_no && (<><dt>Invoice</dt><dd>{o.invoice_no}</dd></>)}
          {o.invoice_date && (<><dt>Date</dt><dd>{formatDate(o.invoice_date)}</dd></>)}
          {o.customer_gstin && (<><dt>GSTIN</dt><dd>{o.customer_gstin}</dd></>)}
          <dt>Total</dt><dd>{Object.entries(totals).map(([u, n]) => `${n} ${u}`).join(', ')}</dd>
        </dl>
      </div>
      <ul className="list">
        {o.items.map((i) => (
          <li key={i.id} className="list-row" style={{ cursor: 'default' }}>
            <span className="list-main">
              <span className="list-title">{i.product_name}</span>
              <span className="subtle">{i.sku}{i.source_text && i.source_text !== i.product_name ? ` · invoice: ${i.source_text}` : ''}</span>
            </span>
            <span className="list-side">{i.ordered_qty}<small>{i.unit}</small></span>
          </li>
        ))}
      </ul>
      {o.status === 'draft' && <div className="banner banner-ok">Ready to pack. Packing screens arrive in Stage 4.</div>}
      {o.invoice_file && !fileUrl && <button className="btn btn-block" onClick={showInvoice}>Show invoice photo</button>}
      {fileUrl && (o.invoice_file?.mime_type === 'application/pdf'
        ? <a className="btn btn-block file-btn" href={fileUrl} target="_blank" rel="noreferrer">Open invoice PDF</a>
        : <img src={fileUrl} alt="Invoice" style={{ width: '100%', borderRadius: 12, border: '2px solid var(--line)' }} />)}
      {editable && <button className="btn btn-block" onClick={edit}>Edit products and quantities</button>}
      {editable && !cancelling && <button className="btn btn-block" onClick={() => setCancelling(true)}>Cancel order</button>}
      {cancelling && (
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <div className="field">
            <label htmlFor="reason">Reason for cancelling (required)</label>
            <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="row-buttons">
            <button className="btn btn-primary" disabled={!reason.trim()} onClick={doCancel}>Confirm cancel</button>
            <button className="btn" onClick={() => setCancelling(false)}>Keep order</button>
          </div>
        </div>
      )}
      {error && <div className="banner banner-bad">{error}</div>}
    </div>
  );
}
