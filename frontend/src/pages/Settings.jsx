import { useState } from 'react';
import { RotateCcw, Plus, LogOut, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useSession } from '../state/Session.jsx';
import { PERIOD_PRESETS, COMPARISON_MODES } from '../data/engine.js';
import { DIMENSION_BY_ID, HEALTH_SLOTS } from '../data/health.js';
import {
  OVERVIEW_SECTIONS, OVERVIEW_SECTION_BY_ID, OVERVIEW_KPIS, OVERVIEW_KPI_BY_ID, OVERVIEW_KPI_SLOTS,
} from '../data/overview.js';
import { Card, Segmented, Pill, Modal } from '../components/ui/index.jsx';

/* ── Reorder / remove / add-back, for a list of chosen ids ────────────────
 * The same shape as Company Health's indicator chooser: a numbered "chosen"
 * list with move/remove, and a grid of everything else to add back. `max`
 * caps how many can be chosen at once; omit it for no cap (sections, unlike
 * the four-slot KPI strip, can be as many or as few as make sense). */
function ListPicker({ chosen, setChosen, all, byId, max, minLabel }) {
  const full = max != null && chosen.length >= max;

  // setChosen (setOverviewLayout / setOverviewKpis) takes the next array
  // directly, not a React updater function — it re-normalises whatever it is
  // given, so each call works off the `chosen` this render already has.
  const toggle = (id) => setChosen(
    chosen.includes(id) ? chosen.filter(x => x !== id)
      : max != null && chosen.length >= max ? chosen
      : [...chosen, id]
  );
  const move = (id, by) => {
    const i = chosen.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    setChosen(next);
  };
  const remove = (id) => {
    if (chosen.length <= 1 && minLabel) return; // never an empty page
    toggle(id);
  };

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div>
        {max != null && (
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="tiny muted">{chosen.length} of {max} chosen</span>
          </div>
        )}
        <div className="vstack" style={{ gap: 6 }}>
          {chosen.map((id, i) => {
            const item = byId[id];
            if (!item) return null;
            return (
              <div className="hd-chosen" key={id}>
                <span className="hd-ord tnum">{i + 1}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{item.label ?? 'Growth'}</span>
                  {item.blurb && <span className="tiny muted" style={{ display: 'block' }}>{item.blurb}</span>}
                </span>
                <span className="hstack" style={{ gap: 2 }}>
                  <button className="btn btn-ghost btn-icon btn-sm" title="Move up"
                          disabled={i === 0} onClick={() => move(id, -1)}>
                    <ChevronUp size={13} />
                  </button>
                  <button className="btn btn-ghost btn-icon btn-sm" title="Move down"
                          disabled={i === chosen.length - 1} onClick={() => move(id, 1)}>
                    <ChevronDown size={13} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm" title="Remove"
                    disabled={chosen.length <= 1 && !!minLabel}
                    onClick={() => remove(id)}
                  >
                    <X size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        {chosen.length <= 1 && minLabel && (
          <div className="tiny muted" style={{ marginTop: 6 }}>{minLabel}</div>
        )}
      </div>

      {chosen.length < all.length && (
        <div>
          <div className="section-title">Not shown</div>
          <div className="hd-grid">
            {all.filter(item => !chosen.includes(item.id)).map(item => (
              <button
                key={item.id} type="button" className="hd-card"
                disabled={full} onClick={() => toggle(item.id)}
                title={full ? `Remove one first — the strip holds ${max}` : item.blurb}
              >
                <span className="spread" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{item.label ?? 'Growth'}</span>
                  <Plus size={14} className="muted" style={{ flex: 'none' }} />
                </span>
                {item.blurb && <span className="tiny" style={{ color: 'var(--ink-2)' }}>{item.blurb}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AddBrand({ onClose }) {
  const { createBrand } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await createBrand(name);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a brand"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="brand-form" type="submit" disabled={!name.trim() || busy}>
            Create brand
          </button>
        </>
      }
    >
      <form id="brand-form" className="vstack" style={{ gap: 12 }} onSubmit={submit}>
        <div>
          <label className="label">Brand name</label>
          <input className="input" value={name} autoFocus onChange={e => setName(e.target.value)} />
          <div className="tiny muted" style={{ marginTop: 5 }}>
            A brand holds its own connected stores and their data. Nothing is shared between brands.
          </div>
        </div>
        {error && <div className="auth-error">{error}</div>}
      </form>
    </Modal>
  );
}

export default function Settings() {
  const {
    theme, setTheme, companyId, setCompanyId, healthConfig, setHealthConfig,
    periodId, setPeriodId, comparison, setComparison,
    overviewLayout, setOverviewLayout, overviewKpis, setOverviewKpis,
  } = useApp();
  const { user, brands, signOut } = useSession();
  const [draft, setDraft] = useState(healthConfig.weights);
  const [adding, setAdding] = useState(false);
  const total = healthConfig.dimensions.reduce((s, id) => s + (draft[id] ?? 0), 0);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Settings</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Your account, your brands, and how Company Health is scored.
        </p>
      </div>

      <Card title="Account" subtitle="Who you are signed in as">
        <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="hstack" style={{ gap: 11 }}>
            <span className="avatar" style={{ borderRadius: 9 }}>
              {(user?.full_name || user?.email || '?').slice(0, 2).toUpperCase()}
            </span>
            <span>
              <span className="small" style={{ fontWeight: 600, display: 'block' }}>
                {user?.full_name || 'Your account'}
              </span>
              <span className="tiny muted">{user?.email}</span>
            </span>
          </div>
          <button className="btn" onClick={signOut}><LogOut size={13} /> Sign out</button>
        </div>
      </Card>

      <Card
        title="Brands"
        subtitle="Each brand holds its own connected stores"
        actions={<button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={12} /> Add brand</button>}
      >
        <div className="vstack" style={{ gap: 2 }}>
          {brands.map(b => (
            <div className="spread" key={b.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="hstack" style={{ gap: 10 }}>
                <span className="avatar" style={{ borderRadius: 7 }}>{b.name.slice(0, 2).toUpperCase()}</span>
                <span>
                  <span className="small" style={{ fontWeight: 500, display: 'block' }}>{b.name}</span>
                  <span className="tiny muted">
                    {[b.industry, b.currency, b.role].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </span>
              {companyId === b.id
                ? <Pill tone="info">Active</Pill>
                : <button className="btn btn-sm" onClick={() => setCompanyId(b.id)}>Switch</button>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Appearance" subtitle="Applies to this browser">
        <div className="spread">
          <span className="small">Theme</span>
          <Segmented
            options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]}
            value={theme} onChange={setTheme}
          />
        </div>
      </Card>

      <Card title="Defaults" subtitle="What loads when you open Ardent">
        <div className="vstack" style={{ gap: 15 }}>
          <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
            <span className="small">Default period</span>
            <select className="input" style={{ width: 220 }} value={periodId} onChange={e => setPeriodId(e.target.value)}>
              {PERIOD_PRESETS.filter(p => p.id !== 'custom').map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
            <span className="small">Default comparison</span>
            <select className="input" style={{ width: 220 }} value={comparison} onChange={e => setComparison(e.target.value)}>
              {COMPARISON_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card
        title="Customize your Overview"
        subtitle="A CEO and a CFO read this page differently — choose what it leads with"
        id="overview-layout"
      >
        <p className="tiny muted" style={{ margin: '0 0 14px' }}>
          Nothing here changes what a figure means or how it is computed — only whether it shows,
          and where.
        </p>
        <div className="vstack" style={{ gap: 22 }}>
          <div>
            <div className="section-title">Headline metrics</div>
            <p className="tiny muted" style={{ margin: '0 0 10px' }}>
              Up to {OVERVIEW_KPI_SLOTS} figures in the banner at the top of the Overview.
            </p>
            <ListPicker
              chosen={overviewKpis} setChosen={setOverviewKpis}
              all={OVERVIEW_KPIS} byId={OVERVIEW_KPI_BY_ID} max={OVERVIEW_KPI_SLOTS}
            />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
            <div className="section-title">Page sections</div>
            <p className="tiny muted" style={{ margin: '0 0 10px' }}>
              What appears on the Overview below the banner, and in what order.
            </p>
            <ListPicker
              chosen={overviewLayout} setChosen={setOverviewLayout}
              all={OVERVIEW_SECTIONS} byId={OVERVIEW_SECTION_BY_ID}
              minLabel="At least one section has to stay, or the page would be blank."
            />
          </div>
        </div>
      </Card>

      <Card
        title="Company Health weighting"
        subtitle={`How much each of your ${HEALTH_SLOTS} chosen indicators contributes to the overall score`}
        actions={
          <button
            className="btn btn-sm"
            onClick={() => {
              // An even split across whichever indicators are currently chosen.
              const even = Math.round(100 / healthConfig.dimensions.length);
              const reset = Object.fromEntries(healthConfig.dimensions.map(id => [id, even]));
              setDraft(reset);
              setHealthConfig({ ...healthConfig, weights: reset });
            }}
          >
            <RotateCcw size={12} /> Balance evenly
          </button>
        }
      >
        <p className="tiny muted" style={{ margin: '0 0 14px' }}>
          Which indicators appear is chosen on the Overview, under View health breakdown. An
          indicator whose data is not connected is left out of the score entirely, whatever weight
          it carries here.
        </p>
        <div className="vstack" style={{ gap: 14 }}>
          {healthConfig.dimensions.map(id => {
            const c = DIMENSION_BY_ID[id];
            if (!c) return null;
            return (
              <div key={id}>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <span>
                    <span className="small" style={{ fontWeight: 500 }}>{c.label}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{c.basis}</span>
                  </span>
                  <span className="hstack" style={{ gap: 5 }}>
                    <input
                      type="range" min={0} max={60} step={5}
                      value={draft[id] ?? 20}
                      onChange={e => setDraft(d => ({ ...d, [id]: Number(e.target.value) }))}
                      style={{ width: 150, accentColor: 'var(--accent)' }}
                    />
                    <span className="tnum small" style={{ width: 34, textAlign: 'right', fontWeight: 600 }}>
                      {draft[id] ?? 20}%
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="spread" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <span className="hstack" style={{ gap: 9 }}>
            <span className="small muted">Total</span>
            <span className={`tnum small${total === 100 ? '' : ' delta down'}`} style={{ fontWeight: 600 }}>{total}%</span>
            {total === 100 && <Pill tone="good">Valid</Pill>}
          </span>
          <button
            className="btn btn-primary" disabled={total !== 100}
            onClick={() => setHealthConfig({ ...healthConfig, weights: draft })}
          >
            {total === 100 ? 'Save weighting' : 'Must total 100%'}
          </button>
        </div>
      </Card>

      {adding && <AddBrand onClose={() => setAdding(false)} />}
    </div>
  );
}
