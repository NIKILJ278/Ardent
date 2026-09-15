import { useMemo, useState } from 'react';
import {
  Eye, CalendarClock, ChevronDown, ChevronRight, Users, Check, RotateCcw,
  Trash2, MessageSquarePlus, Flag,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { Card, Pill, Empty, Segmented, Modal, Delta } from '../components/ui/index.jsx';
import { WatchChart } from '../components/charts/index.jsx';
import { WatchForm } from '../components/watch/WatchButton.jsx';
import {
  visibleWatches, evaluateWatch, watchSeries, watchScopeLabel, watchSubject,
  formatMetric,
} from '../data/watchlist.js';
import { fmtDate, asAt } from '../lib/format.js';

const OUTCOMES = [
  { id: 'worked',     label: 'It worked',        tone: 'good' },
  { id: 'partly',     label: 'Partly',           tone: 'warning' },
  { id: 'no',         label: 'It did not work',  tone: 'critical' },
  { id: 'superseded', label: 'Overtaken by events', tone: 'neutral' },
];
const OUTCOME_BY_ID = Object.fromEntries(OUTCOMES.map(o => [o.id, o]));

/* ── Closing a watch ───────────────────────────────────────────────────── */

function CloseForm({ watch, evaluation, onClose }) {
  const { closeWatch } = useApp();
  // Pre-select what the numbers say; the honest default is the measured one.
  const [outcome, setOutcome] = useState(
    evaluation.status.id === 'improving' ? 'worked'
      : evaluation.status.id === 'worsening' ? 'no' : 'partly'
  );
  const [note, setNote] = useState('');

  return (
    <Modal
      title="Close this watch"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!note.trim()}
            onClick={() => { closeWatch(watch.id, { outcome, closingNote: note.trim() }); onClose(); }}
          >
            Close watch
          </button>
        </>
      }
    >
      <div className="vstack" style={{ gap: 13 }}>
        <div className="watch-subject">
          <span className="tiny muted">{watchScopeLabel(watch)}</span>
          <div style={{ fontWeight: 600 }}>{watch.title}</div>
          <div className="tiny muted" style={{ marginTop: 4 }}>
            {evaluation.metric.label} moved from {formatMetric(evaluation.metric, evaluation.baseline)} to{' '}
            {formatMetric(evaluation.metric, evaluation.current)} over {evaluation.windowDays} days.
          </div>
        </div>
        <div>
          <label className="label">Verdict</label>
          <div className="hstack" style={{ gap: 6, flexWrap: 'wrap' }}>
            {OUTCOMES.map(o => (
              <button
                key={o.id} type="button"
                className={`chip${outcome === o.id ? ' active' : ''}`}
                onClick={() => setOutcome(o.id)}
              >{o.label}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">What we learned</label>
          <textarea
            className="input" rows={4} value={note}
            placeholder="What actually happened, and what it changes about how we do this next time."
            onChange={e => setNote(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

/* ── The reading: baseline, now, and the gap ───────────────────────────── */

function Reading({ e }) {
  const fmt = (v) => formatMetric(e.metric, v);
  return (
    <div className="watch-reading">
      <div className="watch-figure">
        <span className="tiny muted">When marked</span>
        <span className="watch-figure-value">{fmt(e.baseline)}</span>
        <span className="tiny muted">
          {fmtDate(e.baseWindow.start)} – {fmtDate(e.baseWindow.end)}
        </span>
      </div>
      <div className="watch-arrow">→</div>
      <div className="watch-figure">
        <span className="tiny muted">{e.settling ? `Since marked (${e.elapsed}d)` : `Last ${e.windowDays} days`}</span>
        <span className="watch-figure-value">{fmt(e.current)}</span>
        <span className="tiny muted">
          {fmtDate(e.curWindow.start)} – {fmtDate(e.curWindow.end)}
        </span>
      </div>
      <div className="watch-figure">
        <span className="tiny muted">Change</span>
        <span className="watch-figure-value">
          <Delta value={e.changePct ?? 0} invert={e.metric.lowerIsBetter} />
        </span>
        <span className="tiny muted">{e.metric.lowerIsBetter ? 'lower is better' : 'higher is better'}</span>
      </div>
      {e.target != null && (
        <div className="watch-figure">
          <span className="tiny muted">Target</span>
          <span className="watch-figure-value">{fmt(e.target)}</span>
          <span className="tiny" style={{ color: e.hitTarget ? 'var(--good-ink)' : 'var(--ink-3)' }}>
            {e.hitTarget ? 'met' : `${fmt(Math.abs(e.current - e.target))} away`}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── One watch ─────────────────────────────────────────────────────────── */

function WatchRow({ watch, defaultOpen }) {
  const { today, addWatchUpdate, reopenWatch, removeWatch } = useApp();
  const [open, setOpen] = useState(defaultOpen);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState('');

  const e = useMemo(() => evaluateWatch(watch, today), [watch, today]);
  const points = useMemo(() => (open ? watchSeries(watch, today) : []), [watch, today, open]);

  const outcome = watch.outcome ? OUTCOME_BY_ID[watch.outcome] : null;

  return (
    <div className={`watch-card${open ? ' is-open' : ''}`}>
      <button type="button" className="watch-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span className="watch-head-main">
          <span className="watch-title">{watch.title}</span>
          <span className="tiny muted">
            {watchSubject(watch)} · {e.metric.label} · marked {fmtDate(watch.markedOn, 'long')} by {watch.author ?? 'CEO'}
          </span>
        </span>
        <span className="hstack" style={{ gap: 7, marginLeft: 'auto' }}>
          {e.dueForReview && !watch.closedOn && (
            <Pill tone="warning"><CalendarClock size={11} /> Review due</Pill>
          )}
          {outcome ? <Pill tone={outcome.tone}>{outcome.label}</Pill> : <Pill tone={e.status.tone}>{e.status.label}</Pill>}
        </span>
      </button>

      {open && (
        <div className="watch-body">
          <Reading e={e} />

          {e.settling && (
            <div className="watch-flag">
              <Flag size={13} />
              <span>
                {e.elapsed} of {e.windowDays} days have passed. The comparison is not on equal
                windows yet, so treat this as a direction rather than a result.
              </span>
            </div>
          )}

          <div className="watch-chart">
            <WatchChart
              points={points}
              markLabel={`Marked ${fmtDate(watch.markedOn)}`}
              target={e.target}
              valueFmt={(v) => formatMetric(e.metric, v)}
              labelFmt={(d) => fmtDate(d)}
              height={180}
            />
            <div className="tiny muted">
              Weekly {e.metric.short.toLowerCase()} for {watchScopeLabel(watch)}. {e.metric.help}
            </div>
          </div>

          <div className="watch-panels">
            <div className="watch-panel">
              <div className="watch-panel-head">
                <span>What was discussed</span>
                {watch.meeting && (
                  <span className="tiny muted">
                    {watch.meeting.title} · {fmtDate(watch.meeting.date, 'long')}
                  </span>
                )}
              </div>
              <p>{watch.discussion || <span className="muted">Not recorded.</span>}</p>
              {watch.meeting?.attendees?.length > 0 && (
                <div className="tiny muted hstack" style={{ gap: 5 }}>
                  <Users size={11} /> {watch.meeting.attendees.join(', ')}
                </div>
              )}
            </div>
            <div className="watch-panel">
              <div className="watch-panel-head">
                <span>What we decided to do</span>
                {watch.owner && <span className="tiny muted">Owner: {watch.owner}</span>}
              </div>
              <p>{watch.decision || <span className="muted">Not recorded.</span>}</p>
            </div>
          </div>

          {(watch.updates?.length > 0 || !watch.closedOn) && (
            <div className="watch-updates">
              <div className="watch-panel-head"><span>Since then</span></div>
              {watch.updates?.length > 0 ? (
                <ul className="watch-update-list">
                  {watch.updates.map((u, i) => (
                    <li key={i}>
                      <span className="tiny muted">{fmtDate(u.date, 'long')} · {u.author}</span>
                      <span>{u.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tiny muted">No updates logged yet.</p>
              )}

              {!watch.closedOn && (
                <div className="hstack" style={{ gap: 8, marginTop: 8 }}>
                  <input
                    className="input" value={draft} placeholder="Add an update…"
                    onChange={ev => setDraft(ev.target.value)}
                    onKeyDown={ev => {
                      if (ev.key === 'Enter' && draft.trim()) {
                        addWatchUpdate(watch.id, draft.trim()); setDraft('');
                      }
                    }}
                  />
                  <button
                    className="btn btn-sm" disabled={!draft.trim()}
                    onClick={() => { addWatchUpdate(watch.id, draft.trim()); setDraft(''); }}
                  >
                    <MessageSquarePlus size={13} /> Add
                  </button>
                </div>
              )}
            </div>
          )}

          {watch.closedOn && (
            <div className="watch-closing">
              <div className="watch-panel-head">
                <span>Closed {fmtDate(watch.closedOn, 'long')}</span>
                {outcome && <Pill tone={outcome.tone}>{outcome.label}</Pill>}
              </div>
              <p>{watch.closingNote}</p>
            </div>
          )}

          <div className="watch-actions">
            <span className="tiny muted">
              {watch.closedOn
                ? `Frozen at ${fmtDate(watch.closedOn, 'long')} — figures do not move after a watch is closed.`
                : e.dueForReview
                  ? `Review was due ${fmtDate(e.reviewOn, 'long')}.`
                  : `Review falls due ${fmtDate(e.reviewOn, 'long')}, in ${e.daysToReview} days.`}
            </span>
            <span className="hstack" style={{ gap: 7, marginLeft: 'auto' }}>
              {watch.closedOn ? (
                <button className="btn btn-sm" onClick={() => reopenWatch(watch.id)}>
                  <RotateCcw size={13} /> Reopen
                </button>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => setClosing(true)}>
                  <Check size={13} /> Close with a verdict
                </button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => removeWatch(watch.id)} title="Remove">
                <Trash2 size={13} />
              </button>
            </span>
          </div>
        </div>
      )}

      {closing && <CloseForm watch={watch} evaluation={e} onClose={() => setClosing(false)} />}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

const FILTERS = [
  { id: 'open',   label: 'Open' },
  { id: 'due',    label: 'Review due' },
  { id: 'closed', label: 'Closed' },
  { id: 'all',    label: 'All' },
];

export default function Watchlist() {
  const { watches, companyId, can, today } = useApp();
  const [filter, setFilter] = useState('open');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const list = visibleWatches(watches, companyId, can);
    return list.map(w => ({ w, e: evaluateWatch(w, today) }));
  }, [watches, companyId, can, today]);

  const counts = useMemo(() => ({
    open: rows.filter(r => !r.w.closedOn).length,
    due: rows.filter(r => r.e.dueForReview).length,
    worsening: rows.filter(r => r.e.status.id === 'worsening').length,
    closed: rows.filter(r => r.w.closedOn).length,
  }), [rows]);

  const shown = rows.filter(({ w, e }) =>
    filter === 'all' ? true
      : filter === 'due' ? e.dueForReview
        : filter === 'closed' ? !!w.closedOn
          : !w.closedOn
  );

  // Due items first, then the ones going the wrong way — the two things a
  // review meeting has to deal with before anything else.
  const ordered = [...shown].sort((a, b) => {
    const rank = (r) => (r.e.dueForReview ? 0 : r.e.status.id === 'worsening' ? 1 : 2);
    return rank(a) - rank(b) || (a.w.markedOn < b.w.markedOn ? 1 : -1);
  });

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div className="hstack watch-page-head">
        <div>
          <h1 style={{ fontSize: 20 }}>Watchlist</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            Metrics put under observation after a meeting, with what was said and what was decided.
          </p>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            Readings {asAt(today)} · each watch compares equal windows either side of the day it was marked
          </p>
        </div>
        <div className="hstack" style={{ gap: 8, marginLeft: 'auto' }}>
          <Segmented
            options={FILTERS.map(f => ({
              ...f,
              label: f.id === 'due' && counts.due ? `${f.label} (${counts.due})` : f.label,
            }))}
            value={filter} onChange={setFilter} size="sm"
          />
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            <Eye size={14} /> New watch
          </button>
        </div>
      </div>

      <div className="watch-summary">
        <div><span className="watch-summary-n">{counts.open}</span><span className="tiny muted">Open</span></div>
        <div><span className="watch-summary-n">{counts.due}</span><span className="tiny muted">Review due</span></div>
        <div><span className="watch-summary-n">{counts.worsening}</span><span className="tiny muted">Going the wrong way</span></div>
        <div><span className="watch-summary-n">{counts.closed}</span><span className="tiny muted">Closed</span></div>
      </div>

      {ordered.length === 0 ? (
        <Card>
          <Empty icon={Eye} title="Nothing on watch">
            Mark a metric from anywhere in Ardent — a channel, a category, a product or a single
            SKU — and it lands here with the meeting note attached.
          </Empty>
        </Card>
      ) : (
        <div className="vstack" style={{ gap: 10 }}>
          {ordered.map(({ w, e }, i) => (
            <WatchRow key={w.id} watch={w} defaultOpen={i === 0 && e.dueForReview} />
          ))}
        </div>
      )}

      {adding && (
        <WatchForm
          subject={{ company: companyId === 'all' ? 'kosha' : companyId }}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
