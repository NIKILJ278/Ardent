import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  RefreshCw, Plug, CheckCircle2, AlertTriangle, Clock, Settings2, Unlink, PlusCircle,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useSession } from '../state/Session.jsx';
import { api } from '../lib/api.js';
import { num, relativeTime } from '../lib/format.js';
import { Card, Pill } from '../components/ui/index.jsx';
import ConnectModal from '../components/connectors/ConnectModal.jsx';

/* ── What Shopify's callback told us ───────────────────────────────────────
   Shopify sends the browser back to /sources with the outcome in the query
   string, because the redirect cannot carry a login token. Each failure names
   the actual reason rather than a generic "something went wrong".
   ──────────────────────────────────────────────────────────────────────── */

const CALLBACK_REASON = {
  signature: 'The callback signature did not verify, so the request was not trusted. Start the connection again.',
  expired: 'The consent screen sat open too long. Start the connection again.',
  state: 'The install did not start from this dashboard. Start the connection again.',
  shop: 'The store that approved the install was not the one the install started for.',
  code: 'Shopify did not return an authorization code.',
  exchange: 'Shopify refused to exchange the code for an access token. Check the app credentials on the server.',
};

function CallbackBanner({ onDismiss }) {
  const [params, setParams] = useSearchParams();
  const result = params.get('shopify');
  if (!result) return null;

  const shop = params.get('shop');
  const reason = params.get('reason');

  const clear = () => {
    const next = new URLSearchParams(params);
    next.delete('shopify'); next.delete('shop'); next.delete('reason');
    setParams(next, { replace: true });
    onDismiss?.();
  };

  return result === 'connected' ? (
    <div className="banner good">
      <CheckCircle2 size={15} />
      <span>{shop ? `${shop} is connected.` : 'Your store is connected.'} Run a sync to pull its orders.</span>
      <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={clear}>Dismiss</button>
    </div>
  ) : (
    <div className="banner critical">
      <AlertTriangle size={15} />
      <span>{CALLBACK_REASON[reason] ?? 'The connection did not complete.'}</span>
      <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={clear}>Dismiss</button>
    </div>
  );
}

const STATUS_STYLE = {
  connected:    { label: 'Connected',       tone: 'good' },
  syncing:      { label: 'Syncing',         tone: 'info' },
  error:        { label: 'Needs Attention', tone: 'critical' },
  disconnected: { label: 'Disconnected',    tone: 'neutral' },
  pending:      { label: 'Pending',         tone: 'neutral' },
};

/* ── A connected source: sync, or fix and reconnect if it's erroring ─────── */

