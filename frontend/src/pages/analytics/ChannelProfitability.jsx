import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { getChannelProfit } from '../../api/analytics';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const COLORS = ['#1E40AF','#3B82F6','#D97706','#0E7490','#15803D','#7C3AED','#DB2777'];

export default function ChannelProfitability() {
  const { activeBrand } = useBrand();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!activeBrand) return;
    setLoading(true);
    getChannelProfit(activeBrand.id, days).then(r => setData(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [activeBrand, days]);

  return (
    <div>
      <PageHeader
        title="Channel Profitability"
        subtitle="Net sales and margin breakdown by sales channel"
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
            <div className="card-body">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                  <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v, name) => [fmt(v), name === 'net_sales' ? 'Net Sales' : 'Net Margin']} />
                  <Legend />
                  <Bar dataKey="net_sales" name="Net Sales" radius={[4,4,0,0]}>
                    {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                  <Bar dataKey="net_margin" name="Net Margin" fill="var(--color-accent)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card">
            <div className="card-body p-0">
              <table className="table ardent-table mb-0">
                <thead><tr><th>Channel</th><th>Orders</th><th>Net Sales</th><th>Net Margin</th><th>Margin %</th><th>Share</th></tr></thead>
                <tbody>
                  {data.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{r.channel}</td>
                      <td>{r.orders?.toLocaleString('en-IN')}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(r.net_sales)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(r.net_margin)}</td>
                      <td>
                        <span style={{ color: r.margin_pct >= 20 ? 'var(--color-success)' : r.margin_pct >= 10 ? 'var(--color-warning)' : 'var(--color-destructive)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                          {r.margin_pct}%
                        </span>
                      </td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div style={{ flex: 1, height: 6, background: 'var(--color-muted)', borderRadius: 3 }}>
                            <div style={{ width: `${r.share_of_sales_pct}%`, height: '100%', background: COLORS[i % COLORS.length], borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{r.share_of_sales_pct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!data.length && <tr><td colSpan={6} className="text-center py-4" style={{ color: 'var(--color-muted-fg)' }}>No channel data for this period</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
