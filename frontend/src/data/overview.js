// The CEO Overview's own reads.
//
// Three jobs: the journey from marketplace GMV to what the company actually
// keeps, a short read on which products are winning and which are costing
// money, and an explanation of every movement worth explaining.
//
// Nothing here recomputes a figure another page derives — each function calls
// the same model the Sales and Finance pages call, so the Overview can never
// tell a different story from the module underneath it.

import {
  salesModel, groupBy, series, totals, query, TODAY, bucketStart,
} from './engine.js';
import { PRODUCT_BY_ID, CHANNEL_BY_ID, skusForProduct } from './catalog.js';
import { eventChannels, EVENT_KINDS, eventImpact } from './business.js';
import { fmtDate } from '../lib/format.js';

/* ── GMV to realized sales ─────────────────────────────────────────────── */

/**
 * The full journey, as stepped rows.
 *
 * GMV is gross sales including orders that were later cancelled, because that
 * is what the marketplace reports and what the CEO sees in Seller Central.
 * Everything below it is a real deduction taken from the same fact rows, so the
 * ladder lands on exactly the realized sales the Channel Economics page shows.
 *
 * Percentages are of GMV throughout, so "returns 4.9%" means the same thing on
 * every line rather than shifting base as the ladder descends.
 */
export function realizedLadder(scope) {
  const m = salesModel(scope);
  const gmv = m.grossSales || 1;
  const pctOfGmv = (v) => (v / gmv) * 100;

  const toNet = [
    { id: 'returns', label: 'Returns & RTO', value: m.returns },
    { id: 'cancellations', label: 'Cancellations', value: m.cancellations },
    { id: 'discounts', label: 'Discounts', value: m.discounts },
  ];
  const toRealized = [
    { id: 'fees', label: 'Marketplace charges', value: m.channelFees },
    { id: 'logistics', label: 'Logistics & collection', value: m.logistics + m.paymentFees },
    { id: 'other', label: 'Warehousing, fulfilment & other', value: m.warehousing + m.fulfilment + m.otherCost },
  ];

  const rows = [
    { id: 'gmv', label: 'GMV', kind: 'head', value: m.grossSales, pct: 100 },
    ...toNet.map(r => ({ ...r, kind: 'deduct', pct: pctOfGmv(r.value) })),
    { id: 'netSales', label: 'Net Sales', kind: 'subtotal', value: m.netSales, pct: pctOfGmv(m.netSales) },
    ...toRealized.map(r => ({ ...r, kind: 'deduct', pct: pctOfGmv(r.value) })),
    { id: 'realized', label: 'Final Realized Sales', kind: 'total', value: m.realizedSales, pct: pctOfGmv(m.realizedSales) },
  ];

  return {
    rows,
    gmv: m.grossSales,
    netSales: m.netSales,
    realized: m.realizedSales,
    totalDeductions: m.grossSales - m.realizedSales,
    realizedPct: pctOfGmv(m.realizedSales),
    model: m,
  };
}

/* ── Product intelligence ──────────────────────────────────────────────── */

/**
 * Three short lists rather than one long table: what is carrying the business,
 * what is not paying its way, and what is coming back.
 *
 * The return list is ranked by rate but filtered by value, because a 40% return
 * rate on a product that sold four units is noise, not a problem.
 */