function ConnectedCard({ conn, entry, canManage, onSync, syncing, onManage, onDisconnect }) {
  const st = STATUS_STYLE[conn.status] || STATUS_STYLE.disconnected;
  const isFile = entry?.auth === 'file';
  return (
    <div className="card2">
      <div className="card2-body">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div className="hstack" style={{ gap: 10, minWidth: 0 }}>
            <span className="avatar" style={{ borderRadius: 8, background: 'var(--surface-3)' }}>
              <Plug size={14} style={{ color: 'var(--ink-2)' }} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                {conn.display_name || entry?.name || conn.platform}
              </div>
              <div className="tiny muted">
                {entry?.category || conn.platform}
                {conn.external_account_id && conn.platform !== 'shopify' && ` · ${conn.external_account_id}`}
              </div>
              {conn.meta?.currency && (
                <div className="tiny muted">
                  Reports in {conn.meta.currency}
                  {conn.meta.timezone && ` · books days in ${conn.meta.timezone}`}
                </div>
              )}
            </div>
          </div>
          <Pill tone={st.tone}>{st.label}</Pill>
        </div>

        <div className="spread" style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
          <span className="tiny muted">
            {conn.last_synced_at ? `Last synced ${relativeTime(new Date(conn.last_synced_at))}` : 'Never synced'}
          </span>
          <div className="hstack" style={{ gap: 6 }}>
            {canManage && (
              <button className="btn btn-ghost btn-sm btn-icon" title="Update credentials" onClick={() => onManage(entry, conn)}>
                <Settings2 size={13} />
              </button>
            )}
            {!isFile && (
              <button className="btn btn-sm" onClick={() => onSync(conn)} disabled={syncing}>
                <RefreshCw size={12} className={syncing ? 'spin' : ''} />
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
            {canManage && (
              <button className="btn btn-ghost btn-sm btn-icon" title="Disconnect" onClick={() => onDisconnect(conn)}>
                <Unlink size={13} />
              </button>
            )}
          </div>
        </div>

        {conn.last_error && (
          <div className="tiny" style={{ marginTop: 9, color: `var(--${st.tone === 'critical' ? 'critical' : 'warning'}-ink)` }}>
            {conn.last_error}
            {canManage && entry?.auth === 'credentials' && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => onManage(entry, conn)}>
                Fix credentials
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── A not-yet-connected platform, grouped by category ────────────────────  */

function PlatformRow({ platform, canManage, onConnect }) {
  return (
    <div className="spread" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="hstack" style={{ gap: 10, minWidth: 0 }}>
        <span className="dot neutral" />
        <span style={{ minWidth: 0 }}>
          <span className="small" style={{ fontWeight: 500, display: 'block' }}>{platform.name}</span>
          <span className="tiny muted">Unlocks {platform.provides?.join(', ')}</span>
        </span>
      </span>
      <span className="hstack" style={{ gap: 8 }}>
        <span className="tiny muted">{platform.auth === 'file' ? 'Upload' : 'API'}</span>
        {canManage ? (
          <button className="btn btn-sm" onClick={() => onConnect(platform)}>
            <PlusCircle size={12} /> Connect
          </button>
        ) : (
          <Pill tone="neutral" icon={false}><Clock size={10} /> Not connected</Pill>
        )}
      </span>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function DataSources() {
  const { companyId, dataVersion } = useApp();
  const { loadFacts } = useSession();
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [syncing, setSyncing] = useState(null);
  const [syncNote, setSyncNote] = useState(null);
  const [modal, setModal] = useState(null); // { entry, connection? }
  const [params] = useSearchParams();

  const refresh = useCallback(async () => {
    try {
      const data = await api.get(`/api/brands/${companyId}/connectors`);
      setCatalog(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { setLoading(true); refresh(); }, [refresh, dataVersion]);

  // A fresh Shopify install lands back here with no facts loaded for the new
  // connection yet, so pull them, then re-read the connector list.
  useEffect(() => {
    if (params.get('shopify') === 'connected') {
      loadFacts(companyId);
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const platforms = catalog?.platforms || [];
  const canManage = catalog?.can_manage ?? false;
  const connected = useMemo(() => platforms.flatMap(p => (p.connections || []).map(c => ({ conn: c, entry: p }))
    .filter(x => x.conn.status !== 'disconnected')), [platforms]);
  const unconnectedByCategory = useMemo(() => {
    const groups = {};
    for (const p of platforms) {
      if (p.connected) continue;
      const cat = p.category || 'other';
      (groups[cat] = groups[cat] || []).push(p);
    }
    return groups;
  }, [platforms]);

  const sync = async (conn) => {
    setSyncing(conn.id);
    setSyncNote(null);
    try {
      const summary = await api.post(`/api/brands/${companyId}/connectors/${conn.id}/sync`);
      await loadFacts(companyId);
      await refresh();
      const counted = summary?.orders ?? summary?.synced ?? null;
      setSyncNote({
        tone: 'good',
        text: counted == null ? 'Synced.' : `Synced — ${num(counted)} record(s) processed.`,
      });
    } catch (err) {
      setSyncNote({ tone: 'critical', text: err.message });
      await refresh();
    } finally {
      setSyncing(null);
    }
  };

  const disconnect = async (conn) => {
    if (!window.confirm('Disconnect this source? Data already synced stays, but nothing new will come in until it is connected again.')) return;
    try {
      await api.del(`/api/brands/${companyId}/connectors/${conn.id}`);
      await refresh();
    } catch (err) {
      setSyncNote({ tone: 'critical', text: err.message });
    }
  };

  const onConnected = async () => {
    await refresh();
    await loadFacts(companyId);
  };

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Data Sources</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Where every number in Ardent comes from, and how fresh it is.
        </p>
      </div>

      <CallbackBanner onDismiss={refresh} />

      {syncNote && (
        <div className={`banner ${syncNote.tone}`}>
          {syncNote.tone === 'good' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{syncNote.text}</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSyncNote(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loadError && (
        <div className="banner critical">
          <AlertTriangle size={15} />
          <span>{loadError}</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={refresh}>Retry</button>
        </div>
      )}

      {!loading && connected.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
          {connected.map(({ conn, entry }) => (
            <ConnectedCard
              key={conn.id} conn={conn} entry={entry} canManage={canManage}
              syncing={syncing === conn.id}
              onSync={sync}
              onManage={(e, c) => setModal({ entry: e, connection: c })}
              onDisconnect={disconnect}
            />
          ))}
        </div>
      )}

      {!loading && connected.length === 0 && !loadError && (
        <Card title="Nothing connected yet" subtitle="Add a source below to start pulling real numbers into Ardent" />
      )}

      <Card title="Add a source" subtitle={canManage ? 'Every keystroke here is tested against the platform before anything is saved' : 'Ask an owner or admin to connect these'}>
        <div className="vstack" style={{ gap: 16 }}>
          {(catalog?.categories || []).map(cat => {
            const list = unconnectedByCategory[cat.id];
            if (!list || list.length === 0) return null;
            return (
              <div key={cat.id}>
                <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {cat.label}
                </div>
                <div className="vstack" style={{ gap: 2 }}>
                  {list.map(p => (
                    <PlatformRow key={p.id} platform={p} canManage={canManage} onConnect={(entry) => setModal({ entry })} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {modal && (
        <ConnectModal
          brandId={companyId}
          entry={modal.entry}
          connection={modal.connection}
          onClose={() => setModal(null)}
          onConnected={onConnected}
        />
      )}
    </div>
  );
}
