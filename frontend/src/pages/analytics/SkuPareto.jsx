import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { getSkuPareto } from '../../api/analytics';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

export default function SkuPareto() {
  const { activeBrand } = useBrand();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!activeBrand) return;
    setLoading(true);
    getSkuPareto(activeBrand.id, days, 50).then(r => setData(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [activeBrand, days]);

  const chartData = data.slice(0, 15).map(d => ({ sku: d.sku, margin: d.margin, cumulative_pct: d.cumulative_pct }));

  return (
    <div>
      <PageHeader
        title="SKU Profit Pareto"
        subtitle="80/20 analysis — which SKUs drive the majority of your margin"
        actions={
          <div className="btn-group btn-group-sm">
            {[7, 14, 30, 90].map(d => (
              <button key={d} className={`btn ${days === d ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
        }
      />

      {loading ? <Spinner center /> : (
        <>
          <div className="card mb-4">
            <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Top 15 SKUs by Margin (with cumulative %)</span></div>
            <div className="card-body">
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <XAxis dataKey="sku" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                  <Tooltip formatter={(v, n) => n === 'cumulative_pct' ? [`${v}%`, 'Cumulative'] : [fmt(v), 'Margin']} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="margin" name="Margin" fill="var(--color-primary)" radius={[4,4,0,0]} />
                  <Line yAxisId="right" type="monotone" dataKey="cumulative_pct" name="Cumulative %" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-body p-0">
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                <table className="table ardent-table mb-0">
                  <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr><th>SKU</th><th>Product</th><th>Units</th><th>Revenue</th><th>Margin</th><th>% of Total</th><th>Cumulative</th></tr>
                  </thead>
                  <tbody>
                    {data.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600 }}>{r.sku}</td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product_name}</td>
                        <td>{r.units_sold}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(r.revenue)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmt(r.margin)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{r.margin_pct_of_total}%</td>
                        <td>
                          <span className={`badge badge-${r.cumulative_pct <= 80 ? 'success' : 'info'}`} style={{ borderRadius: '999px', padding: '2px 10px', fontFamily: 'var(--font-mono)' }}>
                            {r.cumulative_pct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!data.length && <tr><td colSpan={7} className="text-center py-4" style={{ color: 'var(--color-muted-fg)' }}>No SKU data for this period</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
