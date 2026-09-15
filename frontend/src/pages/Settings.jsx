import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { COMPANIES } from '../data/catalog.js';
import { PERIOD_PRESETS, COMPARISON_MODES } from '../data/engine.js';
import { DIMENSION_BY_ID, HEALTH_SLOTS } from '../data/health.js';
import { Card, Segmented, Pill } from '../components/ui/index.jsx';

export default function Settings() {
  const {
    theme, setTheme, companyId, setCompanyId, healthConfig, setHealthConfig,
    periodId, setPeriodId, comparison, setComparison,
  } = useApp();
  const [draft, setDraft] = useState(healthConfig.weights);
  const total = healthConfig.dimensions.reduce((s, id) => s + (draft[id] ?? 0), 0);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Settings</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Defaults, appearance and how Company Health is scored.
        </p>
      </div>

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
            <span className="small">Default company</span>
            <select className="input" style={{ width: 220 }} value={companyId} onChange={e => setCompanyId(e.target.value)}>
              {COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="all">All Brands</option>
            </select>
          </div>
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
          Which indicators appear is chosen on the Overview, under View health breakdown.
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

      <Card title="Companies" subtitle="Brands in this workspace">
        <div className="vstack" style={{ gap: 2 }}>
          {COMPANIES.map(c => (
            <div className="spread" key={c.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="hstack" style={{ gap: 10 }}>
                <span className="avatar" style={{ borderRadius: 7 }}>{c.name.slice(0, 2).toUpperCase()}</span>
                <span>
                  <span className="small" style={{ fontWeight: 500, display: 'block' }}>{c.name}</span>
                  <span className="tiny muted">{c.legalName} · {c.gstin}</span>
                </span>
              </span>
              <span className="hstack" style={{ gap: 9 }}>
                <span className="tiny muted">{c.sector}</span>
                {companyId === c.id
                  ? <Pill tone="info">Active</Pill>
                  : <button className="btn btn-sm" onClick={() => setCompanyId(c.id)}>Switch</button>}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
