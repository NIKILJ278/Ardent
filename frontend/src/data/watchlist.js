// Watchlist — metrics put under observation after a meeting.
//
// The pattern this serves: a meeting decides something ("the XXL return rate is
// too high, we're reshooting the size chart"), and three weeks later somebody
// has to answer whether it worked. That needs three things kept together —
// what the number was on the day it was marked, what it is now, and what was
// actually said in the room.
//
// Every figure is read from the same fact table as the rest of the app, so a
// watch can never disagree with the page it was marked from. Nothing is seeded:
// every watch is one you created.

import { totals, series, TODAY, bucketStart } from './engine.js';
import { PRODUCT_BY_ID, CHANNEL_BY_ID, COMPANY_BY_ID, variantById } from './catalog.js';
import { PERM } from '../state/permissions.js';
import { iso, money, num, pct } from '../lib/format.js';

// ── Metrics that can be watched ───────────────────────────────────────────

/**
 * `of` reads a metric off an accumulated totals bucket, and returns null when
 * the bucket cannot answer it. `perm` gates cost metrics exactly as everywhere
 * else.
 */
export const WATCH_METRICS = {
  returnPct: {
    id: 'returnPct', label: 'Return rate', short: 'Return %', unit: 'pct',
    lowerIsBetter: true,
    of: (t) => (t.grossSales > 0 ? (t.returnsValue / t.grossSales) * 100 : 0),
    help: 'Returned value against gross sales.',
  },
  netSales: {
    id: 'netSales', label: 'Net sales', short: 'Net sales', unit: 'inr',
    lowerIsBetter: false,
    of: (t) => t.grossSales - t.cancelValue - t.returnsValue - t.discount,
    help: 'Gross sales less cancellations, returns and discounts.',
  },
  units: {
    id: 'units', label: 'Units sold', short: 'Units', unit: 'num',
    lowerIsBetter: false,
    of: (t) => t.units,
    help: 'Units ordered in the window.',
  },
  asp: {
    id: 'asp', label: 'Average selling price', short: 'ASP', unit: 'inr',
    lowerIsBetter: false,
    of: (t) => (t.units > 0 ? (t.grossSales - t.discount) / t.units : 0),
    help: 'Gross sales less discount, per unit.',
  },
  cancelPct: {
    id: 'cancelPct', label: 'Cancellation rate', short: 'Cancel %', unit: 'pct',
    lowerIsBetter: true,
    of: (t) => (t.grossSales > 0 ? (t.cancelValue / t.grossSales) * 100 : 0),
    help: 'Cancelled value against gross sales.',
  },
  discountPct: {
    id: 'discountPct', label: 'Discount rate', short: 'Discount %', unit: 'pct',
    lowerIsBetter: true,
    of: (t) => (t.grossSales > 0 ? (t.discount / t.grossSales) * 100 : 0),
    help: 'Total discount against gross sales.',
  },
  marginPct: {
    id: 'marginPct', label: 'Gross margin', short: 'Margin %', unit: 'pct',
    lowerIsBetter: false, perm: PERM.COGS,
    // Only a fully costed window can answer; a partial cost overstates margin.
    of: (t) => {
      const net = t.grossSales - t.cancelValue - t.returnsValue - t.discount;
      if (t.costGaps > 0 || net <= 0) return null;
      return ((net - t.cogs) / net) * 100;
    },
    help: 'Net sales less cost of goods, against net sales. Needs unit costs on every product.',
  },
};

export const WATCH_METRIC_LIST = Object.values(WATCH_METRICS);

/** A metric a stored watch names but that can no longer be measured. */
const RETIRED_METRIC = {
  id: 'retired', label: 'Metric no longer measured', short: '—', unit: 'num',
  lowerIsBetter: false, of: () => null,
  help: 'This watch tracks a figure that needs a source that is not connected.',
};

/** Metrics this role is allowed to put under watch. */
export function watchableMetrics(can) {
  return WATCH_METRIC_LIST.filter(m => !m.perm || can(m.perm));
}

