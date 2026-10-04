// The CEO Overview's own reads.
//
// Three jobs: the journey from GMV to what the company keeps, a short read on
// which products are winning and which are coming back, and an explanation of
// every movement worth explaining.
//
// Nothing here recomputes a figure another page derives — each function calls
// the same model the Sales page calls, so the Overview can never tell a
// different story from the module underneath it.

import { salesModel, groupBy, series, totals, bucketStart } from './engine.js';
import { PRODUCT_BY_ID, CHANNEL_BY_ID, productForVariant, variantById } from './catalog.js';
import { eventChannels, EVENT_KINDS, eventImpact } from './business.js';
import { fmtDate } from '../lib/format.js';

/* ── A customisable Overview ───────────────────────────────────────────────
 *
 * A CEO and a CFO read this page differently — one wants growth and the
 * revenue story up top, the other wants margin and the financial position.
 * Rather than pick a single fixed layout, the page is a set of named
 * sections and a set of headline metrics, both reorderable and both
 * individually removable, chosen once in Settings and remembered per browser.
 *
 * Section order never changes what a section computes, only whether and
 * where it appears — so "customise the page" can never mean "customise the
 * numbers".
 */

export const OVERVIEW_SECTIONS = [
  { id: 'ladder', label: 'Revenue', blurb: 'GMV stepped down to net sales, by what came off it.' },
  { id: 'products', label: 'Product intelligence', blurb: 'What is carrying the business, what is not paying its way, and what is coming back.' },
  { id: 'markets', label: 'Markets', blurb: 'Where the demand came from, when the store sells in more than one currency. Hidden on its own when there is only one.' },
  { id: 'trend', label: 'GMV trend', blurb: 'GMV over time, with the business events that explain the movements.' },
  { id: 'financials', label: 'Financial position', blurb: 'Gross sales down to gross margin, and what still needs a source.' },
  { id: 'health', label: 'Company health', blurb: 'The indicators chosen under "View health breakdown", scored from measured ratios.' },
  { id: 'goals', label: 'Goals & targets', blurb: 'Progress against whatever is set on the Goals page.' },
  { id: 'timeline', label: 'Business timeline', blurb: 'Launches, price changes and campaigns, with their revenue impact.' },
  { id: 'sources', label: 'Data sources', blurb: 'What is connected, and when each one last synced.' },
];
export const OVERVIEW_SECTION_BY_ID = Object.fromEntries(OVERVIEW_SECTIONS.map(s => [s.id, s]));
export const DEFAULT_OVERVIEW_LAYOUT = OVERVIEW_SECTIONS.map(s => s.id);

/** A saved layout, made safe: unknown ids dropped, new sections appended visible. */
export function normaliseOverviewLayout(ids) {
  const known = DEFAULT_OVERVIEW_LAYOUT;
  const kept = (Array.isArray(ids) ? ids : []).filter(id => known.includes(id));
  // No "missing ids get appended back": a section absent from a saved layout
  // was deliberately removed, and re-adding it would make a removal
  // indistinguishable from a section that simply did not exist yet. Only an
  // empty result (corrupt storage, or every section somehow dropped) falls
  // back to the default — never a partial one.
  return kept.length ? kept : DEFAULT_OVERVIEW_LAYOUT;
}

/* ── The headline metric strip ───────────────────────────────────────────── */

export const OVERVIEW_KPI_SLOTS = 4;

export const OVERVIEW_KPIS = [
  { id: 'growth',      label: null, fmt: 'growth', blurb: 'Net sales against the comparison period — MoM, QoQ or YoY, whichever is set.' },
  { id: 'netSales',    label: 'Net Sales',          fmt: 'money', blurb: 'Gross sales, less cancellations, returns and discounts.' },
  { id: 'grossSales',  label: 'Gross Sales',        fmt: 'money', blurb: 'Before any deductions.' },
  { id: 'grossMargin', label: 'Gross Margin',       fmt: 'pct',   blurb: 'Net sales less cost of goods. Needs a unit cost on every sold product.' },
  { id: 'orders',      label: 'Orders',             fmt: 'num',   blurb: 'Distinct orders in the period — one order with several products counts once.' },
  { id: 'aov',         label: 'AOV',                fmt: 'money', blurb: 'Net sales per order.' },
  { id: 'units',       label: 'Units Sold',         fmt: 'num',   blurb: 'Total quantity ordered.' },
  { id: 'returnPct',   label: 'Return Rate',        fmt: 'pct',   blurb: 'Returned value against gross sales.' },
  { id: 'cancelPct',   label: 'Cancellation Rate',  fmt: 'pct',   blurb: 'Cancelled value against gross sales.' },
  { id: 'discountPct', label: 'Discount Rate',      fmt: 'pct',   blurb: 'Discount given against gross sales.' },
];
export const OVERVIEW_KPI_BY_ID = Object.fromEntries(OVERVIEW_KPIS.map(k => [k.id, k]));
export const DEFAULT_OVERVIEW_KPIS = ['growth', 'netSales', 'grossMargin'];

