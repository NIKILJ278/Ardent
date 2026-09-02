import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { listAlerts, generateAlerts, markAlertRead } from '../../api/reports';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { Bell, Zap, Check, AlertTriangle, Info, AlertOctagon } from 'lucide-react';

const SEVERITY = {
  critical: { badge: 'danger',  icon: AlertOctagon,  color: 'var(--color-destructive)' },
  high:     { badge: 'danger',  icon: AlertTriangle, color: 'var(--color-destructive)' },
  warning:  { badge: 'warning', icon: AlertTriangle, color: 'var(--color-warning)' },
  medium:   { badge: 'warning', icon: AlertTriangle, color: 'var(--color-warning)' },
  info:     { badge: 'info',    icon: Info,          color: 'var(--color-secondary)' },
  low:      { badge: 'info',    icon: Info,          color: 'var(--color-secondary)' },
};

export default function Alerts() {
  const { activeBrand } = useBrand();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = () => {
    if (!activeBrand) return;
    setLoading(true);
    listAlerts(activeBrand.id, unreadOnly).then(r => setAlerts(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, [activeBrand, unreadOnly]);

  const handleGenerate = async () => {
    setGenerating(true);
    try { await generateAlerts(activeBrand.id); load(); } catch { /* ignore */ } finally { setGenerating(false); }
  };

  const handleRead = async (id) => {
    await markAlertRead(activeBrand.id, id);
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a));
  };

  const unreadCount = alerts.filter(a => !a.is_read).length;

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle={`${unreadCount} unread · Rules-based signals from your data`}
        actions={
          <div className="d-flex gap-2">
            <button className={`btn btn-sm ${unreadOnly ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setUnreadOnly(p => !p)}>
              {unreadOnly ? 'Showing Unread' : 'All Alerts'}
            </button>
            <button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={handleGenerate} disabled={generating}>
              <Zap size={15} /> {generating ? 'Generating…' : 'Generate'}
            </button>
          </div>
        }
      />

      {loading ? <Spinner center /> : (
        <div className="card">
          <div className="card-body p-0">
            {alerts.length === 0 ? (
              <div className="text-center py-5" style={{ color: 'var(--color-muted-fg)' }}>
                <Bell size={40} style={{ marginBottom: 8 }} />
                <p style={{ fontSize: '0.875rem' }}>No alerts. Click <strong>Generate</strong> to scan your latest data.</p>
              </div>
            ) : alerts.map(a => {
              const sev = SEVERITY[a.severity] || SEVERITY.info;
              const SevIcon = sev.icon;
              return (
                <div key={a.id} className="d-flex align-items-start gap-3 px-3 py-3"
                     style={{ borderBottom: '1px solid var(--color-border)', background: a.is_read ? 'transparent' : 'var(--color-muted)', borderLeft: `3px solid ${sev.color}` }}>
                  <SevIcon size={20} color={sev.color} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.title || a.alert_type || 'Alert'}</span>
                      <span className={`badge badge-${sev.badge}`} style={{ borderRadius: '999px', padding: '2px 8px', fontSize: '0.68rem' }}>{a.severity}</span>
                      {!a.is_read && <span className="badge badge-info" style={{ borderRadius: '999px', padding: '2px 8px', fontSize: '0.68rem' }}>new</span>}
                    </div>
                    {a.message && <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 3 }}>{a.message}</div>}
                    {a.created_at && <div style={{ fontSize: '0.72rem', color: 'var(--color-muted-fg)', marginTop: 3 }}>{new Date(a.created_at).toLocaleString('en-IN')}</div>}
                  </div>
                  {!a.is_read && (
                    <button className="btn btn-outline-primary btn-sm py-0 px-2 d-flex align-items-center gap-1" style={{ fontSize: '0.78rem', flexShrink: 0 }} onClick={() => handleRead(a.id)}>
                      <Check size={13} /> Mark read
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