export function formatMetric(metric, value) {
  if (value == null || Number.isNaN(value)) return '—';
  if (metric.unit === 'pct') return pct(value);
  if (metric.unit === 'inr') return money(value);
  return num(Math.round(value));
}

// ── Windows ───────────────────────────────────────────────────────────────

export const WINDOW_CHOICES = [
  { days: 7,  label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 21, label: '3 weeks' },
  { days: 28, label: '4 weeks' },
];

const DAY = 86400000;
const atStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const atEnd   = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const parseDay = (s) => (s instanceof Date ? new Date(s) : new Date(`${s}T00:00:00`));
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const daysBetween = (a, b) => Math.round((atStart(b) - atStart(a)) / DAY);

// ── Reading a watch's scope ───────────────────────────────────────────────

/**
 * Fact-table scope for a watch over a date window. A variant watch filters on
 * that variant's own rows, so a size-level watch reads that size's real orders.
 */
function scopeOf(watch, start, end) {
  return {
    start, end,
    company: watch.company,
    channel: watch.channel || undefined,
    category: watch.category || undefined,
    subcategory: watch.subcategory || undefined,
    product: watch.product || undefined,
    variant: watch.sku || undefined,
  };
}

/**
 * The inverse of `scopeOf`: a fact-table scope (company/channel/.../variant)
 * as a `WatchButton` subject (company/channel/.../sku). Lets a chart or table
 * already filtered to some scope offer "watch this" without restating it.
 */
export function subjectFromScope(scope, extra = {}) {
  return {
    company: scope.company, channel: scope.channel,
    category: scope.category, subcategory: scope.subcategory,
    product: scope.product, sku: scope.variant,
    ...extra,
  };
}

const metricFor = (watch) => WATCH_METRICS[watch.metric] ?? RETIRED_METRIC;

/** "Brand · Shopify · Product · Variant" */
export function watchScopeLabel(watch) {
  const parts = [];
  const co = COMPANY_BY_ID[watch.company];
  if (co) parts.push(co.name);
  if (watch.channel) parts.push(CHANNEL_BY_ID[watch.channel]?.name ?? watch.channel);
  if (watch.product) parts.push(PRODUCT_BY_ID[watch.product]?.name ?? 'Product no longer synced');
  else if (watch.subcategory) parts.push(watch.subcategory);
  else if (watch.category) parts.push(watch.category);
  const v = watch.sku ? variantById(watch.sku) : null;
  if (v) parts.push(v.title);
  return parts.join(' · ');
}

/** The narrowest thing the watch names, for a compact chip. */
export function watchSubject(watch) {
  const v = watch.sku ? variantById(watch.sku) : null;
  const productName = PRODUCT_BY_ID[watch.product]?.name;
  if (v) return `${productName ?? 'Product'} — ${v.title}`;
  if (watch.product) return productName ?? 'Product no longer synced';
  if (watch.subcategory) return watch.subcategory;
  if (watch.category) return watch.category;
  if (watch.channel) return CHANNEL_BY_ID[watch.channel]?.name ?? watch.channel;
  return COMPANY_BY_ID[watch.company]?.name ?? 'Whole company';
}

// ── Evaluating a watch ────────────────────────────────────────────────────

export const WATCH_STATUS = {
  settling:    { id: 'settling',    label: 'Settling',       tone: 'neutral'  },
  improving:   { id: 'improving',   label: 'Improving',      tone: 'good'     },
  flat:        { id: 'flat',        label: 'No change',      tone: 'warning'  },
  worsening:   { id: 'worsening',   label: 'Getting worse',  tone: 'critical' },
  closed:      { id: 'closed',      label: 'Closed',         tone: 'neutral'  },
  unavailable: { id: 'unavailable', label: 'Cannot measure', tone: 'neutral'  },
};

/** Below this, a move is noise rather than a result. */
const FLAT_BAND = 2.5; // percent, relative

