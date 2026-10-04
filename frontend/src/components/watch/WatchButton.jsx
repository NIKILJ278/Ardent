import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { Modal } from '../ui/index.jsx';
import {
  watchableMetrics, WATCH_METRICS, WINDOW_CHOICES, formatMetric,
  evaluateWatch, watchScopeLabel,
} from '../../data/watchlist.js';
import { productsFor, PRODUCT_BY_ID } from '../../data/catalog.js';
import { iso, fmtDate, currencySymbol } from '../../lib/format.js';

/**
 * Put a metric under watch from wherever it is being read.
 *
 * The form is deliberately opinionated about what a watch must carry: the
 * decision and the review date are required, because a watch without them is
 * just a bookmark. Three weeks later nobody can act on a number they cannot
 * remember the reason for.
 */
export function WatchForm({ subject, onClose }) {
  const { addWatch, companyId, today, can, author } = useApp();
  const metrics = watchableMetrics(can);

  // Whoever opened this already decided a scope (a chart, a product row, a
  // category drilldown) — that stands as-is. Opened bare, with nothing more
  // than the company, the only two honest starting points are "the whole
  // business" or "one product": a watch has to be one or the other, and
  // guessing which product would be worse than asking.
  const hasPresetScope = !!(subject.channel || subject.category || subject.subcategory || subject.product || subject.sku);
  const products = useMemo(() => productsFor(subject.company ?? companyId), [subject.company, companyId]);
  const [scopeMode, setScopeMode] = useState(subject.product ? 'product' : 'company');
  const [productId, setProductId] = useState(subject.product ?? '');
  const chosenProduct = PRODUCT_BY_ID[productId];

  const [f, setF] = useState(() => ({
    title: subject.title ?? '',
    metric: subject.metric ?? metrics[0].id,
    windowDays: 21,
    // Clicking a point on a chart marks that point's own day, not today — the
    // whole reason to click a specific point is to flag what happened then.
    markedOn: subject.markedOn ?? iso(today),
    target: '',
    owner: author,
    meetingTitle: '',
    meetingDate: iso(today),
    attendees: '',
    discussion: '',
    decision: '',
  }));

  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));
  const metric = WATCH_METRICS[f.metric];

  // The watch as it would be saved, so the form can show today's reading and
  // the review date before anything is committed.
  const draft = {
    company: subject.company ?? companyId,
    ...(hasPresetScope
      ? { channel: subject.channel, category: subject.category, subcategory: subject.subcategory,
          product: subject.product, sku: subject.sku }
      : scopeMode === 'product'
        ? { product: productId || undefined, category: chosenProduct?.category, subcategory: chosenProduct?.subcategory }
        : {}),
    metric: f.metric, windowDays: Number(f.windowDays), markedOn: f.markedOn,
  };
  const preview = evaluateWatch(draft, today);
  const needsProduct = !hasPresetScope && scopeMode === 'product' && !productId;

  const submit = (e) => {
    e.preventDefault();
    addWatch({
      ...draft,
      title: f.title.trim(),
      target: f.target === '' ? null : Number(f.target),
      owner: f.owner.trim() || author,
      meeting: {
        date: f.meetingDate,
        title: f.meetingTitle.trim() || 'Ad-hoc review',
        attendees: f.attendees.split(',').map(a => a.trim()).filter(Boolean),
      },
      discussion: f.discussion.trim(),
      decision: f.decision.trim(),
    });
    onClose();
  };

  const ready = f.title.trim() && f.decision.trim() && !needsProduct;

  return (
    <Modal
      title="Watch this metric"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="watch-form" type="submit" disabled={!ready}>
            Start watching
          </button>
        </>
      }
    >
      <form id="watch-form" onSubmit={submit} className="vstack" style={{ gap: 13 }}>
        <div className="watch-subject">
          <span className="tiny muted">Watching</span>

          {!hasPresetScope && (
            <div className="hstack" style={{ gap: 6, margin: '4px 0 2px' }}>
              <button
                type="button" className={`btn btn-sm${scopeMode === 'company' ? ' btn-primary' : ''}`}
                onClick={() => setScopeMode('company')}
              >
                A metric, whole company
              </button>
              <button
                type="button" className={`btn btn-sm${scopeMode === 'product' ? ' btn-primary' : ''}`}
                onClick={() => setScopeMode('product')}
              >
                One product
              </button>
            </div>
          )}
          {!hasPresetScope && scopeMode === 'product' && (
            <select
              className="input" style={{ marginBottom: 4 }} aria-label="Product"
              value={productId} onChange={e => setProductId(e.target.value)}
            >
              <option value="">— choose a product —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}

          <div style={{ fontWeight: 600 }}>
            {needsProduct ? 'Pick a product above' : watchScopeLabel(draft)}
          </div>
          {f.markedOn !== iso(today) && (
            <div className="tiny muted" style={{ marginTop: 2 }}>
              Marked as of {fmtDate(f.markedOn, 'long')} — picked from the chart, not today
            </div>
          )}
        </div>

        <div>
          <label className="label">What are you watching, and why</label>
          <input
            className="input" value={f.title} autoFocus
            placeholder="e.g. Returns on the large size after the size-chart fix"
            onChange={set('title')}
          />
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">Metric</label>
            <select className="input" value={f.metric} onChange={set('metric')}>
              {metrics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Compare over</label>
            <select className="input" value={f.windowDays} onChange={set('windowDays')}>
              {WINDOW_CHOICES.map(w => <option key={w.days} value={w.days}>{w.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">
              Target {metric.unit === 'pct' ? '(%)' : metric.unit === 'inr' ? `(${currencySymbol()})` : ''}
              <span className="tiny muted"> optional</span>
            </label>
            <input
              className="input tnum" type="number" value={f.target}
              placeholder={metric.lowerIsBetter ? 'at most' : 'at least'}
              onChange={set('target')}
            />
          </div>
        </div>

        <div className="watch-preview">
          <div>
            <span className="tiny muted">{metric.label} over the last {f.windowDays} days</span>
            <div className="watch-preview-value">{formatMetric(metric, preview.baseline)}</div>
          </div>
          <div className="tiny muted" style={{ textAlign: 'right' }}>
            {preview.baseline == null
              ? <>This metric needs a source that is not connected.<br /></>
              : <>This becomes the baseline.<br /></>}
            Review falls due {fmtDate(preview.reviewOn, 'long')}.
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr', gap: 11 }}>
          <div>
            <label className="label">Meeting</label>
            <input className="input" value={f.meetingTitle} placeholder="e.g. Weekly operations review"
                   onChange={set('meetingTitle')} />
          </div>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={f.meetingDate} onChange={set('meetingDate')} />
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <div>
            <label className="label">In the room <span className="tiny muted">comma separated</span></label>
            <input className="input" value={f.attendees} placeholder="Who was there"
                   onChange={set('attendees')} />
          </div>
          <div>
            <label className="label">Owner</label>
            <input className="input" value={f.owner} onChange={set('owner')} placeholder="Who is accountable" />
          </div>
        </div>

        <div>
          <label className="label">What was discussed</label>
          <textarea className="input" value={f.discussion} rows={3}
                    placeholder="The evidence and the argument, so it still makes sense in three weeks."
                    onChange={set('discussion')} />
        </div>

        <div>
          <label className="label">What we decided to do</label>
          <textarea className="input" value={f.decision} rows={3}
                    placeholder="The action, who owns it, and what would count as it having worked."
                    onChange={set('decision')} />
        </div>
      </form>
    </Modal>
  );
}

/**
 * The action itself. `subject` names the scope being watched — company,
 * channel, category, subcategory, product, sku — plus optional defaults for
 * the metric and title.
 */
export function WatchButton({ subject, label = 'Watch', size = 'sm', iconOnly = false }) {
  const [open, setOpen] = useState(false);
  const { watches, companyId } = useApp();

  // Already watching this exact thing? Say so rather than inviting a duplicate.
  const existing = watches.find(w =>
    !w.closedOn &&
    w.company === (subject.company ?? companyId) &&
    (w.channel ?? null) === (subject.channel ?? null) &&
    (w.product ?? null) === (subject.product ?? null) &&
    (w.sku ?? null) === (subject.sku ?? null) &&
    (w.category ?? null) === (subject.category ?? null) &&
    (w.subcategory ?? null) === (subject.subcategory ?? null)
  );

  return (
    <>
      <button
        type="button"
        className={`btn btn-ghost${size === 'sm' ? ' btn-sm' : ''}${iconOnly ? ' btn-icon' : ''}${existing ? ' is-watching' : ''}`}
        title={existing ? `Already watching: ${existing.title}` : 'Watch this metric after a meeting'}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        <Eye size={14} />
        {!iconOnly && <span>{existing ? 'Watching' : label}</span>}
      </button>
      {open && <WatchForm subject={subject} onClose={() => setOpen(false)} />}
    </>
  );
}
