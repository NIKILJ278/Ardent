import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { getCampaignPerf } from '../../api/analytics';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { Flame } from 'lucide-react';

const fmt = (n) => n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

const ACTION_STYLE = {
  scale:   { badge: 'success', label: 'Scale' },
  cut:     { badge: 'danger',  label: 'Cut' },
  monitor: { badge: 'warning', label: 'Monitor' },
};

export default function Campaigns() {
  const { activeBrand } = useBrand();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(14);

  useEffect(() => {
    if (!activeBrand) return;
    setLoading(true);
    getCampaignPerf(activeBrand.id, days).then(r => setData(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [activeBrand, days]);

  const totalSpend = data.reduce((s, c) => s + (c.spend || 0), 0);
  const totalRev = data.reduce((s, c) => s + (c.revenue || 0), 0);
  const blendedRoas = totalSpend ? (totalRev / totalSpend).toFixed(2) : '—';

  return (
    <div>
      <PageHeader
        title="Campaign Performance"
        subtitle="Scale / Cut / Monitor decisions driven by ROAS"
        actions={
          <div className="btn-group btn-group-sm">
            {[7, 14, 30].map(d => (
              <button key={d} className={`btn ${days === d ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
        }
      />

      {loading ? <Spinner center /> : (
        <>
          <div className="row g-3 mb-4">
            <div className="col-6 col-md-3"><div className="kpi-card"><div className="kpi-label">Total Spend</div><div className="kpi-value">{fmt(totalSpend)}</div></div></div>
            <div className="col-6 col-md-3"><div className="kpi-card"><div className="kpi-label">Attributed Rev</div><div className="kpi-value">{fmt(totalRev)}</div></div></div>
            <div className="col-6 col-md-3"><div className="kpi-card"><div className="kpi-label">Blended ROAS</div><div className="kpi-value" style={{ color: blendedRoas >= 3 ? 'var(--color-success)' : 'var(--color-warning)' }}>{blendedRoas}x</div></div></div>
            <div className="col-6 col-md-3"><div className="kpi-card"><div className="kpi-label">Campaigns</div><div className="kpi-value">{data.length}</div></div></div>
          </div>

          <div className="card">
            <div className="card-body p-0">
              <table className="table ardent-table mb-0">
                <thead><tr><th>Platform</th><th>Campaign</th><th>Spend</th><th>Revenue</th><th>ROAS</th><th>CAC</th><th>Purchases</th><th>Action</th></tr></thead>
                <tbody>
                  {data.map((c, i) => {
                    const style = ACTION_STYLE[c.action] || ACTION_STYLE.monitor;
                    return (
                      <tr key={i}>
                        <td><span className="badge badge-info" style={{ borderRadius: '999px', padding: '2px 10px', fontSize: '0.7rem' }}>{c.platform}</span></td>
                        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.campaign_name}
                          {c.creative_fatigue && <Flame size={14} color="var(--color-destructive)" style={{ marginLeft: 6 }} title="Creative fatigue (freq > 3)" />}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(c.spend)}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(c.revenue)}</td>
                        <td><span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: c.roas >= 3 ? 'var(--color-success)' : c.roas < 1.2 ? 'var(--color-destructive)' : 'var(--color-warning)' }}>{c.roas}x</span></td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{fmt(c.cac)}</td>
                        <td>{c.purchases}</td>
                        <td><span className={`badge badge-${style.badge}`} style={{ borderRadius: '999px', padding: '3px 12px', fontSize: '0.75rem' }}>{style.label}</span></td>
                      </tr>
                    );
                  })}
                  {!data.length && <tr><td colSpan={8} className="text-center py-4" style={{ color: 'var(--color-muted-fg)' }}>No campaign data for this period</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
