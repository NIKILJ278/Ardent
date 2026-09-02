import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { listConnectors, getAuthorizeUrl, triggerSync, syncAll, disconnectConn } from '../../api/connectors';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { RefreshCw, Plug, Check, X, AlertCircle } from 'lucide-react';

const PLATFORM_META = {
  shopify:     { label: 'Shopify',      abbr: 'SH', oauth: true },
  meta_ads:    { label: 'Meta Ads',     abbr: 'MA', oauth: true },
  google_ads:  { label: 'Google Ads',   abbr: 'GA', oauth: true },
  ga4:         { label: 'GA4',          abbr: 'G4', oauth: true },
  instagram:   { label: 'Instagram',    abbr: 'IG', oauth: true },
  amazon:      { label: 'Amazon',       abbr: 'AZ', oauth: false },
  flipkart:    { label: 'Flipkart',     abbr: 'FK', oauth: false },
  myntra:      { label: 'Myntra',       abbr: 'MY', oauth: false },
  unicommerce: { label: 'Unicommerce',  abbr: 'UC', oauth: false },
  judgeme:     { label: 'Judge.me',     abbr: 'JM', oauth: false },
  ithink:      { label: 'iThink Logistics', abbr: 'IT', oauth: false },
};

const STATUS_STYLE = {
  connected:    { badge: 'success', label: 'Connected',   icon: Check },
  syncing:      { badge: 'info',    label: 'Syncing…',    icon: RefreshCw },
  error:        { badge: 'danger',  label: 'Error',       icon: AlertCircle },
  disconnected: { badge: 'warning', label: 'Disconnected', icon: X },
};

export default function Connectors() {
  const { activeBrand } = useBrand();
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);

  const load = () => {
    if (!activeBrand) return;
    setLoading(true);
    listConnectors(activeBrand.id).then(r => setCatalog(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, [activeBrand]);

  const showToast = (msg, type = 'info') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const handleConnect = async (platform) => {
    setBusy(platform);
    try {
      const r = await getAuthorizeUrl(activeBrand.id, platform);
      const url = r.data.data?.authorize_url;
      if (url) window.open(url, '_blank', 'width=600,height=700');
      showToast(`Opened ${PLATFORM_META[platform]?.label} authorization. Complete it, then sync.`, 'info');
    } catch (err) {
      showToast(err.response?.data?.message || 'Could not start OAuth flow', 'danger');
    } finally { setBusy(null); }
  };

  const handleSync = async (connectionId, platform) => {
    setBusy(platform);
    try {
      await triggerSync(activeBrand.id, connectionId);
      showToast(`${PLATFORM_META[platform]?.label} synced`, 'success');
      load();
    } catch (err) {
      showToast(err.response?.data?.message || 'Sync failed', 'danger');
    } finally { setBusy(null); }
  };

  const handleDisconnect = async (connectionId, platform) => {
    if (!window.confirm(`Disconnect ${PLATFORM_META[platform]?.label}?`)) return;
    setBusy(platform);
    try {
      await disconnectConn(activeBrand.id, connectionId);
      showToast(`${PLATFORM_META[platform]?.label} disconnected`, 'warning');
      load();
    } catch (err) {
      showToast(err.response?.data?.message || 'Disconnect failed', 'danger');
    } finally { setBusy(null); }
  };

  const handleSyncAll = async () => {
    setBusy('__all__');
    try {
      await syncAll(activeBrand.id);
      showToast('All connected sources synced', 'success');
      load();
    } catch (err) {
      showToast(err.response?.data?.message || 'Sync-all failed', 'danger');
    } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader
        title="Connectors"
        subtitle="Connect your stores, ad platforms, marketplaces and logistics"
        actions={<button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={handleSyncAll} disabled={busy === '__all__'}>
          <RefreshCw size={15} className={busy === '__all__' ? 'spin' : ''} /> Sync All
        </button>}
      />

      {toast && (
        <div className={`alert alert-${toast.type === 'success' ? 'success' : toast.type === 'danger' ? 'danger' : toast.type === 'warning' ? 'warning' : 'info'} py-2 px-3`}
             style={{ fontSize: '0.875rem', borderRadius: 'var(--radius)' }}>
          {toast.msg}
        </div>
      )}

      {loading ? <Spinner center /> : (
        <div className="row g-3">
          {catalog.map(({ platform, connected, connection }) => {
            const meta = PLATFORM_META[platform] || { label: platform, abbr: platform.slice(0, 2).toUpperCase() };
            const status = connection?.status || (connected ? 'connected' : 'disconnected');
            const st = STATUS_STYLE[status] || STATUS_STYLE.disconnected;
            const StIcon = st.icon;
            return (
              <div className="col-12 col-md-6 col-xl-4" key={platform}>
                <div className="connector-card">
                  <div className="connector-icon">{meta.abbr}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="d-flex align-items-center gap-2">
                      <span style={{ fontWeight: 600 }}>{meta.label}</span>
                      <span className={`badge badge-${st.badge}`} style={{ borderRadius: '999px', padding: '2px 8px', fontSize: '0.68rem', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <StIcon size={11} /> {st.label}
                      </span>
                    </div>
                    {connection?.last_synced_at && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-muted-fg)', marginTop: 2 }}>
                        Last sync: {new Date(connection.last_synced_at).toLocaleString('en-IN')}
                      </div>
                    )}
                    {connection?.last_error && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-destructive)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={connection.last_error}>
                        {connection.last_error}
                      </div>
                    )}
                    <div className="d-flex gap-2 mt-2">
                      {connected ? (
                        <>
                          <button className="btn btn-outline-primary btn-sm py-0 px-2" style={{ fontSize: '0.78rem' }} disabled={busy === platform} onClick={() => handleSync(connection.id, platform)}>
                            <RefreshCw size={12} className={busy === platform ? 'spin' : ''} /> Sync
                          </button>
                          <button className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: '0.78rem' }} disabled={busy === platform} onClick={() => handleDisconnect(connection.id, platform)}>
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-primary btn-sm py-0 px-2 d-flex align-items-center gap-1" style={{ fontSize: '0.78rem' }} disabled={busy === platform} onClick={() => handleConnect(platform)}>
                          <Plug size={12} /> Connect
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {!catalog.length && <div className="col-12 text-center py-5" style={{ color: 'var(--color-muted-fg)' }}>No connectors available.</div>}
        </div>
      )}

      <style>{`.spin { animation: spin 0.7s linear infinite; }`}</style>
    </div>
  );
}