export function productIntelligence(scope, prevScope, limit = 4) {
  const cur = groupBy(scope, 'product');
  const prev = new Map(groupBy(prevScope, 'product').map(r => [r.key, r]));
  if (!cur.length) return { top: [], weak: [], returns: [], count: 0 };

  const rows = cur.map(r => {
    const p = PRODUCT_BY_ID[r.key];
    const pv = prev.get(r.key);
    const netSales = r.grossSales - r.cancelValue - r.returnsValue - r.discount;
    return {
      id: r.key,
      name: p?.name ?? r.key,
      category: p?.category,
      subcategory: p?.subcategory,
      netSales,
      units: r.units,
      returnValue: r.returnsValue,
      returnPct: r.grossSales ? (r.returnsValue / r.grossSales) * 100 : 0,
      growth: pv?.net ? ((r.net - pv.net) / pv.net) * 100 : null,
      isNew: !!p?.launchedOn,
    };
  });

  const bySales = [...rows].sort((a, b) => b.netSales - a.netSales);

  // Returns are ranked at variant level, not product level.
  //
  // A product's return rate is an average over its sizes and barely moves
  // between products — every one lands near the company rate, so a product
  // ranking says nothing. The spread lives in the variants, which is also where
  // the fix lives: it is a size that gets sent back, not a catalogue entry.
  const variants = [];
  for (const r of rows) {
    const product = PRODUCT_BY_ID[r.id];
    if (!product) continue;
    for (const v of skusForProduct(product)) {
      const returnValue = r.returnValue * v.ratio * v.returnFactor;
      const gross = (r.netSales + r.returnValue) * v.ratio;
      variants.push({
        id: v.id,
        name: `${product.name} · ${v.label}`,
        productId: r.id,
        code: v.code,
        netSales: r.netSales * v.ratio,
        returnValue,
        returnPct: gross > 0 ? (returnValue / gross) * 100 : 0,
      });
    }
  }
  // A high rate on a trickle of sales is noise. Only variants carrying at least
  // an average share of returned value can qualify as a problem.
  const meanReturn = variants.reduce((s, v) => s + v.returnValue, 0) / (variants.length || 1);
  const byReturns = variants
    .filter(v => v.returnValue >= meanReturn * 0.6)
    .sort((a, b) => b.returnPct - a.returnPct);

  return {
    top: bySales.slice(0, limit),
    weak: bySales.slice(-limit).reverse(),
    returns: byReturns.slice(0, limit),
    count: rows.length,
    averageReturnPct: rows.reduce((s, r) => s + r.returnValue, 0)
      / (rows.reduce((s, r) => s + r.netSales + r.returnValue, 0) || 1) * 100,
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
 * falls back to a trailing twelve-month window ending at the period. The caller
 * is told which window it got, and says so on the card, because a chart whose
 * range silently differs from the page filter is worse than a short one.
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
    // The comparison is the twelve months before that, so like meets like.
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
 * worth a CEO's attention.
 *
 * A pointer on every wobble is clutter, so a bucket earns an annotation only
 * when it either moved beyond the threshold or carries a logged event. The
 * quoted percentage is the measured movement, never the event's claimed effect.
 */
export function trendAnnotations({ points, events, notes, companyId, channelId, threshold = 6 }) {
  const all = [...(events ?? []), ...(notes ?? [])]
    .filter(e => companyId === 'all' || e.company === companyId)
    .filter(e => channelId === 'all' || e.channels === 'all' || eventChannels(e).includes(channelId));

  const byBucket = new Map();
  for (const e of all) {
    const ts = new Date(`${e.date}T12:00:00`).getTime();
    const key = bucketStart(ts, 'month');
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key).push(e);
  }

  const out = [];
  points.forEach((p, i) => {
    const move = moveOf(points, i);
    const key = bucketStart(p.ts, 'month');
    const hits = byBucket.get(key) ?? [];
    const big = move != null && Math.abs(move) >= threshold;
    if (!hits.length && !big) return;

    // One pointer per bucket. Where several events landed, the most severe
    // leads, so a stock-out is never hidden behind a campaign.
    const RANK = { ops: 0, price: 1, promotion: 2, campaign: 3, launch: 4, channel: 5, business: 6, note: 7 };
    const lead = [...hits].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))[0];

    // The bucket's movement and the event's effect are two different numbers.
    // Quoting the month's move next to an event implies the event caused all of
    // it, which is how a launch ends up captioned with a decline. The event
    // carries its own measured window instead: revenue in the seven days from
    // it against the seven before, on the channels it actually touched.
    let impact = null;
    if (lead) {
      const measured = eventImpact(lead).filter(x => x.changePct != null);
      if (measured.length) {
        const strongest = measured[0];
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
      // An unexplained move is worth flagging as such — that is the gap the CEO
      // should be filling with a note.
      explained: !!lead,
    });
  });
  return out;
}

/* ── What changed, why, and what it cost ───────────────────────────────── */

const signed = (n, unit = '%') =>
  `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}${unit}`;

/**
 * The Overview's interpretation layer.
 *
 * Each reading states the movement, names the largest contributor with its own
 * share, and quantifies the effect in rupees. A contributor is only named when
 * it genuinely leads — where the change is spread evenly, saying so is more
 * useful than picking an arbitrary winner.
 */
