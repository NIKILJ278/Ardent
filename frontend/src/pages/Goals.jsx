import { useMemo, useState } from 'react';
import {
  Plus, Target, Trash2, StickyNote, CalendarClock, Flag, Flag as FlagIcon,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import {
  resolveGoal, GOAL_STATUS, GOAL_METRICS, DEPARTMENTS, EVENT_KINDS,
} from '../data/business.js';
import { COMPANY_BY_ID, channelsFor, CHANNEL_BY_ID } from '../data/catalog.js';
import { money, num, pct, fmtDate, iso, currencySymbol } from '../lib/format.js';
import { Card, Pill, Track, Modal, Empty, Segmented } from '../components/ui/index.jsx';

const METRICS = Object.values(GOAL_METRICS);
const PRIORITIES = ['high', 'medium', 'low'];
const PRIORITY_TONE = { high: 'critical', medium: 'warning', low: 'neutral' };

/* ── Create a goal ─────────────────────────────────────────────────────── */

function GoalForm({ onSave, onClose }) {
  const { companyId, author } = useApp();
  const [f, setF] = useState({
    name: '', metric: 'net', targetValue: '', deadline: '',
    owner: author, department: 'Sales', priority: 'medium', notes: '',
    company: companyId,
  });
  const metric = GOAL_METRICS[f.metric];
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...f,
      targetValue: f.targetValue === '' ? null : Number(f.targetValue),
      lowerIsBetter: metric?.lower ?? false,
    });
    onClose();
  };

  return (
    <Modal
      title="Create goal"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="goal-form" type="submit" disabled={!f.name || !f.targetValue}>
            Create goal
          </button>
        </>
      }
    >
      <form id="goal-form" onSubmit={submit} className="vstack" style={{ gap: 13 }}>
        <div>
          <label className="label">Goal name</label>
          <input className="input" value={f.name} autoFocus placeholder="e.g. Q4 net sales"
                 onChange={set('name')} />
        </div>

        <div>
          <label className="label">Metric</label>
          <select className="input" value={f.metric} onChange={set('metric')}>
            {METRICS.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}{m.available ? '' : ' — not connected'}
              </option>
            ))}
          </select>
          {!metric?.available && (
            <div className="tiny muted" style={{ marginTop: 5, lineHeight: 1.5 }}>
              This metric needs a source that is not connected. The goal can be written down, but
              progress against it cannot be measured yet.
            </div>
          )}
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">
              Target value {metric?.kind === 'percent' ? '(%)' : metric?.kind === 'number' ? '' : `(${currencySymbol()})`}
              {metric?.lower && <span className="tiny muted"> — lower is better</span>}
            </label>
            <input
              className="input tnum" type="number" value={f.targetValue}
              placeholder={metric?.kind === 'percent' ? '20' : ''}
              onChange={set('targetValue')}
            />
          </div>
          <div>
            <label className="label">Deadline</label>
            <input className="input" type="date" value={f.deadline} onChange={set('deadline')} />
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">Owner</label>
            <input className="input" value={f.owner} onChange={set('owner')} placeholder="Who is accountable" />
          </div>
          <div>
            <label className="label">Department</label>
            <select className="input" value={f.department} onChange={set('department')}>
              {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select className="input" value={f.priority} onChange={set('priority')}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Notes <span className="muted tiny">optional</span></label>
          <textarea className="input" rows={3} value={f.notes} placeholder="Context the team should know"
                    onChange={set('notes')} />
        </div>
      </form>
    </Modal>
  );
}

/* ── Log an event or a note ────────────────────────────────────────────────
   Both land on the same timeline; an event carries a kind and the channels it
   touched, so its measured impact can be read against the revenue chart.
   ──────────────────────────────────────────────────────────────────────── */

