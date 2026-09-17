import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  RefreshCw, Plug, CheckCircle2, AlertTriangle, ShoppingBag, Clock,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useSession } from '../state/Session.jsx';
import { dataSources, SOURCE_STATUS, unconnectedSources } from '../data/business.js';
import { live } from '../data/live.js';
import { api } from '../lib/api.js';
import { num, relativeTime } from '../lib/format.js';
import { Card, Pill } from '../components/ui/index.jsx';

/* ── What the callback told us ─────────────────────────────────────────────
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

/* ── Connect a Shopify store ───────────────────────────────────────────── */

function ConnectShopify({ brandId }) {
  const [shop, setShop] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { authorize_url } = await api.post(`/api/brands/${brandId}/shopify/start`, { shop: shop.trim() });
      // Leaving the app entirely: Shopify's consent screen owns the next step.
      window.location.href = authorize_url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Card title="Connect Shopify" subtitle="Your store's orders become every figure in Ardent">
      <form className="vstack" style={{ gap: 12 }} onSubmit={connect}>
        <div>
          <label className="label">Store domain</label>
          <input
            className="input" value={shop} onChange={e => setShop(e.target.value)}
            placeholder="yourstore.myshopify.com" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          />
          <div className="source-hint" style={{ marginTop: 6 }}>
            Use the permanent <code>.myshopify.com</code> domain, not your custom domain. You will be
            sent to Shopify to approve read access to orders, products, inventory and customers.
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={!shop.trim() || busy}>
          {busy ? <RefreshCw size={14} className="spin" /> : <ShoppingBag size={14} />}
          {busy ? 'Opening Shopify…' : 'Connect store'}
        </button>
      </form>

      <div className="source-hint" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <strong style={{ color: 'var(--ink-2)' }}>Before you start:</strong> the callback URL in your
        Shopify app settings must exactly match the one this server uses —
        {' '}<code>/api/connectors/shopify/callback</code>. A private app can only read the last 60 days
        of orders unless it holds the <code>read_all_orders</code> scope, which Shopify grants on request.
      </div>
    </Card>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function DataSources() {
  const { companyId, dataVersion } = useApp();
  const { loadFacts } = useSession();
  const [syncing, setSyncing] = useState(null);
  const [syncNote, setSyncNote] = useState(null);
  const [justConnected, setJustConnected] = useState(false);
  const [params] = useSearchParams();

  const sources = useMemo(() => dataSources(), [dataVersion, justConnected]);
  const planned = useMemo(() => unconnectedSources(), [dataVersion]);

  // A fresh install lands back here with no facts loaded for the new
  // connection, so pull them once.
  useEffect(() => {
    if (params.get('shopify') === 'connected') loadFacts(companyId);
  }, [params, loadFacts, companyId]);

  const sync = async (source) => {
    setSyncing(source.id);
    setSyncNote(null);
    try {
      const summary = await api.post(`/api/brands/${companyId}/connectors/${source.id}/sync`);
      await loadFacts(companyId);
      const counted = summary?.orders ?? summary?.synced ?? null;
      setSyncNote({
        tone: 'good',
        text: counted == null
          ? `${source.name} synced.`
          : `${source.name} synced — ${num(counted)} order(s) processed.`,
      });
    } catch (err) {
      setSyncNote({ tone: 'critical', text: err.message });
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Data Sources</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Where every number in Ardent comes from, and how fresh it is.
        </p>
      </div>

      <CallbackBanner onDismiss={() => setJustConnected(true)} />

      {syncNote && (
        <div className={`banner ${syncNote.tone}`}>
          {syncNote.tone === 'good' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{syncNote.text}</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSyncNote(null)}>
            Dismiss
          </button>
        </div>
      )}

      {sources.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
          {sources.map(s => {
            const st = SOURCE_STATUS[s.status];
            return (
              <div className="card2" key={s.id}>
                <div className="card2-body">
                  <div className="spread" style={{ alignItems: 'flex-start' }}>
                    <div className="hstack" style={{ gap: 10, minWidth: 0 }}>
                      <span className="avatar" style={{ borderRadius: 8, background: 'var(--surface-3)' }}>
                        <Plug size={14} style={{ color: 'var(--ink-2)' }} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</div>
                        <div className="tiny muted">
                          {s.kind}
                          {s.records != null && ` · ${num(s.records)} order(s)`}
                        </div>
                        {/* Read from the store, not assumed: both decide how
                            every figure in Ardent is labelled and dated. */}
                        {s.connection?.meta?.currency && (
                          <div className="tiny muted">
                            Reports in {s.connection.meta.currency}
                            {s.connection.meta.timezone && ` · books days in ${s.connection.meta.timezone}`}
                          </div>
                        )}
                      </div>
                    </div>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </div>

                  <div className="spread" style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
                    <span className="tiny muted">
                      {s.lastSync ? `Last synced ${relativeTime(s.lastSync)}` : 'Never synced'}
                    </span>
                    <button className="btn btn-sm" onClick={() => sync(s)} disabled={syncing === s.id}>
                      <RefreshCw size={12} className={syncing === s.id ? 'spin' : ''} />
                      {syncing === s.id ? 'Syncing…' : 'Sync now'}
                    </button>
                  </div>

                  {s.message && (
                    <div className="tiny" style={{
                      marginTop: 9, color: `var(--${st.tone === 'critical' ? 'critical' : 'warning'}-ink)`,
                    }}>
                      {s.message}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConnectShopify brandId={companyId} />

      {live.meta.costCoverage != null && live.meta.costCoverage < 1 && (
        <Card title="Unit costs" subtitle="What is missing before margin can be reported">
          <p className="small" style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            {(live.meta.costCoverage * 100).toFixed(0)}% of the units you sold carry a cost per item
            in Shopify. Cost of goods and gross margin stay withheld until every sold unit has one —
            a partial cost would understate what you spend and overstate what you keep. Set the cost
            per item on each variant in Shopify, then sync again.
          </p>
        </Card>
      )}

      <Card title="Not yet connected" subtitle="What each one would unlock">
        <div className="vstack" style={{ gap: 2 }}>
          {planned.map(p => (
            <div className="spread" key={p.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="hstack" style={{ gap: 10, minWidth: 0 }}>
                <span className="dot neutral" />
                <span style={{ minWidth: 0 }}>
                  <span className="small" style={{ fontWeight: 500, display: 'block' }}>{p.name}</span>
                  <span className="tiny muted">{p.unlocks}</span>
                </span>
              </span>
              <span className="hstack" style={{ gap: 8 }}>
                <span className="tiny muted">{p.kind}</span>
                <Pill tone="neutral" icon={false}><Clock size={10} /> Planned</Pill>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