/** A saved KPI list, made safe: unknown ids dropped, capped at the strip's slots. */
export function normaliseOverviewKpis(ids) {
  const known = OVERVIEW_KPIS.map(k => k.id);
  const kept = (Array.isArray(ids) ? ids : []).filter(id => known.includes(id)).slice(0, OVERVIEW_KPI_SLOTS);
  return kept.length ? kept : DEFAULT_OVERVIEW_KPIS;
}

/**
 * One chosen KPI's raw value, read off the same company-wide sales model the
 * rest of the Overview uses — never recomputed, so the strip can never
 * disagree with the cards below it. `growth` has no single source figure
 * (it is a comparison, not a balance), so it is read separately by the page.
 */
export function overviewKpiValue(id, m) {
  switch (id) {
    case 'netSales':    return m.netSales;
    case 'grossSales':  return m.grossSales;
    case 'grossMargin': return m.costComplete ? m.grossMarginPct : null;
    case 'orders':       return m.orders;
    case 'aov':          return m.aov;
    case 'units':        return m.units;
    case 'returnPct':    return m.returnPct;
    case 'cancelPct':    return m.cancelPct;
    case 'discountPct':  return m.discountPct;
    default: return null;
  }
}

/* ── GMV to realized sales ─────────────────────────────────────────────── */

/**
 * The journey, as stepped rows.
 *
 * GMV down to net sales is real. The charges between net sales and money that
 * lands — gateway fees, courier costs, warehousing — are not in Shopify's order
 * data, so those rows are listed but carry no value, and final realized sales
 * is unknown. The gap is shown rather than filled with an assumed rate.
 *
 * Percentages are of GMV throughout, so every line compares on the same base.
 */
export function realizedLadder(scope) {
  const m = salesModel(scope);
  const gmv = m.grossSales || 1;
  const pctOfGmv = (v) => (v == null ? null : (v / gmv) * 100);

  const toNet = [
    { id: 'returns', label: 'Returns', value: m.returns },
    { id: 'cancellations', label: 'Cancellations', value: m.cancellations },
    { id: 'discounts', label: 'Discounts', value: m.discounts },
  ];
  const toRealized = [
    { id: 'fees', label: 'Payment gateway charges' },
    { id: 'logistics', label: 'Shipping & courier costs' },
    { id: 'other', label: 'Warehousing, fulfilment & other' },
  ];

  const rows = [
    { id: 'gmv', label: 'GMV', kind: 'head', value: m.grossSales, pct: 100 },
    ...toNet.map(r => ({ ...r, kind: 'deduct', pct: pctOfGmv(r.value) })),
    { id: 'netSales', label: 'Net Sales', kind: 'subtotal', value: m.netSales, pct: pctOfGmv(m.netSales) },
    ...toRealized.map(r => ({ ...r, kind: 'missing', value: null, pct: null })),
    { id: 'realized', label: 'Final Realized Sales', kind: 'total', value: null, pct: null, missing: true },
  ];

  return {
    rows,
    gmv: m.grossSales,
    netSales: m.netSales,
    netSalesPct: pctOfGmv(m.netSales),
    realized: null,
    realizedKnown: false,
    realizedPct: null,
    // What is known to come off GMV so far — not the full deduction.
    knownDeductions: m.grossSales - m.netSales,
    model: m,
  };
}

/* ── Product intelligence ──────────────────────────────────────────────── */

