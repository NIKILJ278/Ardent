import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { getCustomerSegments } from '../../api/analytics';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const SEGMENT_META = {
  champion: { color: '#15803D', label: 'Champions',  desc: '5+ orders, active last 60d' },
  loyal:    { color: '#1E40AF', label: 'Loyal',      desc: '2+ orders, active last 90d' },
  new:      { color: '#3B82F6', label: 'New',        desc: '1 order, last 30d' },
  regular:  { color: '#0E7490', label: 'Regular',    desc: 'Recent, moderate frequency' },
  at_risk:  { color: '#D97706', label: 'At Risk',    desc: 'No order in 90-180d' },
  lost:     { color: '#DC2626', label: 'Lost',       desc: 'No order in 180d+' },
};

export default function Customers() {
  const { activeBrand } = useBrand();
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeBrand) return;
    setLoading(true);
    getCustomerSegments(activeBrand.id).then(r => setData(r.data.data || {})).catch(() => {}).finally(() => setLoading(false));
  }, [activeBrand]);

  const total = Object.values(data).reduce((s, v) => s + v, 0);
  const chartData = Object.entries(data).map(([seg, count]) => ({
    name: SEGMENT_META[seg]?.label || seg, value: count, color: SEGMENT_META[seg]?.color || '#94A3B8',
  }));

  return (
    <div>
      <PageHeader title="Customer Segments (RFM)" subtitle="Recency-Frequency-Monetary segmentation of your customer base" />

      {loading ? <Spinner center /> : total === 0 ? (
        <div className="card"><div className="card-body text-center py-5" style={{ color: 'var(--color-muted-fg)' }}>No customer data yet. Sync a store connector to populate segments.</div></div>
      ) : (
        <div className="row g-3">
          <div className="col-12 col-xl-5">
            <div className="card h-100">
              <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Segment Distribution</span></div>
              <div className="card-body">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} innerRadius={55} paddingAngle={2}>
                      {chartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [`${v} customers`, n]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                <div className="text-center" style={{ marginTop: -180, marginBottom: 140, pointerEvents: 'none' }}>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{total}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)' }}>Total</div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-12 col-xl-7">
            <div className="row g-3">
              {Object.entries(SEGMENT_META).map(([seg, meta]) => (
                <div key={seg} className="col-6">
                  <div className="kpi-card" style={{ borderLeft: `4px solid ${meta.color}` }}>
                    <div className="kpi-label" style={{ color: meta.color }}>{meta.label}</div>
                    <div className="kpi-value">{data[seg] || 0}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-muted-fg)', marginTop: 4 }}>{meta.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
