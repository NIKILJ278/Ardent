import { useMemo, useState } from 'react';
import {
  Plus, Target, Trash2, StickyNote, CalendarClock, Flag, ArrowRight,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import {
  resolveGoal, GOAL_STATUS, DEPARTMENTS, OWNERS, departmentPerformance,
  EVENT_KINDS,
} from '../data/business.js';
import { COMPANIES, COMPANY_BY_ID } from '../data/catalog.js';
import { inr, pct, fmtDate } from '../lib/format.js';
import { Card, Pill, Track, Modal, Empty, Segmented, DataTable, Delta } from '../components/ui/index.jsx';

const METRICS = [
  { id: 'net',          label: 'Net revenue',        kind: 'currency' },
  { id: 'ebitdaPct',    label: 'EBITDA margin',      kind: 'percent'  },
  { id: 'directShare',  label: 'Direct channel share', kind: 'percent' },
  { id: 'returnPct',    label: 'Return rate',        kind: 'percent', lower: true },
  { id: 'receivables',  label: 'Receivables',        kind: 'currency', lower: true },
];

const PRIORITIES = ['high', 'medium', 'low'];
const PRIORITY_TONE = { high: 'critical', medium: 'warning', low: 'neutral' };

/* ── Create / edit goal ────────────────────────────────────────────────── */

function GoalForm({ initial, onSave, onClose }) {
  const { companyId } = useApp();
  const [f, setF] = useState(initial ?? {
    name: '', metric: 'net', targetValue: '', deadline: '',
    owner: OWNERS[0], department: 'Sales', priority: 'medium', notes: '',
    company: companyId === 'all' ? 'kosha' : companyId,
  });
  const metric = METRICS.find(m => m.id === f.metric);

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...f,
      targetValue: Number(f.targetValue) || undefined,
      lowerIsBetter: metric?.lower ?? false,
    });
    onClose();
  };

  return (
    <Modal
      title={initial ? 'Edit goal' : 'Create goal'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="goal-form" type="submit" disabled={!f.name || !f.targetValue}>
            {initial ? 'Save changes' : 'Create goal'}
          </button>
        </>
      }
    >
      <form id="goal-form" onSubmit={submit} className="vstack" style={{ gap: 13 }}>
        <div>
          <label className="label">Goal name</label>
          <input className="input" value={f.name} autoFocus placeholder="e.g. Q4 Revenue"
                 onChange={e => setF(s => ({ ...s, name: e.target.value }))} />
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">Company</label>
            <select className="input" value={f.company} onChange={e => setF(s => ({ ...s, company: e.target.value }))}>
              {COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Metric</label>
            <select className="input" value={f.metric} onChange={e => setF(s => ({ ...s, metric: e.target.value }))}>
              {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">
              Target value {metric?.kind === 'percent' ? '(%)' : '(₹)'}
              {metric?.lower && <span className="tiny muted"> — lower is better</span>}
            </label>
            <input
              className="input tnum" type="number" value={f.targetValue}
              placeholder={metric?.kind === 'percent' ? '20' : '15000000'}
              onChange={e => setF(s => ({ ...s, targetValue: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Deadline</label>
            <input className="input" type="date" value={f.deadline}
                   onChange={e => setF(s => ({ ...s, deadline: e.target.value }))} />
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">Owner</label>
            <select className="input" value={f.owner} onChange={e => setF(s => ({ ...s, owner: e.target.value }))}>
              {OWNERS.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Department</label>
            <select className="input" value={f.department} onChange={e => setF(s => ({ ...s, department: e.target.value }))}>
              {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={f.priority} onChange={e => setF(s => ({ ...s, priority: e.target.value }))}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Notes <span className="muted tiny">optional</span></label>
          <textarea className="input" rows={3} value={f.notes} placeholder="Context the team should know"
                    onChange={e => setF(s => ({ ...s, notes: e.target.value }))} />
        </div>
      </form>
    </Modal>
  );
}

/* ── Add note / event ──────────────────────────────────────────────────── */

function NoteForm({ onSave, onClose }) {
  const { companyId, today } = useApp();
  const [f, setF] = useState({
    title: '', detail: '', date: today.toISOString().slice(0, 10),
    company: companyId === 'all' ? 'kosha' : companyId, linkedMetric: 'Revenue',
  });
  return (
    <Modal
      title="Add note"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="note-form" type="submit" disabled={!f.title}>Save note</button>
        </>
      }
    >
      <form id="note-form" className="vstack" style={{ gap: 13 }}
            onSubmit={e => { e.preventDefault(); onSave(f); onClose(); }}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={f.date} onChange={e => setF(s => ({ ...s, date: e.target.value }))} />
          </div>
          <div>
            <label className="label">Attach to</label>
            <select className="input" value={f.linkedMetric} onChange={e => setF(s => ({ ...s, linkedMetric: e.target.value }))}>
              {['Revenue', 'Orders', 'Margin', 'Inventory', 'Cash', 'Goal'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Title</label>
          <input className="input" autoFocus value={f.title} placeholder="What happened?"
                 onChange={e => setF(s => ({ ...s, title: e.target.value }))} />
        </div>
        <div>
          <label className="label">Detail</label>
          <textarea className="input" rows={4} value={f.detail} placeholder="Why it matters — context for the numbers"
                    onChange={e => setF(s => ({ ...s, detail: e.target.value }))} />
        </div>
      </form>
    </Modal>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function Goals() {
  const {
    goals, addGoal, removeGoal, notes, addNote, removeNote, events,
    scope, period, companyId,
  } = useApp();
  const [tab, setTab] = useState('goals');
  const [showGoal, setShowGoal] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [filter, setFilter] = useState('all');

  const live = useMemo(
    () => goals
      .filter(g => companyId === 'all' || g.company === companyId)
      .map(g => resolveGoal(g, scope, period)),
    [goals, companyId, scope, period]
  );

  const shown = filter === 'all' ? live : live.filter(g => g.status.id === filter);
  const depts = useMemo(() => departmentPerformance(scope), [scope]);
  const timeline = useMemo(() => {
    const all = [...events, ...notes].filter(e => companyId === 'all' || e.company === companyId);
    return all.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [events, notes, companyId]);

  const counts = useMemo(() => {
    const c = { all: live.length };
    for (const k of Object.keys(GOAL_STATUS)) c[k] = live.filter(g => g.status.id === k).length;
    return c;
  }, [live]);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Goals & Targets</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            Set targets, assign owners, and see whether the forecast gets you there.
          </p>
        </div>
        <div className="hstack" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setShowNote(true)}><StickyNote size={14} /> Add note</button>
          <button className="btn btn-primary" onClick={() => setShowGoal(true)}><Plus size={14} /> Create goal</button>
        </div>
      </div>

      <Segmented
        options={[
          { id: 'goals',    label: `Goals (${live.length})` },
          { id: 'depts',    label: 'Departments' },
          { id: 'timeline', label: `Timeline (${timeline.length})` },
        ]}
        value={tab} onChange={setTab}
      />

      {tab === 'goals' && (
        <>
          <div className="hstack" style={{ gap: 6, flexWrap: 'wrap' }}>
            {[{ id: 'all', label: 'All' }, ...Object.values(GOAL_STATUS).map(s => ({ id: s.id, label: s.label }))].map(s => (
              <button
                key={s.id}
                className={`btn btn-sm${filter === s.id ? ' btn-primary' : ''}`}
                onClick={() => setFilter(s.id)}
              >
                {s.label} <span style={{ opacity: 0.65, marginLeft: 3 }}>{counts[s.id] ?? 0}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <Card><Empty icon={Target} title="No goals here">Create a goal to start tracking against a target.</Empty></Card>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(348px,1fr))' }}>
              {shown.map(g => {
                const fmt = (v) => (g.isPct ? pct(v) : inr(v));
                const overdue = g.deadline && new Date(g.deadline) < new Date() && g.status.id !== 'achieved';
                return (
                  <div className="card2" key={g.id}>
                    <div className="card2-body">
                      <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="hstack" style={{ gap: 7, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{g.name}</span>
                            <Pill tone={PRIORITY_TONE[g.priority]} icon={false}>{g.priority}</Pill>
                          </div>
                          <div className="tiny muted" style={{ marginTop: 2 }}>
                            {COMPANY_BY_ID[g.company]?.name} · {g.department} · {g.owner}
                          </div>
                        </div>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeGoal(g.id)} aria-label="Delete goal">
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div className="hstack" style={{ gap: 8, marginBottom: 7, alignItems: 'baseline' }}>
                        <span className="tnum" style={{ fontSize: 21, fontWeight: 600 }}>{fmt(g.current)}</span>
                        <span className="muted small tnum">of {fmt(g.target)}</span>
                      </div>

                      <Track value={g.progress} tone={g.status.tone} markerAt={100} />

                      <div className="spread" style={{ marginTop: 9 }}>
                        <Pill tone={g.status.tone}>{g.status.label}</Pill>
                        <span className="tiny muted tnum">
                          Forecast {fmt(g.forecast)} · {pct(g.progress, 0)} complete
                        </span>
                      </div>

                      <div className="spread tiny muted" style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
                        <span className="hstack" style={{ gap: 5 }}>
                          <CalendarClock size={12} />
                          {g.deadline ? fmtDate(g.deadline, 'long') : 'No deadline'}
                          {overdue && <Pill tone="critical" icon={false}>Overdue</Pill>}
                        </span>
                      </div>

                      {g.notes && <p className="tiny muted" style={{ margin: '9px 0 0', lineHeight: 1.45 }}>{g.notes}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === 'depts' && (
        <Card title="Department performance" subtitle="Attainment against each department's target" flush>
          <DataTable
            searchable={false}
            pageSize={10}
            columns={[
              { key: 'name', label: 'Department', render: r => (
                <span><span style={{ fontWeight: 500 }}>{r.name}</span><span className="tiny muted" style={{ display: 'block' }}>{r.basis}</span></span>
              ) },
              { key: 'headcount', label: 'Team', align: 'right' },
              { key: 'target', label: 'Target', align: 'right', render: r => inr(r.target) },
              { key: 'actual', label: 'Actual', align: 'right', render: r => <strong>{inr(r.actual)}</strong> },
              { key: 'trend',  label: 'Trend',  align: 'right', render: r => <Delta value={r.trend} /> },
              { key: 'attainment', label: 'Attainment', align: 'right', width: 180, render: r => (
                <span className="hstack" style={{ gap: 9, justifyContent: 'flex-end' }}>
                  <span style={{ width: 74 }}><Track value={r.attainment} tone={r.tone} /></span>
                  <span className="tnum" style={{ fontWeight: 600, width: 34, textAlign: 'right' }}>{r.attainment}%</span>
                </span>
              ) },
              { key: 'status', label: 'Status', align: 'right', sortable: false, render: r => (
                <Pill tone={r.tone}>{r.tone === 'good' ? 'On track' : r.tone === 'warning' ? 'At risk' : 'Behind'}</Pill>
              ) },
            ]}
            rows={depts.map(d => ({ ...d, id: d.name }))}
            initialSort={{ key: 'attainment', dir: 'desc' }}
          />
        </Card>
      )}

      {tab === 'timeline' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,340px)' }}>
          <Card title="Business timeline" subtitle="Events and notes plotted against the business">
            {timeline.length === 0 ? (
              <Empty icon={Flag} title="Nothing logged yet">Mark launches, price changes and campaigns so the numbers have context.</Empty>
            ) : (
              <div className="tl">
                {timeline.map(e => {
                  const kind = EVENT_KINDS[e.kind] ?? EVENT_KINDS.business;
                  const isNote = e.kind === 'note';
                  return (
                    <div className="tl-item" key={e.id}>
                      <span className="tl-dot" style={{
                        background: `var(--${kind.tone === 'good' ? 'good' : kind.tone === 'warning' ? 'warning' : kind.tone === 'serious' ? 'serious' : kind.tone === 'neutral' ? 'ink-3' : 'accent'})`,
                      }} />
                      <div className="spread">
                        <div className="tl-date">
                          {fmtDate(e.date + 'T12:00:00', 'long')} · {kind.label}
                          {e.company && <span> · {COMPANY_BY_ID[e.company]?.name}</span>}
                        </div>
                        {isNote && (
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeNote(e.id)} aria-label="Delete note">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      <div className="tl-title">{e.title}</div>
                      {e.detail && <div className="tl-detail">{e.detail}</div>}
                      {e.oldPrice != null && (
                        <div className="hstack tiny" style={{ gap: 8, marginTop: 5 }}>
                          <span className="muted">Old {inr(e.oldPrice)}</span>
                          <ArrowRight size={11} className="muted" />
                          <span style={{ fontWeight: 600 }}>New {inr(e.newPrice)}</span>
                        </div>
                      )}
                      {e.author && <div className="tiny muted" style={{ marginTop: 4 }}>— {e.author}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="Event types" subtitle="What you can mark on the timeline">
            <div className="vstack" style={{ gap: 9 }}>
              {Object.values(EVENT_KINDS).map(k => (
                <div className="hstack" key={k.id} style={{ gap: 9 }}>
                  <span className={`dot ${k.tone === 'neutral' ? 'neutral' : k.tone}`} />
                  <span className="small">{k.label}</span>
                </div>
              ))}
            </div>
            <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={() => setShowNote(true)}>
              <Plus size={14} /> Add note
            </button>
          </Card>
        </div>
      )}

      {showGoal && <GoalForm onSave={addGoal} onClose={() => setShowGoal(false)} />}
      {showNote && <NoteForm onSave={addNote} onClose={() => setShowNote(false)} />}
    </div>
  );
}