export function readings({ scope, prevScope, fmt }) {
  const { inr } = fmt;
  const cur = totals(scope);
  const prev = totals(prevScope);
  const out = [];
  if (!prev.grossSales) return out;

  const contributions = (dim) => {
    const c = groupBy(scope, dim);
    const p = new Map(groupBy(prevScope, dim).map(r => [r.key, r]));
    const nameOf = (k) => (dim === 'channel' ? CHANNEL_BY_ID[k]?.name ?? k : PRODUCT_BY_ID[k]?.name ?? k);
    return c.map(r => {
      const before = p.get(r.key);
      return {
        key: r.key,
        name: nameOf(r.key),
        delta: r.grossSales - (before?.grossSales ?? 0),
        deltaReturns: r.returnsValue - (before?.returnsValue ?? 0),
        pct: before?.grossSales ? ((r.grossSales - before.grossSales) / before.grossSales) * 100 : null,
      };
    });
  };

  /* 1. GMV. */
  const gmvMove = ((cur.grossSales - prev.grossSales) / prev.grossSales) * 100;
  const chans = contributions('channel').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const prods = contributions('product').sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const gmvDelta = cur.grossSales - prev.grossSales;
  const lead = chans[0];
  const leadShare = gmvDelta !== 0 && lead ? (lead.delta / gmvDelta) * 100 : null;
  // A channel that is 40% of the business moving 40% of the change has not
  // "driven" anything — it is simply large. Only name a contributor when its
  // share of the movement clearly exceeds its share of the base.
  const curByChannel = groupBy(scope, 'channel');
  const baseTotal = curByChannel.reduce((s, c) => s + c.grossSales, 0) || 1;
  const leadWeight = lead
    ? ((curByChannel.find(c => c.key === lead.key)?.grossSales ?? 0) / baseTotal) * 100
    : 0;
  const leadDrove = leadShare != null && leadShare - leadWeight > 12;

  out.push({
    id: 'gmv',
    tone: gmvMove >= 0 ? 'good' : 'critical',
    what: `GMV ${gmvMove >= 0 ? 'increased' : 'declined'} ${Math.abs(gmvMove).toFixed(1)}%`,
    why: leadDrove
      ? `${lead.name} drove it — ${Math.abs(leadShare).toFixed(0)}% of the change on ${leadWeight.toFixed(0)}% of the base`
      : 'growth is broad-based, with every channel moving roughly in line with its size',
    impact: prods[0] ? `${prods[0].name} ${prods[0].delta >= 0 ? 'added' : 'lost'} ${inr(Math.abs(prods[0].delta))}` : null,
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
        impact: `Value ${retMove >= 0 ? 'lost' : 'recovered'} ${inr(Math.abs(retDelta))}`,
      });
    }
  }

  /* 3. Margin. */
  const curM = salesModel(scope);
  const prevM = salesModel(prevScope);
  const marginMove = curM.cm1Pct - prevM.cm1Pct;
  if (Math.abs(marginMove) >= 0.5) {
    // Which line moved most against net sales decides the explanation.
    const drivers = [
      { label: 'marketplace charges', now: curM.channelFeesPct, was: prevM.channelFeesPct },
      { label: 'returns', now: curM.returnPct, was: prevM.returnPct },
      { label: 'discounting', now: curM.discountPct, was: prevM.discountPct },
      { label: 'cost of goods', now: curM.cogsPct, was: prevM.cogsPct },
      { label: 'logistics', now: curM.logisticsPct, was: prevM.logisticsPct },
    ].map(d => ({ ...d, move: d.now - d.was }))
      .sort((a, b) => Math.abs(b.move) - Math.abs(a.move));

    out.push({
      id: 'margin',
      tone: marginMove >= 0 ? 'good' : 'serious',
      what: `Contribution margin ${marginMove >= 0 ? 'improved' : 'declined'} ${Math.abs(marginMove).toFixed(1)} percentage points`,
      why: `${drivers[0].label} moved ${signed(drivers[0].move, 'pp')}`,
      impact: `Now ${curM.cm1Pct.toFixed(1)}% of net sales`,
    });
  }

  return out;
}

/* ── Freshness ─────────────────────────────────────────────────────────── */

/**
 * When the connected platforms last delivered data. The Overview states the
 * freshest sync, because that is the honest answer to "how current is this" —
 * a stale bank upload is reported separately on the Data Sources page.
 */
export function lastUpdated(sources) {
  const live = (sources ?? []).filter(s => s.status === 'connected' && s.lastSync);
  if (!live.length) return null;
  const newest = live.reduce((a, s) => (s.lastSync > a.lastSync ? s : a));
  return { at: newest.lastSync, source: newest.name, count: live.length };
}

/** Platforms the CEO can switch between, from what this company actually sells on. */
export function platformOptions(companyChannels) {
  return [
    { id: 'all', name: 'All Platforms' },
    ...companyChannels.map(id => ({ id, name: CHANNEL_BY_ID[id]?.name ?? id })),
  ];
}

export { TODAY, query };