function EventForm({ onSaveEvent, onSaveNote, onClose }) {
  const { companyId, today, dataVersion } = useApp();
  const channels = useMemo(() => channelsFor(companyId), [companyId, dataVersion]);
  const [f, setF] = useState({
    kind: 'launch', title: '', detail: '', date: iso(today), channels: 'all',
  });
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));
  const isNote = f.kind === 'note';

  const submit = (e) => {
    e.preventDefault();
    const base = { company: companyId, date: f.date, title: f.title.trim(), detail: f.detail.trim() };
    if (isNote) onSaveNote(base);
    else onSaveEvent({ ...base, kind: f.kind, channels: f.channels === 'all' ? 'all' : [f.channels] });
    onClose();
  };

  return (
    <Modal
      title="Add to the timeline"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="event-form" type="submit" disabled={!f.title.trim()}>
            Save
          </button>
        </>
      }
    >
      <form id="event-form" className="vstack" style={{ gap: 13 }} onSubmit={submit}>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">What kind</label>
            <select className="input" value={f.kind} onChange={set('kind')}>
              {Object.values(EVENT_KINDS).map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={f.date} onChange={set('date')} />
          </div>
        </div>

        {!isNote && channels.length > 0 && (
          <div>
            <label className="label">Channel affected</label>
            <select className="input" value={f.channels} onChange={set('channels')}>
              <option value="all">All channels</option>
              {channels.map(c => <option key={c} value={c}>{CHANNEL_BY_ID[c]?.name ?? c}</option>)}
            </select>
            <div className="tiny muted" style={{ marginTop: 5 }}>
              Ardent measures the revenue movement in the 7 days from this date against the 7 before.
            </div>
          </div>
        )}

        <div>
          <label className="label">Title</label>
          <input className="input" autoFocus value={f.title} placeholder="What happened?"
                 onChange={set('title')} />
        </div>
        <div>
          <label className="label">Detail</label>
          <textarea className="input" rows={4} value={f.detail}
                    placeholder="Why it matters — the context the numbers will not carry on their own"
                    onChange={set('detail')} />
        </div>
      </form>
    </Modal>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function Goals() {
  const {
    goals, addGoal, removeGoal, notes, addNote, removeNote,
    events, addEvent, removeEvent, scope, period, companyId,
  } = useApp();
  const [tab, setTab] = useState('goals');
  const [showGoal, setShowGoal] = useState(false);
  const [showEvent, setShowEvent] = useState(false);
  const [filter, setFilter] = useState('all');

  // Goals belong to the brand they were set for — never another brand's.
  const resolved = useMemo(
    () => goals.filter(g => g.company === companyId).map(g => resolveGoal(g, scope, period)),
    [goals, companyId, scope, period]
  );

  const shown = filter === 'all' ? resolved : resolved.filter(g => g.status.id === filter);
  const timeline = useMemo(() => (
    [...events, ...notes]
      .filter(e => e.company === companyId)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  ), [events, notes, companyId]);

  const counts = useMemo(() => {
    const c = { all: resolved.length };
    for (const k of Object.keys(GOAL_STATUS)) c[k] = resolved.filter(g => g.status.id === k).length;
    return c;
  }, [resolved]);

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
          <button className="btn" onClick={() => setShowEvent(true)}><StickyNote size={14} /> Add to timeline</button>
          <button className="btn btn-primary" onClick={() => setShowGoal(true)}><Plus size={14} /> Create goal</button>
        </div>
      </div>

      <Segmented
        options={[
          { id: 'goals',    label: `Goals (${resolved.length})` },
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
                const metric = GOAL_METRICS[g.metric];
                const fmt = (v) => {
                  if (v == null) return '—';
                  if (g.isPct) return pct(v);
                  return metric?.kind === 'number' ? num(v) : money(v);
                };
                const overdue = g.deadline && new Date(g.deadline) < new Date() && g.status.id !== 'achieved';
                const measurable = g.current != null && g.target != null;
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

                      {measurable ? (
                        <>
                          <div className="hstack" style={{ gap: 8, marginBottom: 7, alignItems: 'baseline' }}>
                            <span className="tnum" style={{ fontSize: 21, fontWeight: 600 }}>{fmt(g.current)}</span>
                            <span className="muted small tnum">of {fmt(g.target)}</span>
                          </div>
                          <Track value={g.progress} tone={g.status.tone} markerAt={100} />
                          <div className="spread" style={{ marginTop: 9 }}>
                            <Pill tone={g.status.tone}>{g.status.label}</Pill>
                            <span className="tiny muted tnum">
                              {g.forecast != null && `Forecast ${fmt(g.forecast)} · `}{pct(g.progress, 0)} complete
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="health-na" style={{ marginBottom: 4 }}>
                          {g.target == null
                            ? 'No target set — add one to track progress'
                            : `Not connected — ${metric?.label ?? 'this metric'} needs a source Ardent cannot read yet`}
                        </div>
                      )}

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

      {tab === 'timeline' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,340px)' }}>
          <Card title="Business timeline" subtitle="Events and notes plotted against the business" id="timeline">
            {timeline.length === 0 ? (
              <Empty icon={Flag} title="Nothing logged yet">
                Mark launches, price changes and campaigns so the numbers have context.
              </Empty>
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
                        </div>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => (isNote ? removeNote(e.id) : removeEvent(e.id))}
                          aria-label={isNote ? 'Delete note' : 'Delete event'}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="tl-title">{e.title}</div>
                      {e.detail && <div className="tl-detail">{e.detail}</div>}
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
            <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={() => setShowEvent(true)}>
              <Plus size={14} /> Add to timeline
            </button>
            <div className="ladder-foot">
              An event with a channel gets a measured before-and-after reading on the Overview.
              <FlagIcon size={10} style={{ marginLeft: 4, verticalAlign: 'middle', opacity: 0.6 }} />
            </div>
          </Card>
        </div>
      )}

      {showGoal && <GoalForm onSave={addGoal} onClose={() => setShowGoal(false)} />}
      {showEvent && (
        <EventForm
          onSaveEvent={addEvent}
          onSaveNote={addNote}
          onClose={() => setShowEvent(false)}
        />
      )}
    </div>
  );
}