/**
 * Three short lists rather than one long table: what is carrying the business,
 * what is not paying its way, and what is coming back.
 *
 * Returns are ranked by variant, because it is a size or colour that gets sent
 * back, and filtered by value, because a 40% return rate on four units is noise.
 */
export function productIntelligence(scope, prevScope, limit = 4) {
  const cur = groupBy(scope, 'product');
  const prev = new Map(groupBy(prevScope, 'product').map(r => [r.key, r]));
  if (!cur.length) return { top: [], weak: [], returns: [], count: 0, averageReturnPct: 0 };

  const rows = cur.map(r => {
    const p = PRODUCT_BY_ID[r.key];
    const pv = prev.get(r.key);
    return {
      id: r.key,
      name: p?.name ?? r.key,
      category: p?.category,
      subcategory: p?.subcategory,
      netSales: r.grossSales - r.cancelValue - r.returnsValue - r.discount,
      units: r.units,
      returnValue: r.returnsValue,
      returnPct: r.grossSales ? (r.returnsValue / r.grossSales) * 100 : 0,
      growth: pv?.net ? ((r.net - pv.net) / pv.net) * 100 : null,
    };
  });

  const bySales = [...rows].sort((a, b) => b.netSales - a.netSales);

  const variants = groupBy(scope, 'variant').map(v => {
    const product = productForVariant(v.key);
    const meta = variantById(v.key);
    return {
      id: v.key,
      name: product ? `${product.name} · ${meta?.title ?? 'Default'}` : v.key,
      productId: product?.id ?? null,
      code: meta?.sku ?? null,
      netSales: v.grossSales - v.cancelValue - v.returnsValue - v.discount,
      returnValue: v.returnsValue,
      returnPct: v.grossSales ? (v.returnsValue / v.grossSales) * 100 : 0,
    };
  });
  const withReturns = variants.filter(v => v.returnValue > 0);
  const meanReturn = withReturns.reduce((s, v) => s + v.returnValue, 0) / (withReturns.length || 1);
  const byReturns = withReturns
    .filter(v => v.returnValue >= meanReturn * 0.6)
    .sort((a, b) => b.returnPct - a.returnPct);

  const gross = cur.reduce((s, r) => s + r.grossSales, 0);
  const returned = cur.reduce((s, r) => s + r.returnsValue, 0);

  return {
    top: bySales.slice(0, limit),
    // With few products the two lists would repeat each other; only show a weak
    // list once there are products that are not already in the top one.
    weak: bySales.length > limit ? bySales.slice(-limit).reverse() : [],
    returns: byReturns.slice(0, limit),
    count: rows.length,
    averageReturnPct: gross ? (returned / gross) * 100 : 0,
  };
}

/* ── GMV trend and the events that explain it ──────────────────────────── */

/** Whole months between two dates, inclusive of both ends. */
const monthSpan = (period) =>
  (period.end.getFullYear() - period.start.getFullYear()) * 12
  + (period.end.getMonth() - period.start.getMonth()) + 1;

/** Months to show when the selected period is too short to have a shape. */
export const TREND_MONTHS = 12;

/**
 * Month-on-month GMV, with the comparison series beneath it.
 *
 * A "This Month" filter would otherwise draw a single point, which is not a
 * trend — so when the selected period spans fewer than three months the chart
 * falls back to a trailing twelve-month window ending at the period, and says so.
 */
export function gmvTrend(scope, prevScope, period) {
  const span = period ? monthSpan(period) : 3;
  const rolling = span < 3;

  let curScope = scope, cmpScope = prevScope;
  if (rolling) {
    const end = new Date(scope.end);
    const start = new Date(end.getFullYear(), end.getMonth() - (TREND_MONTHS - 1), 1);
    start.setHours(0, 0, 0, 0);
    curScope = { ...scope, start, end };
    const cmpEnd = new Date(start.getTime() - 1);
    const cmpStart = new Date(cmpEnd.getFullYear(), cmpEnd.getMonth() - (TREND_MONTHS - 1), 1);
    cmpStart.setHours(0, 0, 0, 0);
    cmpScope = { ...scope, start: cmpStart, end: cmpEnd };
  }

  const cur = series(curScope, 'month');
  const cmp = series(cmpScope, 'month');
  const points = cur.map((d, i) => ({
    label: fmtDate(d.ts, 'month'),
    value: d.grossSales,
    compare: cmp[i]?.grossSales ?? null,
    ts: d.ts,
    date: d.date,
  }));

  points.rolling = rolling;
  points.months = points.length;
  points.scope = curScope;
  return points;
}

