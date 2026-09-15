// Watchlist — metrics put under observation after a meeting.
//
// The pattern this serves: a meeting decides something ("the XXL return rate is
// too high, we're reshooting the size chart"), and three weeks later somebody
// has to answer whether it worked. That needs three things kept together —
// what the number was on the day it was marked, what it is now, and what was
// actually said in the room. Losing any one of them makes the other two useless.
//
// Every figure is read from the same fact table as the rest of the app, so a
// watch can never disagree with the page it was marked from.

import { totals, series, TODAY, bucketStart } from './engine.js';
import {
  PRODUCT_BY_ID, CHANNEL_BY_ID, COMPANY_BY_ID, skusForProduct,
} from './catalog.js';
import { PERM } from '../state/permissions.js';
import { iso, inr, num, pct } from '../lib/format.js';

// ── Metrics that can be watched ───────────────────────────────────────────

/**
 * `of` reads a metric off an accumulated totals bucket. Net sales uses the
 * Sales-ladder definition — gross less cancellations, returns and discounts —
 * so a watch marked from the product matrix reports the same number the matrix
 * showed. `perm` gates the profitability metrics exactly as everywhere else.
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
    help: 'Units despatched in the window.',
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
    help: 'Total discount, platform and brand funded, against gross sales.',
  },
  rtoShare: {
    id: 'rtoShare', label: 'RTO share of returns', short: 'RTO %', unit: 'pct',
    lowerIsBetter: true,
    of: (t) => (t.returnsValue > 0 ? (t.rtoValue / t.returnsValue) * 100 : 0),
    help: 'Returned before delivery, against all returned value.',
  },
  marginPct: {
    id: 'marginPct', label: 'Contribution margin (CM1)', short: 'CM1 %', unit: 'pct',
    lowerIsBetter: false, perm: PERM.CONTRIBUTION,
    of: (t) => (t.net > 0 ? (t.margin / t.net) * 100 : 0),
    help: 'Margin after COGS and channel cost, against net revenue.',
  },
};

export const WATCH_METRIC_LIST = Object.values(WATCH_METRICS);

/** Metrics this role is allowed to put under watch. */
export function watchableMetrics(can) {
  return WATCH_METRIC_LIST.filter(m => !m.perm || can(m.perm));
}

