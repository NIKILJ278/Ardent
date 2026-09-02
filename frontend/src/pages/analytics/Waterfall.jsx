import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { getWaterfall } from '../../api/analytics';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.abs(n || 0));

export default function Waterfall() {
  const { activeBrand } = useBrand();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!activeBrand) return;
    setLoading(true);
    getWaterfall(activeBrand.id, days).then(r => setData(r.data.data)).catch(() => {}).finally(() => setLoading(false));
  }, [activeBrand, days]);

  const bars = data ? [
    { name: 'Gross Sales',     value: data.gross_sales,             color: '#15803D', type: 'positive' },
    { name: 'Discounts',       value: data.discounts,               color: '#DC2626', type: 'negative' },
    { name: 'Returns / RTO',   value: data.returns_rto_value_lost,  color: '#DC2626', type: 'negative' },
    { name: 'Mkt Fees',        value: data.marketplace_fees,        color: '#D97706', type: 'negative' },
    { name: 'Shipping',        value: data.shipping_cost,           color: '#D97706', type: 'negative' },
    { name: 'Net Sales',       value: data.net_sales,               color: '#1E40AF', type: 'result' },
  ] : [];

  return (
    <div>
      <PageHeader
        title="Gross-to-Net Waterfall"
        subtitle="Track how revenue is eroded from gross to net sales"
        actions={
          <div className="btn-group btn-group-sm">
            {[7, 14, 30, 90].map(d => (
              <button key={d} className={`btn ${days === d ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
        }
      />

      {loading ? <Spinner center /> : data && (
        <>
          {/* Waterfall chart */}
          <div className="card mb-4">
            <div className="card-body">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={bars} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => [fmt(v)]} />
                  <Bar dataKey="value" radius={[4,4,0,0]}>
                    {bars.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="row g-3">
            {/* Waterfall table */}
            <div className="col-12 col-xl-7">
              <div className="card">
                <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Revenue Breakdown</span></div>
                <div className="card-body">
                  {bars.map((row, i) => (
                    <div key={i} className="d-flex justify-content-between align-items-center py-2" style={{ borderBottom: i < bars.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                      <span style={{ fontWeight: row.type === 'result' ? 700 : 400, fontSize: '0.875rem' }}>
                        {row.type === 'negative' ? '− ' : row.type === 'result' ? '= ' : ''}{row.name}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: row.color, fontWeight: row.type === 'result' ? 700 : 600 }}>
                        {fmt(row.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Order health */}
            <div className="col-12 col-xl-5">
              <div className="card">
                <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Order Health</span></div>
                <div className="card-body d-flex flex-column gap-3">
                  {[
                    { label: 'Total Orders',       value: data.total_orders?.toLocaleString('en-IN'), color: 'var(--color-text)' },
                    { label: 'Cancelled',          value: `${data.cancelled_orders} (${data.cancellation_rate_pct}%)`, color: 'var(--color-destructive)' },
                    { label: 'RTO',                value: data.rto_orders, color: 'var(--color-warning)' },
                    { label: 'Returned',           value: data.returned_orders, color: 'var(--color-warning)' },
                  ].map((row, i) => (
                    <div key={i} className="d-flex justify-content-between">
                      <span style={{ fontSize: '0.875rem', color: 'var(--color-muted-fg)' }}>{row.label}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: row.color }}>{row.value}</span>
                    </div>
                  ))}

                  {data.payment_mix && Object.keys(data.payment_mix).length > 0 && (
                    <>
                      <hr style={{ borderColor: 'var(--color-border)' }} />
                      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Payment Mix</div>
                      {Object.entries(data.payment_mix).map(([mode, count], i) => (
                        <div key={i} className="d-flex justify-content-between">
                          <span style={{ fontSize: '0.875rem' }}>{mode}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{count}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