/**
 * Compare the window before the metric was marked against the same length of
 * time ending today. Equal-length windows matter: a 21-day baseline against 9
 * days of aftermath would judge the decision purely on day count. Until a full
 * window has passed the result is reported as still settling.
 */
export function evaluateWatch(watch, today = TODAY) {
  const metric = metricFor(watch);
  const marked = parseDay(watch.markedOn);
  const win = watch.windowDays ?? 21;

  const asOf = watch.closedOn ? parseDay(watch.closedOn) : atStart(today);
  const elapsed = Math.max(0, daysBetween(marked, asOf));

  const baseEnd = atEnd(addDays(marked, -1));
  const baseStart = atStart(addDays(marked, -win));
  const curEnd = atEnd(asOf);
  const curStart = atStart(addDays(asOf, -(Math.min(win, Math.max(elapsed, 1)) - 1)));

  const baseline = metric.of(totals(scopeOf(watch, baseStart, baseEnd)));
  const current = metric.of(totals(scopeOf(watch, curStart, curEnd)));
  const measurable = baseline != null && current != null;

  const changePct = measurable && baseline !== 0 ? ((current - baseline) / Math.abs(baseline)) * 100 : null;
  const movedRight = measurable && (metric.lowerIsBetter ? current < baseline : current > baseline);

  const reviewOn = watch.reviewOn ? parseDay(watch.reviewOn) : addDays(marked, win);
  const daysToReview = daysBetween(atStart(today), reviewOn);

  let status;
  if (watch.closedOn) status = WATCH_STATUS.closed;
  else if (!measurable) status = WATCH_STATUS.unavailable;
  else if (elapsed < win) status = WATCH_STATUS.settling;
  else if (changePct == null || Math.abs(changePct) < FLAT_BAND) status = WATCH_STATUS.flat;
  else status = movedRight ? WATCH_STATUS.improving : WATCH_STATUS.worsening;

  const target = watch.target == null || watch.target === '' ? null : Number(watch.target);
  const hitTarget = target == null || current == null ? null
    : (metric.lowerIsBetter ? current <= target : current >= target);

  return {
    metric, baseline, current, changePct, movedRight, status,
    target, hitTarget,
    elapsed, windowDays: win,
    settling: elapsed < win,
    baseWindow: { start: baseStart, end: baseEnd },
    curWindow: { start: curStart, end: curEnd },
    reviewOn, daysToReview,
    dueForReview: !watch.closedOn && daysToReview <= 0,
    asOf,
  };
}

/**
 * Weekly readings of the metric either side of the mark, for the chart. The
 * range is symmetric where the data allows, so the break is judged against a
 * comparable run-up rather than a stub.
 */
export function watchSeries(watch, today = TODAY) {
  const metric = metricFor(watch);
  const marked = parseDay(watch.markedOn);
  const win = watch.windowDays ?? 21;
  const asOf = watch.closedOn ? parseDay(watch.closedOn) : atStart(today);

  const start = atStart(addDays(marked, -Math.max(win * 2, 28)));
  const markBucket = bucketStart(marked.getTime(), 'week');

  return series(scopeOf(watch, start, atEnd(asOf)), 'week').map(b => ({
    date: b.date,
    ts: b.ts,
    value: metric.of(b),
    after: b.date >= markBucket,
  }));
}

/** Watches for a brand and role, newest mark first. */
export function visibleWatches(watches, companyId, can) {
  return (watches ?? [])
    .filter(w => companyId === 'all' || w.company === companyId)
    .filter(w => {
      const m = WATCH_METRICS[w.metric];
      return !m?.perm || can(m.perm);
    })
    .sort((a, b) => (a.markedOn < b.markedOn ? 1 : -1));
}

/** A new watch, with the fields the UI does not ask for filled in. */
export function newWatch(fields, today = TODAY) {
  const win = fields.windowDays ?? 21;
  const marked = fields.markedOn ?? iso(today);
  return {
    updates: [],
    ...fields,
    markedOn: marked,
    windowDays: win,
    reviewOn: fields.reviewOn || iso(addDays(parseDay(marked), win)),
  };
}
