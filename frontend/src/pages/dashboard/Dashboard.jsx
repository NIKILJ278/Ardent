import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { getDashboard } from '../../api/analytics';
import KpiCard from '../../components/ui/KpiCard';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { TrendingUp, ShoppingCart, Package, AlertTriangle } from 'lucide-react';

const COLORS = ['#1E40AF','#3B82F6','#D97706','#0E7490','#15803D','#7C3AED'];
const fmt = (n, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);
const fmtN = n => new Intl.NumberFormat('en-IN').format(n || 0);

const DAYS_OPTIONS = [7, 14, 30, 90];

export default function Dashboard() {
  const { activeBrand } = useBrand();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);
  const currency = activeBrand?.currency || 'INR';

  useEffect(() => {
    if (!activeBrand) return;
    setLoading(true);
    getDashboard(activeBrand.id, days)
      .then(r => setData(r.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeBrand, days]);

  if (!activeBrand) return (
    <div className="d-flex flex-column align-items-center justify-content-center py-5 gap-3">
      <Package size={48} color="var(--color-muted-fg)" />
      <p style={{ color: 'var(--color-muted-fg)' }}>No brand selected. Create one from the top bar.</p>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={`${activeBrand.name} — Dashboard`}
        subtitle={`Last ${days} days overview`}
        actions={
          <div className="btn-group btn-group-sm">
            {DAYS_OPTIONS.map(d => (
              <button key={d} className={`btn ${days === d ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
        }
      />

      {loading && <Spinner center />}

      {!loading && data && (
        <>
          {/* KPI row */}
          <div className="row g-3 mb-4">
            <div className="col-6 col-xl-3">
              <KpiCard label="Gross Sales" value={fmt(data.waterfall?.gross_sales, currency)} icon={TrendingUp} />
            </div>
            <div className="col-6 col-xl-3">
              <KpiCard label="Net Sales" value={fmt(data.waterfall?.net_sales, currency)} icon={TrendingUp} />
            </div>
            <div className="col-6 col-xl-3">
              <KpiCard label="Total Orders" value={fmtN(data.waterfall?.total_orders)} icon={ShoppingCart} />
            </div>
            <div className="col-6 col-xl-3">
              <KpiCard
                label="OOS SKUs"
                value={data.inventory?.out_of_stock_count ?? '—'}
                delta={`${data.inventory?.oos_pct ?? 0}% out of stock`}
                deltaType={data.inventory?.oos_pct > 10 ? 'down' : 'neutral'}
                icon={AlertTriangle}
              />
            </div>
          </div>

          <div className="row g-3 mb-4">
            {/* Channel profitability bar chart */}
            <div className="col-12 col-xl-7">
              <div className="card h-100">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Channel Profitability</span>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.channels || []} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v, n) => [fmt(v, currency), n === 'net_sales' ? 'Net Sales' : 'Net Margin']} />
                      <Legend />
                      <Bar dataKey="net_sales" name="Net Sales" fill="var(--color-primary)" radius={[4,4,0,0]} />
                      <Bar dataKey="net_margin" name="Net Margin" fill="var(--color-accent)" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Top campaigns */}
            <div className="col-12 col-xl-5">
              <div className="card h-100">
                <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Top Campaigns (ROAS)</span></div>
                <div className="card-body p-0">
                  <table className="table ardent-table mb-0">
                    <thead><tr><th>Campaign</th><th>ROAS</th><th>Action</th></tr></thead>
                    <tbody>
                      {(data.top_campaigns || []).map((c, i) => (
                        <tr key={i}>
                          <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.campaign_name}</td>
                          <td><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.roas}x</span></td>
                          <td>
                            <span className={`badge badge-${c.action === 'scale' ? 'success' : c.action === 'cut' ? 'danger' : 'warning'}`} style={{ borderRadius: '999px', padding: '2px 10px', fontSize: '0.75rem' }}>
                              {c.action}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!data.top_campaigns?.length && <tr><td colSpan={3} className="text-center py-3" style={{ color: 'var(--color-muted-fg)' }}>No campaign data</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="row g-3">
            {/* Gross-to-Net waterfall summary */}
            <div className="col-12 col-xl-6">
              <div className="card">
                <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>P&L Waterfall</span></div>
                <div className="card-body">
                  {[
                    { label: 'Gross Sales',       value: data.waterfall?.gross_sales,          color: 'var(--color-success)' },
                    { label: '− Discounts',        value: -data.waterfall?.discounts,           color: 'var(--color-destructive)' },
                    { label: '− Returns / RTO',    value: -data.waterfall?.returns_rto_value_lost, color: 'var(--color-destructive)' },
                    { label: '− Marketplace Fees', value: -data.waterfall?.marketplace_fees,   color: 'var(--color-warning)' },
                    { label: '− Shipping',         value: -data.waterfall?.shipping_cost,      color: 'var(--color-warning)' },
                    { label: '= Net Sales',        value: data.waterfall?.net_sales,           color: 'var(--color-primary)', bold: true },
                  ].map((row, i) => (
                    <div key={i} className="d-flex justify-content-between align-items-center py-2" style={{ borderBottom: i < 5 ? '1px solid var(--color-border)' : 'none' }}>
                      <span style={{ fontWeight: row.bold ? 700 : 400, fontSize: '0.875rem' }}>{row.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: row.color, fontWeight: row.bold ? 700 : 600, fontSize: '0.9rem' }}>
                        {fmt(Math.abs(row.value || 0), currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* RTO top states */}
            <div className="col-12 col-xl-6">
              <div className="card">
                <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Top RTO States (90d)</span></div>
                <div className="card-body p-0">
                  <table className="table ardent-table mb-0">
                    <thead><tr><th>State</th><th>RTO %</th><th>Recommendation</th></tr></thead>
                    <tbody>
                      {(data.top_rto_states || []).map((s, i) => (
                        <tr key={i}>
                          <td>{s.state}</td>
                          <td><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: s.rto_pct > 20 ? 'var(--color-destructive)' : s.rto_pct > 10 ? 'var(--color-warning)' : 'var(--color-success)' }}>{s.rto_pct}%</span></td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--color-muted-fg)' }}>{s.recommended_action.replace(/_/g, ' ')}</td>
                        </tr>
                      ))}
                      {!data.top_rto_states?.length && <tr><td colSpan={3} className="text-center py-3" style={{ color: 'var(--color-muted-fg)' }}>No RTO data</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!loading && !data && (
        <div className="text-center py-5" style={{ color: 'var(--color-muted-fg)' }}>
          <Package size={40} style={{ marginBottom: 8 }} />
          <p>Connect a data source from Connectors to see your dashboard.</p>
        </div>
      )}
    </div>
  );
}