export function formatMetric(metric, value) {
  if (value == null || Number.isNaN(value)) return '—';
  if (metric.unit === 'pct') return pct(value);
  if (metric.unit === 'inr') return inr(value);
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
 * A watched SKU is a variant of a product, and variants are ratio splits of
 * their parent — the same split the SKU tables and the product matrix use, so
 * the three always agree. Returns carry the variant's own propensity, which is
 * the whole reason a size-level watch is worth keeping.
 */
function applyVariant(t, sku) {
  const r = sku.ratio;
  return {
    ...t,
    units: t.units * r,
    orders: t.orders * r,
    gross: t.gross * r,
    grossSales: t.grossSales * r,
    cancelValue: t.cancelValue * r,
    discount: t.discount * r,
    fees: t.fees * r,
    net: t.net * r,
    cogs: t.cogs * r,
    margin: t.margin * r,
    returnsValue: t.returnsValue * r * sku.returnFactor,
    returnValue: t.returnValue * r * sku.returnFactor,
    rtoValue: t.rtoValue * r * sku.returnFactor,
  };
}

/** The variant a watch points at, if any. */
function variantOf(watch) {
  if (!watch.sku || !watch.product) return null;
  const product = PRODUCT_BY_ID[watch.product];
  if (!product) return null;
  return skusForProduct(product).find(s => s.id === watch.sku) ?? null;
}

/** Fact-table scope for a watch over a date window. */
function scopeOf(watch, start, end) {
  return {
    start, end,
    company: watch.company,
    channel: watch.channel || undefined,
    category: watch.category || undefined,
    subcategory: watch.subcategory || undefined,
    product: watch.product || undefined,
  };
}

function readWindow(watch, start, end) {
  const t = totals(scopeOf(watch, start, end));
  const v = variantOf(watch);
  return v ? applyVariant(t, v) : t;
}

/** "Kosha · Amazon · Bedding › Bedsheets › Malabar Cotton Bedsheet Set · King" */
export function watchScopeLabel(watch) {
  const parts = [];
  const co = COMPANY_BY_ID[watch.company];
  if (co) parts.push(co.name);
  if (watch.channel) parts.push(CHANNEL_BY_ID[watch.channel]?.name ?? watch.channel);
  if (watch.product) parts.push(PRODUCT_BY_ID[watch.product]?.name ?? watch.product);
  else if (watch.subcategory) parts.push(watch.subcategory);
  else if (watch.category) parts.push(watch.category);
  const v = variantOf(watch);
  if (v) parts.push(v.label);
  return parts.join(' · ');
}

/** The narrowest thing the watch names, for a compact chip. */
export function watchSubject(watch) {
  const v = variantOf(watch);
  if (v) return `${PRODUCT_BY_ID[watch.product]?.name ?? watch.product} — ${v.label}`;
  if (watch.product) return PRODUCT_BY_ID[watch.product]?.name ?? watch.product;
  if (watch.subcategory) return watch.subcategory;
  if (watch.category) return watch.category;
  if (watch.channel) return CHANNEL_BY_ID[watch.channel]?.name ?? watch.channel;
  return COMPANY_BY_ID[watch.company]?.name ?? 'Whole company';
}

// ── Evaluating a watch ────────────────────────────────────────────────────

export const WATCH_STATUS = {
  settling:  { id: 'settling',  label: 'Settling',      tone: 'neutral'  },
  improving: { id: 'improving', label: 'Improving',     tone: 'good'     },
  flat:      { id: 'flat',      label: 'No change',     tone: 'warning'  },
  worsening: { id: 'worsening', label: 'Getting worse', tone: 'critical' },
  closed:    { id: 'closed',    label: 'Closed',        tone: 'neutral'  },
};

/** Below this, a move is noise rather than a result. */
const FLAT_BAND = 2.5; // percent, relative

/**
 * Compare the window before the metric was marked against the same length of
 * time ending today.
 *
 * Equal-length windows matter: a 21-day baseline against 9 days of aftermath
 * would flatter or damn the decision purely on day count. Until a full window
 * has passed the result is reported as still settling rather than as a verdict.
 */
export function evaluateWatch(watch, today = TODAY) {
  const metric = WATCH_METRICS[watch.metric] ?? WATCH_METRICS.netSales;
  const marked = parseDay(watch.markedOn);
  const win = watch.windowDays ?? 21;

  const asOf = watch.closedOn ? parseDay(watch.closedOn) : atStart(today);
  const elapsed = Math.max(0, daysBetween(marked, asOf));

  // Baseline: the window ending the day before the mark.
  const baseEnd = atEnd(addDays(marked, -1));
  const baseStart = atStart(addDays(marked, -win));

  // Current: the same length of time ending at the as-of date. Never reaches
  // back past the mark, so the two windows cannot overlap.
  const curEnd = atEnd(asOf);
  const curStart = atStart(addDays(asOf, -(Math.min(win, Math.max(elapsed, 1)) - 1)));

  const baseT = readWindow(watch, baseStart, baseEnd);
  const curT = readWindow(watch, curStart, curEnd);

  const baseline = metric.of(baseT);
  const current = metric.of(curT);

  const changePct = baseline !== 0 ? ((current - baseline) / Math.abs(baseline)) * 100 : null;
  // "Better" is the metric's own direction, not the sign of the change.
  const movedRight = metric.lowerIsBetter ? current < baseline : current > baseline;

  const reviewOn = watch.reviewOn ? parseDay(watch.reviewOn) : addDays(marked, win);
  const daysToReview = daysBetween(atStart(today), reviewOn);

  let status;
  if (watch.closedOn) status = WATCH_STATUS.closed;
  else if (elapsed < win) status = WATCH_STATUS.settling;
  else if (changePct == null || Math.abs(changePct) < FLAT_BAND) status = WATCH_STATUS.flat;
  else status = movedRight ? WATCH_STATUS.improving : WATCH_STATUS.worsening;

  // A target is optional; when set it is the bar the meeting actually agreed to.
  const target = watch.target == null || watch.target === '' ? null : Number(watch.target);
  const hitTarget = target == null ? null
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
 * range is symmetric where the data allows it, so the eye judges the break
 * against a comparable run-up rather than a stub.
 */
export function watchSeries(watch, today = TODAY) {
  const metric = WATCH_METRICS[watch.metric] ?? WATCH_METRICS.netSales;
  const marked = parseDay(watch.markedOn);
  const win = watch.windowDays ?? 21;
  const asOf = watch.closedOn ? parseDay(watch.closedOn) : atStart(today);

  const start = atStart(addDays(marked, -Math.max(win * 2, 28)));
  const buckets = series(scopeOf(watch, start, atEnd(asOf)), 'week');
  const v = variantOf(watch);
  const markBucket = bucketStart(marked.getTime(), 'week');

  return buckets.map(b => {
    const t = v ? applyVariant(b, v) : b;
    return {
      date: b.date,
      ts: b.ts,
      value: metric.of(t),
      after: b.date >= markBucket,
    };
  });
}

/** Watches for a company and role, newest mark first, due ones surfaced. */
export function visibleWatches(watches, companyId, can) {
  return (watches ?? [])
    .filter(w => companyId === 'all' || w.company === companyId)
    .filter(w => {
      const m = WATCH_METRICS[w.metric];
      return !m?.perm || can(m.perm);
    })
    .sort((a, b) => (a.markedOn < b.markedOn ? 1 : -1));
}

// ── Seed watches ──────────────────────────────────────────────────────────
//
// Dated so the module opens on a realistic mix: two past their review date,
// one still settling, one already closed with the outcome written down.

export const SEED_WATCHES = [
  {
    id: 'w1',
    company: 'kosha',
    title: 'King-size bedsheet returns after the size-chart fix',
    metric: 'returnPct',
    category: 'Bedding', subcategory: 'Bedsheets',
    product: 'ko-bed-01', sku: 'ko-bed-01-v1',
    channel: 'amazon',
    windowDays: 21,
    markedOn: '2026-09-05',
    reviewOn: '2026-09-26',
    target: 8,
    meeting: {
      date: '2026-09-05',
      title: 'Weekly operations review',
      attendees: ['Kavya Iyer', 'Rhea Mehta', 'Vismay Shah'],
    },
    discussion:
      'King returns on Amazon are running well above the other two sizes. Kavya pulled 40 return '
      + 'reasons — 26 were "size smaller than expected". The listing images use a Queen bed, so the '
      + 'drop looks longer than it is.',
    decision:
      'Reshoot the King listing on a King bed, add a measured size chart with a fitted-corner note, '
      + 'and hold price. Kavya to ship by 12 Sep. Review the return rate three weeks after.',
    owner: 'Kavya Iyer',
    author: 'Vismay Shah',
    updates: [
      { date: '2026-09-13', author: 'Kavya Iyer', text: 'New images and size chart live on Amazon since 12 Sep. Flipkart listing unchanged, so it stays as the control.' },
    ],
  },
  {
    id: 'w2',
    company: 'kosha',
    title: 'Discount rate after the festive lightning deal',
    metric: 'discountPct',
    category: 'Bedding',
    channel: 'amazon',
    windowDays: 14,
    markedOn: '2026-09-12',
    reviewOn: '2026-09-26',
    target: null,
    meeting: {
      date: '2026-09-12',
      title: 'Festive pricing call',
      attendees: ['Rhea Mehta', 'Arjun Nair'],
    },
    discussion:
      'Amazon pushed for two lightning deals on the Malabar range through the festive run-up. '
      + 'Concern was that the deal price becomes the reference price and discount never comes back down.',
    decision:
      'Run the deals, but watch the blended discount rate on Bedding. If it does not return to the '
      + 'pre-deal level within a fortnight of the deal ending, we stop taking deal slots in October.',
    owner: 'Rhea Mehta',
    author: 'Vismay Shah',
    updates: [],
  },
  {
    id: 'w3',
    company: 'kosha',
    title: 'Cast iron kadai units after the listing refresh',
    metric: 'units',
    category: 'Kitchen', subcategory: 'Cookware',
    product: 'ko-kit-01',
    windowDays: 21,
    markedOn: '2026-08-08',
    reviewOn: '2026-08-29',
    target: null,
    closedOn: '2026-08-30',
    outcome: 'worked',
    closingNote:
      'Units up comfortably on the pre-refresh window and it has held since. A+ content and the '
      + 'seasoning video are staying. Rolling the same treatment onto the serveware listings next.',
    meeting: {
      date: '2026-08-08',
      title: 'Category review — Kitchen',
      attendees: ['Rhea Mehta', 'Arjun Nair', 'Vismay Shah'],
    },
    discussion:
      'Kadai has the best margin in Kitchen but the worst listing. No A+ content, three images, no '
      + 'seasoning instructions — which is also the top pre-purchase question in the Q&A.',
    decision:
      'Rebuild the listing with A+ content and a seasoning video. Arjun to publish by 15 Aug. '
      + 'Check units three weeks on before spending anything on ads behind it.',
    owner: 'Arjun Nair',
    author: 'Vismay Shah',
    updates: [
      { date: '2026-08-16', author: 'Arjun Nair', text: 'A+ content live 14 Aug, a day late. Video is on the listing and in the Amazon Post.' },
    ],
  },
  {
    id: 'w4',
    company: 'verve',
    title: 'XXL shirt returns after the fit-guide change',
    metric: 'returnPct',
    category: 'Menswear', subcategory: 'Shirts',
    product: 've-men-02', sku: 've-men-02-v4',
    channel: 'myntra',
    windowDays: 21,
    markedOn: '2026-09-04',
    reviewOn: '2026-09-25',
    target: 9,
    meeting: {
      date: '2026-09-04',
      title: 'Returns deep-dive',
      attendees: ['Neha Kulkarni', 'Kavya Iyer'],
    },
    discussion:
      'XXL is returning at roughly double the rate of M and L on Myntra. Chest measurement on the '
      + 'tech pack is right, but the garment runs short in the body at XXL, which reads as a fit failure.',
    decision:
      'Publish measured garment dimensions per size on the Myntra listing and flag the short body in '
      + 'the fit note. Longer-body XXL goes into the next production run either way. Review in three weeks.',
    owner: 'Neha Kulkarni',
    author: 'Vismay Shah',
    updates: [],
  },
  {
    id: 'w5',
    company: 'nutreats',
    title: 'Plant Protein sell-through after launch',
    metric: 'units',
    category: 'Supplements', subcategory: 'Protein',
    product: 'nu-sup-03',
    windowDays: 14,
    markedOn: '2026-09-16',
    reviewOn: '2026-09-30',
    target: null,
    meeting: {
      date: '2026-09-16',
      title: 'Launch check-in',
      attendees: ['Imran Qureshi', 'Vismay Shah'],
    },
    discussion:
      'Three weeks post-launch the direct storefront is carrying the volume and Amazon is quiet. '
      + 'Open question is whether Amazon is a ranking problem or a demand problem.',
    decision:
      'Hold spend flat for a fortnight and watch units. If Amazon has not moved by end of September '
      + 'we treat it as a ranking problem and put review-generation behind it rather than more spend.',
    owner: 'Imran Qureshi',
    author: 'Vismay Shah',
    updates: [],
  },
];

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