/** Movement between two adjacent buckets, as a signed percentage. */
const moveOf = (points, i) => {
  if (i <= 0) return null;
  const a = points[i - 1].value, b = points[i].value;
  return a > 0 ? ((b - a) / a) * 100 : null;
};

/**
 * Attach events to the buckets they landed in, and only keep the movements
 * worth a CEO's attention. A bucket earns an annotation only when it moved
 * beyond the threshold or carries an event you logged.
 */
export function trendAnnotations({ points, events, notes, companyId, channelId, threshold = 6 }) {
  const all = [...(events ?? []), ...(notes ?? [])]
    .filter(e => companyId === 'all' || e.company === companyId)
    .filter(e => channelId === 'all' || e.channels === 'all' || eventChannels(e).includes(channelId));

  const byBucket = new Map();
  for (const e of all) {
    const key = bucketStart(new Date(`${e.date}T12:00:00`).getTime(), 'month');
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key).push(e);
  }

  const RANK = { ops: 0, price: 1, promotion: 2, campaign: 3, launch: 4, channel: 5, business: 6, note: 7 };
  const out = [];
  points.forEach((p, i) => {
    const move = moveOf(points, i);
    const hits = byBucket.get(bucketStart(p.ts, 'month')) ?? [];
    if (!hits.length && !(move != null && Math.abs(move) >= threshold)) return;

    // The most severe event leads, so a stock-out is never hidden by a campaign.
    const lead = [...hits].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))[0];

    // The month's movement and the event's own effect are different numbers,
    // so the event carries its own measured window.
    let impact = null;
    if (lead) {
      const strongest = eventImpact(lead).find(x => x.changePct != null);
      if (strongest) {
        impact = {
          channel: CHANNEL_BY_ID[strongest.channel]?.name ?? strongest.channel,
          changePct: strongest.changePct,
          windowDays: strongest.windowDays,
          partial: strongest.partial,
        };
      }
    }

    out.push({
      index: i,
      date: p.date,
      label: p.label,
      move,
      direction: move == null ? 'flat' : move > 0 ? 'up' : 'down',
      event: lead ?? null,
      kind: lead ? (EVENT_KINDS[lead.kind]?.label ?? lead.kind) : null,
      others: Math.max(0, hits.length - 1),
      impact,
      explained: !!lead,
    });
  });
  return out;
}

/* ── What changed, why, and what it cost ───────────────────────────────── */

