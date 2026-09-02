import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { getInventoryHealth } from '../../api/analytics';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { Zap, Skull, RefreshCw, XCircle } from 'lucide-react';

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

function ItemTable({ items, cols }) {
  if (!items?.length) return <div className="text-center py-4" style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>None</div>;
  return (
    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
      <table className="table ardent-table mb-0">
        <thead style={{ position: 'sticky', top: 0 }}><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>{cols.map(c => <td key={c.key} style={c.mono ? { fontFamily: 'var(--font-mono)' } : {}}>{c.render ? c.render(it) : it[c.key]}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Inventory() {
  const { activeBrand } = useBrand();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('needs_reorder');

  useEffect(() => {
    if (!activeBrand) return;
    setLoading(true);
    getInventoryHealth(activeBrand.id).then(r => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, [activeBrand]);

  const tabs = data ? [
    { key: 'needs_reorder', label: 'Needs Reorder', icon: RefreshCw, items: data.needs_reorder, color: 'var(--color-warning)' },
    { key: 'out_of_stock',  label: 'Out of Stock',  icon: XCircle,   items: data.out_of_stock,  color: 'var(--color-destructive)' },
    { key: 'fast_movers',   label: 'Fast Movers',   icon: Zap,       items: data.fast_movers,   color: 'var(--color-success)' },
    { key: 'dead_stock',    label: 'Dead Stock',    icon: Skull,     items: data.dead_stock,    color: 'var(--color-muted-fg)' },
  ] : [];

  const cols = [
    { key: 'sku', label: 'SKU', mono: true },
    { key: 'product_name', label: 'Product' },
    { key: 'stock_on_hand', label: 'Stock', mono: true },
    { key: 'reorder_point', label: 'Reorder Pt', mono: true },
  ];

  return (
    <div>
      <PageHeader title="Inventory Health" subtitle="Stock levels, reorder alerts, fast movers and dead stock" />

      {loading ? <Spinner center /> : data && (
        <>
          <div className="row g-3 mb-4">
            <div className="col-6 col-md-3"><div className="kpi-card"><div className="kpi-label">Total SKUs</div><div className="kpi-value">{data.total_skus}</div></div></div>
            <div className="col-6 col-md-3"><div className="kpi-card"><div className="kpi-label">Needs Reorder</div><div className="kpi-value" style={{ color: 'var(--color-warning)' }}>{data.needs_reorder?.length || 0}</div></div></div>
            <div className="col-6 col-md-3"><div className="kpi-card"><div className="kpi-label">Out of Stock</div><div className="kpi-value" style={{ color: 'var(--color-destructive)' }}>{data.out_of_stock?.length || 0}</div></div></div>
            <div className="col-6 col-md-3"><div className="kpi-card"><div className="kpi-label">OOS Rate</div><div className="kpi-value" style={{ color: data.oos_pct > 10 ? 'var(--color-destructive)' : 'var(--color-success)' }}>{data.oos_pct}%</div></div></div>
          </div>

          <div className="card">
            <div className="card-header p-0">
              <ul className="nav nav-tabs" style={{ borderBottom: 'none' }}>
                {tabs.map(t => (
                  <li className="nav-item" key={t.key}>
                    <button
                      className={`nav-link${tab === t.key ? ' active' : ''}`}
                      style={{
                        border: 'none', borderBottom: tab === t.key ? `2px solid ${t.color}` : '2px solid transparent',
                        background: 'none', color: tab === t.key ? 'var(--color-text)' : 'var(--color-muted-fg)',
                        fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      }}
                      onClick={() => setTab(t.key)}
                    >
                      <t.icon size={15} /> {t.label} <span className="badge badge-info" style={{ borderRadius: '999px', fontSize: '0.65rem' }}>{t.items?.length || 0}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card-body p-0">
              <ItemTable items={tabs.find(t => t.key === tab)?.items} cols={cols} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
