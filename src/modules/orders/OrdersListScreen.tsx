import { useEffect, useState } from 'react';
import { useSession } from '../../app/session';
import { ScreenHeader, useNav } from '../../app/nav';
import { listOrders, ORDER_STATUS_LABEL, type OrderSummary } from '../../db/repositories/orders';
import { draftStore, emptyLine } from './draft';

const TABS = [
  { key: 'open', label: 'To pack' },
  { key: 'done', label: 'Finished' },
  { key: 'all', label: 'All' },
] as const;

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}

export function OrdersListScreen() {
  const { db } = useSession();
  const { push } = useNav();
  const [tab, setTab] = useState<'open' | 'done' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);

  useEffect(() => {
    let live = true;
    listOrders(db, tab, search).then((o) => live && setOrders(o));
    return () => {
      live = false;
    };
  }, [db, tab, search]);

  const manual = () => {
    draftStore.set({
      mode: 'manual', customerName: '', gstin: '', address: '', invoiceNo: '', invoiceDate: new Date().toISOString().slice(0, 10),
      lines: [emptyLine()], globalIssues: [], issuesAcknowledged: true,
    });
    push({ name: 'orderReview' });
  };

  return (
    <div className="screen">
      <ScreenHeader title="Customer orders" />
      <div className="row-buttons">
        <button className="btn btn-primary" onClick={() => push({ name: 'invoiceCapture' })}>From invoice</button>
        <button className="btn" onClick={manual}>Manual order</button>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' tab-on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="field">
        <input placeholder="Search order no. or customer" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders" />
      </div>
      {orders?.length === 0 && <div className="card">No orders here yet.</div>}
      <ul className="list">
        {orders?.map((o) => (
          <li key={o.id}>
            <button className="list-row" onClick={() => push({ name: 'orderDetail', id: o.id })}>
              <span className="list-main">
                <span className="list-title">{o.customer_name}</span>
                <span className="subtle">{o.order_no} · {formatDate(o.invoice_date ?? o.created_at)} · {ORDER_STATUS_LABEL[o.status]}</span>
              </span>
              <span className="list-side">{o.total_qty}<small>{o.lines} lines</small></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