const signed = (n, unit = '%') => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}${unit}`;

/**
 * The Overview's interpretation layer. Each reading states the movement, names
 * the largest contributor where one genuinely leads, and quantifies the effect.
 */
export function readings({ scope, prevScope, fmt }) {
  const { money } = fmt;
  const cur = totals(scope);
  const prev = totals(prevScope);
  const out = [];
  if (!prev.grossSales) return out;

  const contributions = (dim) => {
    const p = new Map(groupBy(prevScope, dim).map(r => [r.key, r]));
    const nameOf = (k) => (dim === 'channel' ? CHANNEL_BY_ID[k]?.name ?? k : PRODUCT_BY_ID[k]?.name ?? k);
    return groupBy(scope, dim).map(r => {
      const before = p.get(r.key);
      return {
        key: r.key,
        name: nameOf(r.key),
        grossSales: r.grossSales,
        delta: r.grossSales - (before?.grossSales ?? 0),
        deltaReturns: r.returnsValue - (before?.returnsValue ?? 0),
        pct: before?.grossSales ? ((r.grossSales - before.grossSales) / before.grossSales) * 100 : null,
      };
    });
  };

  /* 1. GMV. */
  const gmvMove = ((cur.grossSales - prev.grossSales) / prev.grossSales) * 100;
  const gmvDelta = cur.grossSales - prev.grossSales;
  const chans = contributions('channel').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const prods = contributions('product').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // A contributor that is 40% of the base moving 40% of the change has not
  // driven anything; name one only when its share of the move clearly exceeds
  // its share of the base. With a single channel there is nothing to compare.
  let why;
  if (chans.length > 1) {
    const lead = chans[0];
    const share = gmvDelta !== 0 ? (lead.delta / gmvDelta) * 100 : 0;
    const weight = cur.grossSales ? (lead.grossSales / cur.grossSales) * 100 : 0;
    why = share - weight > 12
      ? `${lead.name} drove it — ${Math.abs(share).toFixed(0)}% of the change on ${weight.toFixed(0)}% of the base`
      : 'the movement is broad-based across channels';
  } else if (prods.length > 1) {
    const lead = prods[0];
    const share = gmvDelta !== 0 ? (lead.delta / gmvDelta) * 100 : 0;
    why = Math.abs(share) > 35
      ? `${lead.name} accounts for ${Math.abs(share).toFixed(0)}% of the change`
      : 'no single product dominates the change';
  } else {
    why = 'a single product and channel carry all sales';
  }

  out.push({
    id: 'gmv',
    tone: gmvMove >= 0 ? 'good' : 'critical',
    what: `GMV ${gmvMove >= 0 ? 'increased' : 'declined'} ${Math.abs(gmvMove).toFixed(1)}%`,
    why,
    impact: prods[0] ? `${prods[0].name} ${prods[0].delta >= 0 ? 'added' : 'lost'} ${money(Math.abs(prods[0].delta))}` : null,
  });

  /* 2. Returns. */
  if (prev.returnsValue > 0) {
    const retMove = ((cur.returnsValue - prev.returnsValue) / prev.returnsValue) * 100;
    if (Math.abs(retMove) >= 5) {
      const retDelta = cur.returnsValue - prev.returnsValue;
      const worst = contributions('product').sort((a, b) => Math.abs(b.deltaReturns) - Math.abs(a.deltaReturns))[0];
      const share = retDelta !== 0 && worst ? (worst.deltaReturns / retDelta) * 100 : null;
      out.push({
        id: 'returns',
        tone: retMove <= 0 ? 'good' : 'critical',
        what: `Returns ${retMove >= 0 ? 'increased' : 'fell'} ${Math.abs(retMove).toFixed(1)}%`,
        why: worst && share != null && Math.abs(share) > 25
          ? `${worst.name} accounts for ${Math.abs(share).toFixed(0)}% of the change`
          : 'no single product dominates the change',
        impact: `Value ${retMove >= 0 ? 'lost' : 'recovered'} ${money(Math.abs(retDelta))}`,
      });
    }
  }

  /* 3. Gross margin — only when both periods were fully costed. */
  const curM = salesModel(scope);
  const prevM = salesModel(prevScope);
  if (curM.known.cogs && prevM.known.cogs) {
    const marginMove = curM.grossMarginPct - prevM.grossMarginPct;
    if (Math.abs(marginMove) >= 0.5) {
      const drivers = [
        { label: 'returns', move: curM.returnPct - prevM.returnPct },
        { label: 'discounting', move: curM.discountPct - prevM.discountPct },
        { label: 'cost of goods', move: curM.cogsPct - prevM.cogsPct },
      ].sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
      out.push({
        id: 'margin',
        tone: marginMove >= 0 ? 'good' : 'serious',
        what: `Gross margin ${marginMove >= 0 ? 'improved' : 'declined'} ${Math.abs(marginMove).toFixed(1)} percentage points`,
        why: `${drivers[0].label} moved ${signed(drivers[0].move, 'pp')}`,
        impact: `Now ${curM.grossMarginPct.toFixed(1)}% of net sales`,
      });
    }
  }

  return out;
}

/* ── Freshness ─────────────────────────────────────────────────────────── */

/** When a connected source last delivered data. */
export function lastUpdated(sources) {
  const synced = (sources ?? []).filter(s => s.status === 'connected' && s.lastSync);
  if (!synced.length) return null;
  const newest = synced.reduce((a, s) => (s.lastSync > a.lastSync ? s : a));
  return { at: newest.lastSync, source: newest.name, count: synced.length };
}

/** Platforms the CEO can switch between, from what this brand actually sells on. */
export function platformOptions(companyChannels) {
  return [
    { id: 'all', name: 'All Platforms' },
    ...companyChannels.map(id => ({ id, name: CHANNEL_BY_ID[id]?.name ?? id })),
  ];
}
