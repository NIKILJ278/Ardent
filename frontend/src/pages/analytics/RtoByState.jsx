import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { getStateMatrix } from '../../api/analytics';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';

const fmt = (n) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const ACTION_STYLE = {
  restrict_to_prepaid: { badge: 'danger',  label: 'Restrict to Prepaid' },
  monitor:             { badge: 'warning', label: 'Monitor' },
  none:                { badge: 'success', label: 'Healthy' },
};

export default function RtoByState() {
  const { activeBrand } = useBrand();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(90);

  useEffect(() => {
    if (!activeBrand) return;
    setLoading(true);
    getStateMatrix(activeBrand.id, days).then(r => setData(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [activeBrand, days]);

  const restrictCount = data.filter(s => s.recommended_action === 'restrict_to_prepaid').length;
  const monitorCount = data.filter(s => s.recommended_action === 'monitor').length;

  return (
    <div>
      <PageHeader
        title="RTO by State — Action Matrix"
        subtitle="Return-to-origin rates per state with recommended COD policies"
        actions={
          <div className="btn-group btn-group-sm">
            {[30, 60, 90, 180].map(d => (
              <button key={d} className={`btn ${days === d ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
        }
      />

      {loading ? <Spinner center /> : (
        <>
          <div className="row g-3 mb-4">
            <div className="col-6 col-md-3">
              <div className="kpi-card"><div className="kpi-label">States Tracked</div><div className="kpi-value">{data.length}</div></div>
            </div>
            <div className="col-6 col-md-3">
              <div className="kpi-card"><div className="kpi-label">Restrict Prepaid</div><div className="kpi-value" style={{ color: 'var(--color-destructive)' }}>{restrictCount}</div></div>
            </div>
            <div className="col-6 col-md-3">
              <div className="kpi-card"><div className="kpi-label">Monitor</div><div className="kpi-value" style={{ color: 'var(--color-warning)' }}>{monitorCount}</div></div>
            </div>
            <div className="col-6 col-md-3">
              <div className="kpi-card"><div className="kpi-label">Healthy</div><div className="kpi-value" style={{ color: 'var(--color-success)' }}>{data.length - restrictCount - monitorCount}</div></div>
            </div>
          </div>

          <div className="card">
            <div className="card-body p-0">
              <table className="table ardent-table mb-0">
                <thead><tr><th>State</th><th>Total Orders</th><th>RTO Orders</th><th>RTO %</th><th>Net Sales</th><th>Recommended Action</th></tr></thead>
                <tbody>
                  {data.map((s, i) => {
                    const style = ACTION_STYLE[s.recommended_action] || ACTION_STYLE.none;
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{s.state}</td>
                        <td>{s.total_orders?.toLocaleString('en-IN')}</td>
                        <td>{s.rto_orders}</td>
                        <td>
                          <div className="d-flex align-items-center gap-2">
                            <div style={{ width: 60, height: 6, background: 'var(--color-muted)', borderRadius: 3 }}>
                              <div style={{ width: `${Math.min(s.rto_pct, 100)}%`, height: '100%', background: s.rto_pct > 20 ? 'var(--color-destructive)' : s.rto_pct > 10 ? 'var(--color-warning)' : 'var(--color-success)', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s.rto_pct}%</span>
                          </div>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(s.net_sales)}</td>
                        <td>
                          <span className={`badge badge-${style.badge}`} style={{ borderRadius: '999px', padding: '3px 12px', fontSize: '0.75rem' }}>{style.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {!data.length && <tr><td colSpan={6} className="text-center py-4" style={{ color: 'var(--color-muted-fg)' }}>No RTO data for this period</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
