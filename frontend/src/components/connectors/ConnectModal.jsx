import { useState } from 'react';
import { RefreshCw, ShoppingBag, UploadCloud, ExternalLink, KeyRound, Eye, EyeOff } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Modal } from '../ui/index.jsx';

/* ── Credentials form ─────────────────────────────────────────────────────
   Built straight from the catalogue entry the server sent: one input per
   field, in the type and order the platform actually needs. Nothing here is
   platform-specific — adding a field on the server is enough to show it. */

function CredentialField({ f, value, onChange }) {
  const [showSecret, setShowSecret] = useState(false);
  const common = {
    id: `cf-${f.key}`,
    className: 'input',
    value: value ?? '',
    onChange: e => onChange(f.key, e.target.value),
    placeholder: f.secret && value === '' ? f.placeholder || '' : f.placeholder,
  };
  return (
    <div>
      <label className="label" htmlFor={common.id}>
        {f.label}{f.required && <span style={{ color: 'var(--critical-ink)' }}> *</span>}
      </label>
      {f.options ? (
        <select {...common}>
          {!f.required && <option value="">—</option>}
          {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.secret ? (
        <div className="password-input-wrap">
          <input {...common} type={showSecret ? 'text' : 'password'} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <button
            type="button"
            className="eye-btn"
            title={showSecret ? 'Hide secret' : 'Show secret'}
            onClick={() => setShowSecret(s => !s)}
          >
            {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      ) : (
        <input {...common} type="text" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      )}
      {f.help && <div className="source-hint" style={{ marginTop: 5 }}>{f.help}</div>}
    </div>
  );
}

export function CredentialForm({ brandId, entry, connection, onConnected, onCancel }) {
  const hints = connection?.credential_hints || {};
  const [values, setValues] = useState(() => {
    const init = {};
    for (const f of entry.fields || []) {
      init[f.key] = f.secret ? '' : (hints[f.key] ?? (f.default ?? ''));
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (key, v) => setValues(prev => ({ ...prev, [key]: v }));

  const groupLabel = entry.one_of && entry.fields
    ? entry.one_of.map(group => group.map(k => entry.fields.find(f => f.key === k)?.label || k).join(' + ')).join(' or ')
    : null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...values };
      if (connection) body.connection_id = connection.id;
      const data = await api.post(`/api/brands/${brandId}/connectors/${entry.id}/credentials`, body);
      onConnected(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="vstack" style={{ gap: 12 }} onSubmit={submit}>
      {groupLabel && (
        <div className="source-hint">Provide either {groupLabel}.</div>
      )}
      {connection && (
        <div className="source-hint">
          Fields already saved show their current value. Leave a secret field blank to keep the one on file.
        </div>
      )}
      {(entry.fields || []).map(f => (
        <CredentialField key={f.key} f={f} value={values[f.key]} onChange={set} />
      ))}

      {entry.docs && (
        <a className="tiny" href={entry.docs} target="_blank" rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}>
          <ExternalLink size={11} /> Where to find these in {entry.name}
        </a>
      )}
      {entry.notes && <div className="source-hint">{entry.notes}</div>}

      {error && <div className="auth-error">{error}</div>}

      <div className="hstack" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? <RefreshCw size={14} className="spin" /> : <KeyRound size={14} />}
          {busy ? 'Testing…' : connection ? 'Update & test' : 'Connect'}
        </button>
      </div>
    </form>
  );
}

/* ── Shopify: just the store domain and an Admin API token ───────────────
   Shopify's catalogue entry also has a client-ID/secret pair for a public
   app, but the fastest working path — and the one most stores actually
   have — is a custom app's Admin API access token, so that's the form shown
   by default. */

export function ShopifyKeyForm({ brandId, connection, onConnected, onCancel }) {
  const hints = connection?.credential_hints || {};
  const [shop, setShop] = useState(hints.shop || '');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { shop: shop.trim(), admin_api_token: token.trim() };
      if (connection) body.connection_id = connection.id;
      const data = await api.post(`/api/brands/${brandId}/connectors/shopify/credentials`, body);
      onConnected(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="vstack" style={{ gap: 12 }} onSubmit={submit}>
      <div>
        <label className="label" htmlFor="shopify-domain">Store domain</label>
        <input
          id="shopify-domain" className="input" value={shop} onChange={e => setShop(e.target.value)}
          placeholder="yourstore.myshopify.com" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        />
        <div className="source-hint" style={{ marginTop: 5 }}>
          The permanent <code>.myshopify.com</code> domain, not your custom domain.
        </div>
      </div>
      <div>
        <label className="label" htmlFor="shopify-token">Admin API access token</label>
        <div className="password-input-wrap">
          <input
            id="shopify-token" className="input" type={showToken ? 'text' : 'password'} value={token}
            onChange={e => setToken(e.target.value)} placeholder={connection ? '•••• leave blank to keep' : 'shpat_…'}
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
          />
          <button
            type="button"
            className="eye-btn"
            title={showToken ? 'Hide token' : 'Show token'}
            onClick={() => setShowToken(s => !s)}
          >
            {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <div className="source-hint" style={{ marginTop: 5 }}>
          Shopify admin → Settings → Apps and sales channels → Develop apps → create an app →
          Configuration → give it read access to orders, products, inventory and customers →
          Install app → API credentials → reveal the Admin API access token.
        </div>
      </div>

      {error && <div className="auth-error">{error}</div>}

      <div className="hstack" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button className="btn btn-primary" type="submit" disabled={!shop.trim() || (!connection && !token.trim()) || busy}>
          {busy ? <RefreshCw size={14} className="spin" /> : <KeyRound size={14} />}
          {busy ? 'Testing…' : connection ? 'Update & test' : 'Connect store'}
        </button>
      </div>
    </form>
  );
}

/* ── Shopify's own OAuth install, kept as an alternative ──────────────────── */

export function ShopifyOAuthForm({ brandId, onCancel }) {
  const [shop, setShop] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const connect = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { authorize_url } = await api.post(`/api/brands/${brandId}/shopify/start`, { shop: shop.trim() });
      window.location.href = authorize_url;
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="vstack" style={{ gap: 12 }} onSubmit={connect}>
      <div>
        <label className="label">Store domain</label>
        <input
          className="input" value={shop} onChange={e => setShop(e.target.value)}
          placeholder="yourstore.myshopify.com" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        />
        <div className="source-hint" style={{ marginTop: 6 }}>
          You will be sent to Shopify to approve read access to orders, products, inventory and customers.
        </div>
      </div>
      {error && <div className="auth-error">{error}</div>}
      <div className="hstack" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button className="btn btn-primary" type="submit" disabled={!shop.trim() || busy}>
          {busy ? <RefreshCw size={14} className="spin" /> : <ShoppingBag size={14} />}
          {busy ? 'Opening Shopify…' : 'Connect store'}
        </button>
      </div>
    </form>
  );
}

/* ── Report upload, with column mapping if the file's headers are unknown ── */

export function FileImportForm({ brandId, entry, onConnected, onCancel }) {
  const [file, setFile] = useState(null);
  const [mapping, setMapping] = useState({});
  const [needsMapping, setNeedsMapping] = useState(null); // { headers, fields }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e, mappingOverride) => {
    e?.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const useMapping = mappingOverride ?? mapping;
      if (Object.keys(useMapping).length) form.append('mapping', JSON.stringify(useMapping));
      const data = await api.upload(`/api/brands/${brandId}/connectors/${entry.id}/import`, form);
      onConnected(data.connection || data);
    } catch (err) {
      if (err.code === 'mapping_needed' && err.details) {
        setNeedsMapping(err.details);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const setMap = (key, header) => setMapping(prev => ({ ...prev, [key]: header }));

  return (
    <form className="vstack" style={{ gap: 12 }} onSubmit={submit}>
      <div>
        <label className="label">Report file</label>
        <input
          className="input" type="file" accept=".csv,.xls,.xlsx"
          onChange={e => { setFile(e.target.files?.[0] || null); setNeedsMapping(null); setError(null); }}
        />
        {(entry.import_fields?.length > 0) && (
          <div className="source-hint" style={{ marginTop: 6 }}>
            Expected columns include {entry.import_fields.filter(f => f.required).map(f => f.label).join(', ')}.
            Column names can differ — Ardent matches them by meaning and asks if it cannot.
          </div>
        )}
      </div>

      {needsMapping && (
        <div className="vstack" style={{ gap: 10, padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            Some columns couldn't be matched. Point each one at a column from your file.
          </div>
          {(needsMapping.fields || []).filter(f => needsMapping.missing?.includes(f.key)).map(f => (
            <div key={f.key}>
              <label className="label">{f.label}{f.required && <span style={{ color: 'var(--critical-ink)' }}> *</span>}</label>
              <select className="input" value={mapping[f.key] || ''} onChange={e => setMap(f.key, e.target.value)}>
                <option value="">— choose a column —</option>
                {needsMapping.headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          ))}
          <button
            type="button" className="btn btn-sm"
            onClick={(e) => submit(e, mapping)}
            disabled={busy || (needsMapping.fields || [])
              .filter(f => needsMapping.missing?.includes(f.key) && f.required)
              .some(f => !mapping[f.key])}
          >
            {busy ? <RefreshCw size={12} className="spin" /> : <UploadCloud size={12} />}
            Use this mapping
          </button>
        </div>
      )}

      {error && <div className="auth-error">{error}</div>}

      {!needsMapping && (
        <div className="hstack" style={{ gap: 8, justifyContent: 'flex-end' }}>
          {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>}
          <button className="btn btn-primary" type="submit" disabled={!file || busy}>
            {busy ? <RefreshCw size={14} className="spin" /> : <UploadCloud size={14} />}
            {busy ? 'Uploading…' : 'Upload report'}
          </button>
        </div>
      )}
    </form>
  );
}

/* ── The modal that picks the right form for a platform ───────────────────
   Shopify gets both: the one-click store install and, folded away, the raw
   API-credentials form for the cases (a private app, a non-org store) the
   install flow doesn't cover. Everything else gets exactly the one form its
   `auth` calls for. */

export default function ConnectModal({ brandId, entry, connection, onClose, onConnected }) {
  // Shopify has three ways in: the key form (default), the click-through
  // install, and the full form for a public app's client ID/secret pair.
  const [shopifyMode, setShopifyMode] = useState('key');

  const handleConnected = (data) => {
    onConnected(data);
    onClose();
  };

  const isShopify = entry.id === 'shopify' && entry.auth === 'credentials';

  return (
    <Modal title={connection ? `Update ${entry.name}` : `Connect ${entry.name}`} onClose={onClose}>
      <div className="vstack" style={{ gap: 14 }}>
        {entry.provides?.length > 0 && (
          <div className="tiny muted">Unlocks {entry.provides.join(', ')}.</div>
        )}

        {entry.auth === 'file' && (
          <FileImportForm brandId={brandId} entry={entry} onConnected={handleConnected} onCancel={onClose} />
        )}

        {isShopify && shopifyMode === 'key' && (
          <>
            <ShopifyKeyForm brandId={brandId} connection={connection} onConnected={handleConnected} onCancel={onClose} />
            {!connection && (
              <div className="hstack" style={{ gap: 14 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShopifyMode('oauth')}>
                  Connect by installing the app instead
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShopifyMode('full')}>
                  Use a client ID and secret instead
                </button>
              </div>
            )}
          </>
        )}

        {isShopify && shopifyMode === 'oauth' && (
          <>
            <ShopifyOAuthForm brandId={brandId} onCancel={onClose} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShopifyMode('key')}>
              Use store domain and API token instead
            </button>
          </>
        )}

        {isShopify && shopifyMode === 'full' && (
          <>
            <CredentialForm
              brandId={brandId} entry={entry} connection={connection}
              onConnected={handleConnected} onCancel={onClose}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShopifyMode('key')}>
              Use store domain and API token instead
            </button>
          </>
        )}

        {entry.auth === 'credentials' && !isShopify && (
          <CredentialForm
            brandId={brandId} entry={entry} connection={connection}
            onConnected={handleConnected} onCancel={onClose}
          />
        )}
      </div>
    </Modal>
  );
}
