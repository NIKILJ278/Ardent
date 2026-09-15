import { useState } from 'react';
import { ChevronUp, ChevronDown, X, Check, Plus } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { Modal, Track, Segmented } from '../ui/index.jsx';
import { indicatorTone } from '../../data/engine.js';
import {
  DIMENSIONS, DIMENSION_BY_ID, HEALTH_SLOTS, dimensionDetail,
} from '../../data/health.js';
import { inr, num, pct } from '../../lib/format.js';

/* Health breakdown and indicator choice.
 *
 * One modal, two views. The breakdown answers "why is the score what it is";
 * the chooser answers "are these even the right five questions for this
 * business". They belong together, because you change the set precisely when
 * the breakdown shows you a dimension that does not describe how you operate.
 */

function DimensionRow({ dim, score, detail }) {
  return (
    <div className="hd-row">
      <div className="spread" style={{ marginBottom: 5 }}>
        <span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{dim.label}</span>
          <span className="tiny muted" style={{ display: 'block' }}>{dim.basis}</span>
        </span>
        <span className="tnum" style={{ fontWeight: 600, fontSize: 15 }}>{score}</span>
      </div>
      <Track value={score} tone={indicatorTone(score)} />
      {detail.length > 0 && (
        <div className="hd-metrics">
          {detail.map(([label, value]) => {
            const off = value === 'not connected';
            return (
              <div className="hd-metric" key={label}>
                <span className="tiny muted">{label}</span>
                <span className={`small tnum${off ? ' muted' : ''}`}
                      style={{ fontWeight: off ? 400 : 600 }}>{value}</span>
              </div>
            );
          })}
        </div>
      )}
      {dim.caveat && <div className="tiny muted hd-caveat">{dim.caveat}</div>}
    </div>
  );
}

function IndicatorChooser({ draft, setDraft }) {
  const chosen = draft.dimensions;
  const full = chosen.length >= HEALTH_SLOTS;

  const toggle = (id) => setDraft(d => {
    if (d.dimensions.includes(id)) {
      const weights = { ...d.weights };
      delete weights[id];
      return { dimensions: d.dimensions.filter(x => x !== id), weights };
    }
    if (d.dimensions.length >= HEALTH_SLOTS) return d;
    // Every indicator carries equal weight until a CEO says otherwise.
    return {
      dimensions: [...d.dimensions, id],
      weights: { ...d.weights, [id]: Math.round(100 / HEALTH_SLOTS) },
    };
  });

  const move = (id, by) => setDraft(d => {
    const i = d.dimensions.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= d.dimensions.length) return d;
    const dimensions = [...d.dimensions];
    [dimensions[i], dimensions[j]] = [dimensions[j], dimensions[i]];
    return { ...d, dimensions };
  });

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div>
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="section-title" style={{ marginBottom: 0 }}>Your indicators</span>
          <span className={`tiny ${full ? 'muted' : 'delta down'}`}>
            {chosen.length} of {HEALTH_SLOTS} chosen
          </span>
        </div>
        <div className="vstack" style={{ gap: 6 }}>
          {chosen.map((id, i) => {
            const d = DIMENSION_BY_ID[id];
            return (
              <div className="hd-chosen" key={id}>
                <span className="hd-ord tnum">{i + 1}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</span>
                  <span className="tiny muted" style={{ display: 'block' }}>{d.question}</span>
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
                  <button className="btn btn-ghost btn-icon btn-sm" title="Remove"
                          onClick={() => toggle(id)}>
                    <X size={13} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div className="section-title">All business dimensions</div>
        <div className="hd-grid">
          {DIMENSIONS.map(d => {
            const on = chosen.includes(d.id);
            const missing = d.metrics.filter(mm => !mm.live).length;
            return (
              <button
                key={d.id} type="button"
                className={`hd-card${on ? ' on' : ''}`}
                disabled={!on && full}
                onClick={() => toggle(d.id)}
                title={!on && full ? `Remove one first — the card holds ${HEALTH_SLOTS}` : d.blurb}
              >
                <span className="spread" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{d.label}</span>
                  {on
                    ? <Check size={14} style={{ color: 'var(--accent)', flex: 'none' }} />
                    : <Plus size={14} className="muted" style={{ flex: 'none' }} />}
                </span>
                <span className="tiny" style={{ color: 'var(--ink-2)' }}>{d.question}</span>
                <span className="tiny muted hd-blurb">{d.blurb}</span>
                <span className="hd-tags">
                  {d.metrics.filter(mm => mm.live).slice(0, 4).map(mm => (
                    <span key={mm.label} className="hd-tag">{mm.label}</span>
                  ))}
                  {missing > 0 && <span className="hd-tag off">{missing} not connected</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function HealthModal({ health, onClose }) {
  const { healthConfig, setHealthConfig } = useApp();
  const [view, setView] = useState('breakdown');
  const [draft, setDraft] = useState(healthConfig);

  const dirty = JSON.stringify(draft.dimensions) !== JSON.stringify(healthConfig.dimensions);
  const ready = draft.dimensions.length === HEALTH_SLOTS;

  return (
    <Modal
      title="Company Health"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          {view === 'choose' && (
            <button
              className="btn btn-primary"
              disabled={!ready || !dirty}
              onClick={() => { setHealthConfig(draft); onClose(); }}
            >
              {ready ? 'Save indicators' : `Choose ${HEALTH_SLOTS} indicators`}
            </button>
          )}
        </>
      }
    >
      <div className="spread hd-head" style={{ gap: 12 }}>
        <p className="small muted" style={{ margin: 0, maxWidth: 520 }}>
          {view === 'breakdown'
            ? 'Each indicator is a business question scored from measured ratios. Nothing here is '
              + 'inferred — every figure comes from the same data behind your KPIs.'
            : `Ardent tracks ten business dimensions. Pick the ${HEALTH_SLOTS} that describe how you `
              + 'actually run this business. The rest stay available but off the Overview.'}
        </p>
        <Segmented
          options={[
            { id: 'breakdown', label: 'Breakdown' },
            { id: 'choose', label: 'Choose indicators' },
          ]}
          value={view} onChange={setView} size="sm"
        />
      </div>

      {view === 'breakdown' ? (
        <div className="vstack" style={{ gap: 18 }}>
          {health.dimensions.map(d => (
            <DimensionRow
              key={d.id}
              dim={d}
              score={health.scores[d.id]}
              detail={dimensionDetail(d.id, health.context, { inr, num, pct })}
            />
          ))}
        </div>
      ) : (
        <IndicatorChooser draft={draft} setDraft={setDraft} />
      )}
    </Modal>
  );
}
