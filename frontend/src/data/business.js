// Goals, departments, timeline, notes, reconciliation, data sources, reports.
// Anything numeric here is derived from the fact table so it reconciles with
// the rest of the app.

import { totals, groupBy, financials, TODAY, forecastFor } from './engine.js';
import { CHANNELS, CHANNEL_BY_ID, PRODUCTS, COMPANY_BY_ID, channelsFor } from './catalog.js';
import { rngFor } from '../lib/prng.js';
import { iso } from '../lib/format.js';

// ── Goals ─────────────────────────────────────────────────────────────────

export const GOAL_STATUS = {
  achieved:  { id: 'achieved',  label: 'Achieved',  tone: 'good' },
  ontrack:   { id: 'ontrack',   label: 'On Track',  tone: 'good' },
  atrisk:    { id: 'atrisk',    label: 'At Risk',   tone: 'warning' },
  behind:    { id: 'behind',    label: 'Behind',    tone: 'critical' },
};

export const DEPARTMENTS = ['Sales', 'Marketing', 'Operations', 'Finance', 'Supply Chain'];
export const OWNERS = [
  'Rhea Mehta', 'Arjun Nair', 'Kavya Iyer', 'Siddharth Rao',
  'Neha Kulkarni', 'Imran Qureshi', 'Tanvi Desai',
];

/** Seed goals. `metric` links a goal to a live figure so progress is real. */
export const SEED_GOALS = [
  { id: 'g1', company: 'kosha', name: 'September Revenue',        metric: 'net',        targetIndex: 1.09, deadline: '2026-09-30', owner: 'Rhea Mehta',     department: 'Sales',       priority: 'high',   notes: 'Festive stock landed late; Amazon push planned for week 4.' },
  { id: 'g2', company: 'kosha', name: 'EBITDA Margin ≥ 20%',      metric: 'ebitdaPct',  targetValue: 20,   deadline: '2026-12-31', owner: 'Siddharth Rao',  department: 'Finance',     priority: 'high',   notes: 'Needs freight renegotiation to land.' },
  { id: 'g3', company: 'kosha', name: 'Direct Channel Share 35%', metric: 'directShare',targetValue: 35,   deadline: '2026-12-31', owner: 'Arjun Nair',     department: 'Marketing',   priority: 'medium', notes: 'Reduce marketplace dependency.' },
  { id: 'g4', company: 'kosha', name: 'Cut Return Rate to 8%',    metric: 'returnPct',  targetValue: 8, lowerIsBetter: true, deadline: '2026-11-30', owner: 'Kavya Iyer', department: 'Operations', priority: 'high', notes: 'Sizing guide + packaging fix in flight.' },
  { id: 'g5', company: 'kosha', name: 'Receivables Under ₹25 L',  metric: 'receivables',targetValue: 2_500_000, lowerIsBetter: true, deadline: '2026-10-31', owner: 'Siddharth Rao', department: 'Finance', priority: 'medium', notes: 'Myntra settlement cycle is the main drag.' },
  { id: 'g6', company: 'verve', name: 'Q3 Revenue',               metric: 'net',        targetIndex: 1.14, deadline: '2026-09-30', owner: 'Neha Kulkarni',  department: 'Sales',       priority: 'high',   notes: '' },
  { id: 'g7', company: 'nutreats', name: 'Launch Plant Protein to ₹8 L/mo', metric: 'net', targetIndex: 1.21, deadline: '2026-10-31', owner: 'Imran Qureshi', department: 'Sales', priority: 'medium', notes: 'Launched 26 Aug, ramping.' },
  { id: 'g8', company: 'aurelia', name: 'Nykaa Share to 45%',     metric: 'net',        targetIndex: 1.05, deadline: '2026-12-31', owner: 'Tanvi Desai',    department: 'Marketing',   priority: 'low',    notes: '' },
];

/** Resolve a goal's live current value from the fact table. */
export function goalCurrent(goal, scope) {
  const s = { ...scope, company: goal.company };
  const fin = financials(s);
  switch (goal.metric) {
    case 'net':         return fin.net;
    case 'ebitdaPct':   return fin.ebitdaPct;
    case 'receivables': return fin.receivables;
    case 'returnPct':   return fin.gross ? (fin.returnsValue / fin.gross) * 100 : 0;
    case 'directShare': {
      const byCh = groupBy(s, 'channel');
      const total = byCh.reduce((a, r) => a + r.net, 0) || 1;
      return ((byCh.find(r => r.key === 'direct')?.net ?? 0) / total) * 100;
    }
    default: return fin.net;
  }
}

export function resolveGoal(goal, scope, period) {
  const current = goalCurrent(goal, scope);
  // An explicit target is absolute; an indexed target scales off the live run-rate.
  const resolvedTarget = goal.targetValue ?? current * (goal.targetIndex ?? 1.1);

  const lower = !!goal.lowerIsBetter;
  const progress = lower
    ? Math.max(0, Math.min(150, (resolvedTarget / Math.max(current, 0.0001)) * 100))
    : Math.max(0, Math.min(150, (current / Math.max(resolvedTarget, 0.0001)) * 100));

  const forecast = goal.metric === 'net' && period ? forecastFor(period, current) : current;
  const forecastProgress = lower
    ? (resolvedTarget / Math.max(forecast, 0.0001)) * 100
    : (forecast / Math.max(resolvedTarget, 0.0001)) * 100;

  let status;
  if (progress >= 100) status = GOAL_STATUS.achieved;
  else if (forecastProgress >= 98) status = GOAL_STATUS.ontrack;
  else if (forecastProgress >= 85) status = GOAL_STATUS.atrisk;
  else status = GOAL_STATUS.behind;

  const isPct = goal.metric === 'ebitdaPct' || goal.metric === 'returnPct' || goal.metric === 'directShare';
  return { ...goal, current, target: resolvedTarget, progress, forecast, forecastProgress, status, isPct };
}

// ── Department performance ────────────────────────────────────────────────

const DEPT_BASIS = {
  Sales:         { weight: 0.94, basis: 'Revenue vs departmental target' },
  Marketing:     { weight: 0.88, basis: 'Blended ROAS vs 3.2× plan' },
  Operations:    { weight: 0.74, basis: 'On-time dispatch & return rate' },
  Finance:       { weight: 0.69, basis: 'Collections vs receivable ageing plan' },
  'Supply Chain':{ weight: 0.81, basis: 'Fill rate & stock availability' },
};

export function departmentPerformance(scope) {
  const fin = financials(scope);
  const rnd = rngFor(`dept|${scope.company}|${scope.start?.getTime()}`);
  return DEPARTMENTS.map(name => {
    const { weight, basis } = DEPT_BASIS[name];
    const attainment = Math.round(weight * 100 + (rnd() * 8 - 4));
    const tone = attainment >= 85 ? 'good' : attainment >= 72 ? 'warning' : 'critical';
    return {
      name, attainment, basis, tone,
      target: fin.net * (weight + 0.06),
      actual: fin.net * weight,
      trend: Math.round((rnd() * 18 - 6) * 10) / 10,
      headcount: Math.round(4 + rnd() * 22),
    };
  });
}

// ── Business timeline & CEO notes ─────────────────────────────────────────

export const EVENT_KINDS = {
  launch:    { id: 'launch',    label: 'Product Launch',   tone: 'good' },
  price:     { id: 'price',     label: 'Price Change',     tone: 'warning' },
  campaign:  { id: 'campaign',  label: 'Campaign',         tone: 'info' },
  promotion: { id: 'promotion', label: 'Promotion',        tone: 'info' },
  channel:   { id: 'channel',   label: 'New Marketplace',  tone: 'good' },
  ops:       { id: 'ops',       label: 'Operational',      tone: 'serious' },
  business:  { id: 'business',  label: 'Business Event',   tone: 'info' },
  note:      { id: 'note',      label: 'CEO Note',         tone: 'neutral' },
};

/**
 * Where an event was captured from. Same vocabulary as `dataSources` — an
 * event is only ever attributed to a system Ardent actually reads.
 */
export const EVENT_SOURCES = {
  amazon:   { label: 'Amazon Seller Central', capture: 'API' },
  flipkart: { label: 'Flipkart Seller Hub',   capture: 'API' },
  myntra:   { label: 'Myntra Partner Portal', capture: 'API' },
  nykaa:    { label: 'Nykaa Seller Panel',    capture: 'API' },
  ajio:     { label: 'AJIO Seller Portal',    capture: 'API' },
  direct:   { label: 'Direct Storefront',     capture: 'API' },
  ithink:   { label: 'iThink Logistics',      capture: 'API' },
  ads:      { label: 'Meta & Google Ads',     capture: 'API' },
  manual:   { label: 'Entered in Ardent',     capture: 'Manual' },
};

/** Channels an event applies to. `'all'` expands to the company's channels. */
export function eventChannels(event) {
  if (event.channels === 'all') return channelsFor(event.company);
  return event.channels ?? [];
}

/**
 * Measured revenue movement per affected channel around an event: average
 * daily net revenue in the 7 days from the event date, against the 7 days
 * before it.
 *
 * This is an observed movement, not an attributed cause — the window is stated
 * in the UI so the CEO can judge it. Anything without a full baseline returns
 * a null change rather than a fabricated one.
 */
export function eventImpact(event, windowDays = 7) {
  const day = new Date(event.date + 'T00:00:00');

  const beforeStart = new Date(day); beforeStart.setDate(day.getDate() - windowDays);
  const beforeEnd   = new Date(day); beforeEnd.setDate(day.getDate() - 1); beforeEnd.setHours(23, 59, 59, 999);

  const afterStart = new Date(day);
  const afterEnd   = new Date(day); afterEnd.setDate(day.getDate() + windowDays - 1); afterEnd.setHours(23, 59, 59, 999);
  const cappedEnd  = afterEnd > TODAY ? new Date(TODAY) : afterEnd;

  // Count calendar days, not elapsed milliseconds: `cappedEnd` sits at 23:59:59,
  // so differencing it directly rounds up to an extra day and understates the
  // average by 1/n. Floor to midnight first.
  const capDay = new Date(cappedEnd); capDay.setHours(0, 0, 0, 0);
  const afterDays = Math.max(0, Math.round((capDay - afterStart) / 86400000) + 1);

  return eventChannels(event).map(channel => {
    const before = totals({ start: beforeStart, end: beforeEnd, company: event.company, channel });
    const after  = afterDays > 0
      ? totals({ start: afterStart, end: cappedEnd, company: event.company, channel })
      : null;

    const beforeAvg = before.net / windowDays;
    const afterAvg  = after && afterDays > 0 ? after.net / afterDays : null;
    const changePct = beforeAvg > 0 && afterAvg != null
      ? ((afterAvg - beforeAvg) / beforeAvg) * 100
      : null;

    return { channel, beforeAvg, afterAvg, changePct, afterDays, windowDays, partial: afterDays < windowDays };
  }).sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
}

export const SEED_EVENTS = [
  { id: 'e1', company: 'kosha', date: '2026-08-14', kind: 'launch',   title: 'Brass Diya Gift Set launched', detail: 'Festive SKU launched ahead of Diwali.', product: 'ko-dec-02', channels: ['amazon', 'direct'], source: 'amazon' },
  { id: 'e2', company: 'kosha', date: '2026-09-12', kind: 'price',    title: 'Price increase — Riverstone Pillow Pair', detail: 'Competitor dropped price; we held margin and raised MRP instead.', product: 'ko-bed-03', oldPrice: 899, newPrice: 1099, channels: ['amazon', 'flipkart'], source: 'amazon' },
  { id: 'e3', company: 'kosha', date: '2026-09-05', kind: 'campaign', title: 'Festive Prospecting campaign live', detail: 'Meta + Google prospecting, ₹18 L planned spend through October.', channels: 'all', source: 'ads' },
  { id: 'e4', company: 'kosha', date: '2026-09-18', kind: 'ops',      title: 'Bhiwandi warehouse dispatch delay', detail: 'Two-day dispatch backlog after a labour shortage. Cleared 20 Sep.', channels: 'all', source: 'ithink' },
  { id: 'e5', company: 'kosha', date: '2026-08-28', kind: 'channel',  title: 'Myntra listing went live', detail: 'Home & Living category opened up on Myntra.', channels: ['myntra'], source: 'myntra' },
  { id: 'e6', company: 'kosha', date: '2026-09-24', kind: 'promotion',title: 'Amazon lightning deal — Bedding', detail: '48-hour deal on the Malabar range.', channels: ['amazon'], source: 'amazon' },
  { id: 'e7', company: 'verve', date: '2026-09-08', kind: 'launch',   title: 'Autumn drop live on Myntra', detail: '14 new styles across menswear.', channels: ['myntra'], source: 'myntra' },
  { id: 'e8', company: 'nutreats', date: '2026-08-26', kind: 'launch', title: 'Plant Protein Blend launched', detail: 'Direct-first launch, Amazon listing followed on 2 Sep.', product: 'nu-sup-03', channels: ['direct', 'amazon'], source: 'direct' },
  { id: 'e9', company: 'aurelia', date: '2026-09-15', kind: 'business', title: 'Nykaa Luxe onboarding complete', detail: 'Moved into the Luxe storefront — higher take rate, better placement.', channels: ['nykaa'], source: 'nykaa' },
];

export const SEED_NOTES = [
  { id: 'n1', company: 'kosha', date: '2026-09-12', kind: 'note', title: 'Why Amazon pricing moved', detail: 'Competitor dropped price on the pillow range. We chose to hold margin rather than match — watch conversion for two weeks.', author: 'Vismay Shah', linkedMetric: 'Revenue', channels: ['amazon'], source: 'manual' },
  { id: 'n2', company: 'kosha', date: '2026-09-19', kind: 'note', title: 'Warehouse delay impact', detail: 'The Bhiwandi backlog cost roughly two days of Amazon dispatch. Expect a dip in the 18–20 Sep window; not a demand problem.', author: 'Vismay Shah', linkedMetric: 'Orders', channels: ['amazon'], source: 'manual' },
  { id: 'n3', company: 'kosha', date: '2026-09-26', kind: 'note', title: 'Festive stock position', detail: 'Comforter stock is thin going into October. Reorder placed, ETA 8 Oct.', author: 'Vismay Shah', linkedMetric: 'Inventory', channels: 'all', source: 'manual' },
];

/**
 * Filter timeline rows to a company and period. Rows are passed in rather than
 * read from the seed constants, so events and notes the CEO adds at runtime
 * show up here and stay consistent with the markers on the revenue chart.
 */
export function timelineFor(rows, companyId, period) {
  return (rows ?? [])
    .filter(e => companyId === 'all' || e.company === companyId)
    .filter(e => {
      if (!period) return true;
      const ts = new Date(e.date + 'T12:00:00').getTime();
      return ts >= period.start.getTime() && ts <= period.end.getTime();
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ── Reconciliation ────────────────────────────────────────────────────────

/**
 * Marketplace money flow: what we sold, what the marketplace owes after its
 * deductions, and what actually landed in the bank.
 */
export function reconciliation(scope) {
  const marketplaces = CHANNELS.filter(c => c.kind === 'marketplace').map(c => c.id);
  const rows = groupBy(scope, 'channel').filter(r => marketplaces.includes(r.key));
  const rnd = rngFor(`recon|${scope.company}|${scope.start?.getTime()}`);

  const detail = rows.map(r => {
    const expected = r.gross - r.discount - r.fees - r.returnsValue;
    // Settlement cycles lag; a slice is always still in flight or disputed.
    const settledRate = 0.86 + rnd() * 0.11;
    const received = expected * settledRate;
    const outstanding = expected - received;
    const disputed = outstanding * (0.18 + rnd() * 0.22);
    return {
      channel: r.key,
      channelName: CHANNEL_BY_ID[r.key]?.name ?? r.key,
      sales: r.gross,
      fees: r.fees,
      returns: r.returnsValue,
      expected,
      received,
      outstanding,
      disputed,
      inTransit: outstanding - disputed,
      matchRate: settledRate * 100,
      status: outstanding / expected > 0.12 ? 'exception' : outstanding / expected > 0.05 ? 'partial' : 'matched',
    };
  });

  const sum = k => detail.reduce((s, r) => s + r[k], 0);
  return {
    detail,
    sales: sum('sales'),
    expected: sum('expected'),
    received: sum('received'),
    outstanding: sum('outstanding'),
    disputed: sum('disputed'),
    inTransit: sum('inTransit'),
  };
}

/**
 * Contracted charge schedule per marketplace, as a share of net sale value
 * (gross less discount). This is what the rate card says you should be charged.
 *
 * What the marketplace actually deducted comes from the settlement data, so the
 * two can be compared line by line. Where the contracted total sits below the
 * deducted total, the difference is recoverable — the usual cause of silent
 * margin leakage on Indian marketplaces.
 */
export const CHARGE_SCHEDULE = {
  // Contracted totals sit just below the rate actually deducted, which is where
  // real marketplace leakage shows up. Amazon and Myntra are running hot here;
  // Flipkart and Nykaa are settling close to their rate cards.
  amazon: [
    { id: 'commission', label: 'Referral commission', rate: 0.0995, basis: 'Category referral rate' },
    { id: 'fulfilment', label: 'Fulfilment fee',      rate: 0.0310, basis: 'Per-unit pick, pack & handling' },
    { id: 'shipping',   label: 'Weight handling',     rate: 0.0200, basis: 'Slab by weight and zone' },
    { id: 'closing',    label: 'Closing fee',         rate: 0.0075, basis: 'Fixed fee per unit sold' },
    { id: 'storage',    label: 'Storage fee',         rate: 0.0038, basis: 'Cubic-foot months' },
    { id: 'collection', label: 'Payment collection',  rate: 0.0045, basis: 'COD / prepaid handling' },
    { id: 'returns',    label: 'Return processing',   rate: 0.0027, basis: 'Reverse logistics' },
    { id: 'tcs',        label: 'TCS (GST)',           rate: 0.0100, basis: 'Statutory 1% — not disputable', statutory: true },
  ],
  flipkart: [
    { id: 'commission', label: 'Marketplace commission', rate: 0.1160, basis: 'Category commission rate' },
    { id: 'fulfilment', label: 'Fulfilment fee',         rate: 0.0355, basis: 'Smart fulfilment handling' },
    { id: 'shipping',   label: 'Shipping fee',           rate: 0.0235, basis: 'Weight slab by zone' },
    { id: 'collection', label: 'Collection fee',         rate: 0.0088, basis: 'COD handling' },
    { id: 'fixed',      label: 'Fixed fee',              rate: 0.0067, basis: 'Per order value slab' },
    { id: 'storage',    label: 'Storage fee',            rate: 0.0018, basis: 'Warehouse occupancy' },
    { id: 'returns',    label: 'Return shipping',        rate: 0.0017, basis: 'Reverse pickup' },
    { id: 'tcs',        label: 'TCS (GST)',              rate: 0.0100, basis: 'Statutory 1% — not disputable', statutory: true },
  ],
  myntra: [
    { id: 'commission', label: 'Marketplace commission', rate: 0.1380, basis: 'Category commission rate' },
    { id: 'fulfilment', label: 'Fulfilment fee',         rate: 0.0330, basis: 'Pick, pack & handling' },
    { id: 'shipping',   label: 'Forward shipping',       rate: 0.0215, basis: 'Weight slab by zone' },
    { id: 'platform',   label: 'Platform fee',           rate: 0.0080, basis: 'Per order platform charge' },
    { id: 'storage',    label: 'Storage fee',            rate: 0.0035, basis: 'Warehouse occupancy' },
    { id: 'returns',    label: 'Return handling',        rate: 0.0030, basis: 'Reverse logistics' },
    { id: 'tcs',        label: 'TCS (GST)',              rate: 0.0100, basis: 'Statutory 1% — not disputable', statutory: true },
  ],
  ajio: [
    { id: 'commission', label: 'Marketplace commission', rate: 0.1245, basis: 'Category commission rate' },
    { id: 'fulfilment', label: 'Fulfilment fee',         rate: 0.0330, basis: 'Pick, pack & handling' },
    { id: 'shipping',   label: 'Forward shipping',       rate: 0.0215, basis: 'Weight slab by zone' },
    { id: 'platform',   label: 'Platform fee',           rate: 0.0085, basis: 'Per order platform charge' },
    { id: 'storage',    label: 'Storage fee',            rate: 0.0040, basis: 'Warehouse occupancy' },
    { id: 'returns',    label: 'Return handling',        rate: 0.0055, basis: 'Reverse logistics' },
    { id: 'tcs',        label: 'TCS (GST)',              rate: 0.0100, basis: 'Statutory 1% — not disputable', statutory: true },
  ],
  nykaa: [
    { id: 'commission', label: 'Marketplace commission', rate: 0.1340, basis: 'Category commission rate' },
    { id: 'fulfilment', label: 'Fulfilment fee',         rate: 0.0325, basis: 'Pick, pack & handling' },
    { id: 'shipping',   label: 'Forward shipping',       rate: 0.0210, basis: 'Weight slab by zone' },
    { id: 'platform',   label: 'Platform fee',           rate: 0.0085, basis: 'Per order platform charge' },
    { id: 'storage',    label: 'Storage fee',            rate: 0.0040, basis: 'Warehouse occupancy' },
    { id: 'returns',    label: 'Return handling',        rate: 0.0040, basis: 'Reverse logistics' },
    { id: 'tcs',        label: 'TCS (GST)',              rate: 0.0100, basis: 'Statutory 1% — not disputable', statutory: true },
  ],
};

/** A line is only flagged once it clears both a relative and an absolute floor. */
export const CHARGE_TOLERANCE = { pct: 1.5, abs: 2_000 };

export const CHARGE_STATES = {
  matched:      { label: 'As contracted', tone: 'good' },
  overcharged:  { label: 'Overcharged',   tone: 'critical' },
  undercharged: { label: 'Under-charged', tone: 'info' },
  statutory:    { label: 'Statutory',     tone: 'neutral' },
};

/**
 * Line-by-line charge reconciliation. Expected comes from the contracted rate
 * card; actual is what the settlement data shows was deducted. Actual lines are
 * normalised to the fee total already in the ledger, so this view always ties
 * back to the marketplace fees reported everywhere else in Ardent.
 */
export function chargeReconciliation(scope) {
  const marketplaces = CHANNELS.filter(c => c.kind === 'marketplace').map(c => c.id);
  const rows = groupBy(scope, 'channel').filter(r => marketplaces.includes(r.key));

  const channels = rows.map(r => {
    const schedule = CHARGE_SCHEDULE[r.key] ?? [];
    const base = r.gross - r.discount;           // the fee base used in the ledger
    const actualTotal = r.fees;                  // ground truth from settlements
    const rnd = rngFor(`charges|${r.key}|${scope.company}|${scope.start?.getTime()}`);

    // Spread the deducted total across the contracted lines, with a small
    // deterministic wobble so individual lines differ from the rate card.
    // TCS is fixed by statute, so it is deducted at exactly the contracted rate.
    // Only the remainder is spread across the disputable lines.
    const statutoryActual = schedule.reduce((s, c) => s + (c.statutory ? base * c.rate : 0), 0);
    const disputable = Math.max(0, actualTotal - statutoryActual);
    const weights = schedule.map(c => (c.statutory ? 0 : c.rate * (0.93 + rnd() * 0.2)));
    const weightSum = weights.reduce((s, w) => s + w, 0) || 1;

    const lines = schedule.map((c, i) => {
      const expected = base * c.rate;
      const actual = c.statutory ? expected : disputable * (weights[i] / weightSum);
      const variance = actual - expected;
      const variancePct = expected ? (variance / expected) * 100 : 0;

      let state;
      if (c.statutory) state = 'statutory';
      else if (Math.abs(variance) < CHARGE_TOLERANCE.abs || Math.abs(variancePct) < CHARGE_TOLERANCE.pct) state = 'matched';
      else state = variance > 0 ? 'overcharged' : 'undercharged';

      return {
        id: `${r.key}-${c.id}`,
        chargeId: c.id, label: c.label, basis: c.basis,
        channel: r.key, channelName: CHANNEL_BY_ID[r.key]?.name ?? r.key,
        contractedRate: c.rate, effectiveRate: base ? actual / base : 0,
        expected, actual, variance, variancePct, state,
        statutory: !!c.statutory,
      };
    });

    const sum = k => lines.reduce((s, l) => s + l[k], 0);
    const recoverable = lines.filter(l => l.state === 'overcharged').reduce((s, l) => s + l.variance, 0);

    return {
      channel: r.key,
      channelName: CHANNEL_BY_ID[r.key]?.name ?? r.key,
      base, lines,
      expected: sum('expected'),
      actual: sum('actual'),
      variance: sum('actual') - sum('expected'),
      recoverable,
      contractedRate: schedule.reduce((s, c) => s + c.rate, 0),
      effectiveRate: base ? actualTotal / base : 0,
      flagged: lines.filter(l => l.state === 'overcharged').length,
    };
  });

  const sum = k => channels.reduce((s, c) => s + c[k], 0);

  // Same charge type rolled up across every marketplace.
  const byCharge = new Map();
  for (const ch of channels) {
    for (const l of ch.lines) {
      if (!byCharge.has(l.chargeId)) {
        byCharge.set(l.chargeId, {
          id: l.chargeId, label: l.label, statutory: l.statutory,
          expected: 0, actual: 0, variance: 0, channels: [],
        });
      }
      const g = byCharge.get(l.chargeId);
      g.expected += l.expected; g.actual += l.actual; g.variance += l.variance;
      g.channels.push(l);
    }
  }
  const charges = [...byCharge.values()].map(g => ({
    ...g,
    variancePct: g.expected ? (g.variance / g.expected) * 100 : 0,
    state: g.statutory ? 'statutory'
      : Math.abs(g.variance) < CHARGE_TOLERANCE.abs ? 'matched'
      : g.variance > 0 ? 'overcharged' : 'undercharged',
  })).sort((a, b) => b.variance - a.variance);

  return {
    channels, charges,
    expected: sum('expected'),
    actual: sum('actual'),
    variance: sum('actual') - sum('expected'),
    recoverable: sum('recoverable'),
    flagged: sum('flagged'),
  };
}

export const RECON_STATES = {
  matched:   { label: 'Matched',           tone: 'good' },
  partial:   { label: 'Partially Matched', tone: 'warning' },
  unmatched: { label: 'Unmatched',         tone: 'critical' },
  pending:   { label: 'Pending',           tone: 'neutral' },
  exception: { label: 'Exception',         tone: 'critical' },
};

/** Line-level settlement rows for the reconciliation drill-down. */
export function settlementLines(scope, channelId, limit = 40) {
  const rnd = rngFor(`settle|${channelId}|${scope.company}`);
  const rows = [];
  const end = new Date(Math.min(TODAY.getTime(), scope.end?.getTime() ?? TODAY.getTime()));
  for (let i = 0; i < limit; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - i * 2 - Math.floor(rnd() * 2));
    if (scope.start && d < scope.start) break;
    const expected = 40_000 + rnd() * 460_000;
    const r = rnd();
    const state = r < 0.62 ? 'matched' : r < 0.8 ? 'partial' : r < 0.9 ? 'pending' : r < 0.97 ? 'unmatched' : 'exception';
    const received = state === 'matched' ? expected
      : state === 'partial' ? expected * (0.6 + rnd() * 0.3)
      : state === 'pending' ? 0
      : expected * rnd() * 0.4;
    rows.push({
      id: `STL-${channelId.slice(0, 3).toUpperCase()}-${iso(d).replace(/-/g, '')}-${i + 1}`,
      date: iso(d),
      settlementId: `${channelId.slice(0, 2).toUpperCase()}${String(90_000 + Math.floor(rnd() * 9000))}`,
      expected, received, variance: received - expected, state,
      utr: state === 'pending' ? null : `UTR${String(Math.floor(rnd() * 9e11)).padStart(12, '0')}`,
      orders: Math.round(12 + rnd() * 180),
    });
  }
  return rows;
}

// ── Data sources ──────────────────────────────────────────────────────────

export function dataSources(companyId) {
  const company = COMPANY_BY_ID[companyId];
  const chans = companyId === 'all' ? CHANNELS.map(c => c.id) : (company?.channels ?? []);
  const rnd = rngFor(`src|${companyId}`);

  const base = chans.map(id => {
    // A live marketplace connector polls on a cadence — minutes, not half a
    // day. A source that genuinely has not spoken for hours is the error case
    // below, and should read as one rather than blend into the healthy set.
    const minsAgo = 3 + Math.floor(rnd() * 85);
    const err = rnd() < 0.12;
    return {
      id, name: CHANNEL_BY_ID[id]?.name ?? id,
      kind: 'API',
      status: err ? 'error' : 'connected',
      lastSync: new Date(TODAY.getTime() - (err ? 6 * 60 + minsAgo : minsAgo) * 60000),
      records: Math.round(1200 + rnd() * 48_000),
      message: err ? 'Token expired — reauthorise to resume sync' : null,
    };
  });

  return [
    ...base,
    { id: 'bank',       name: 'HDFC Current Account', kind: 'Manual Upload', status: 'manual',    lastSync: new Date(TODAY.getTime() - 4 * 864e5), records: 1_842, message: 'Upload the latest statement to refresh reconciliation' },
    { id: 'accounting', name: 'Tally / Books',        kind: 'API',           status: 'connected', lastSync: new Date(TODAY.getTime() - 96 * 60000), records: 9_310, message: null },
    { id: 'ithink',     name: 'iThink Logistics',     kind: 'API',           status: 'connected', lastSync: new Date(TODAY.getTime() - 38 * 60000), records: 22_104, message: null },
  ];
}

export const SOURCE_STATUS = {
  connected: { label: 'Connected',     tone: 'good' },
  manual:    { label: 'Manual Upload', tone: 'warning' },
  error:     { label: 'Needs Attention', tone: 'critical' },
  syncing:   { label: 'Syncing',       tone: 'info' },
};

// ── Reports ───────────────────────────────────────────────────────────────

export const REPORT_CATALOG = [
  { id: 'r1', name: 'Revenue by Channel',        group: 'Sales',           origin: 'ardent', formats: ['CSV', 'XLSX', 'PDF'], updated: '2026-09-30' },
  { id: 'r2', name: 'Product & SKU Performance', group: 'Sales',           origin: 'ardent', formats: ['CSV', 'XLSX'],        updated: '2026-09-30' },
  { id: 'r3', name: 'Gross-to-Net Bridge',       group: 'Finance',         origin: 'ardent', formats: ['CSV', 'XLSX', 'PDF'], updated: '2026-09-30' },
  { id: 'r4', name: 'P&L Summary',               group: 'Finance',         origin: 'ardent', formats: ['XLSX', 'PDF'],        updated: '2026-09-30' },
  { id: 'r5', name: 'Receivables Ageing',        group: 'Finance',         origin: 'ardent', formats: ['CSV', 'XLSX'],        updated: '2026-09-29' },
  { id: 'r6', name: 'Settlement Reconciliation', group: 'Reconciliation',  origin: 'ardent', formats: ['CSV', 'XLSX'],        updated: '2026-09-30' },
  { id: 'r7', name: 'Unmatched Settlements',     group: 'Reconciliation',  origin: 'ardent', formats: ['CSV'],                updated: '2026-09-30' },
  { id: 'r8', name: 'Goal & Target Tracker',     group: 'Goals',           origin: 'ardent', formats: ['CSV', 'PDF'],         updated: '2026-09-30' },
  { id: 'r9',  name: 'Amazon Settlement Report',    group: 'Source Reports', origin: 'amazon',   formats: ['CSV', 'XLSX'], updated: '2026-09-29' },
  { id: 'r10', name: 'Amazon Returns Report',       group: 'Source Reports', origin: 'amazon',   formats: ['CSV'],         updated: '2026-09-30' },
  { id: 'r11', name: 'Flipkart Settlement Report',  group: 'Source Reports', origin: 'flipkart', formats: ['CSV', 'XLSX'], updated: '2026-09-28' },
  { id: 'r12', name: 'Myntra Payout Statement',     group: 'Source Reports', origin: 'myntra',   formats: ['XLSX'],        updated: '2026-09-27' },
  { id: 'r13', name: 'Nykaa Seller Statement',      group: 'Source Reports', origin: 'nykaa',    formats: ['CSV'],         updated: '2026-09-26' },
  { id: 'r14', name: 'Bank Statement (HDFC)',       group: 'Source Reports', origin: 'bank',     formats: ['CSV', 'PDF'],  updated: '2026-09-26' },
];

export const EXPORT_SCOPES = [
  'Current View', 'Sales Data', 'Financial Data', 'Reconciliation Data',
  'Product Data', 'Source Reports', 'Goals', 'Custom Export',
];

// ── Insights (derived only — never invented) ──────────────────────────────

/**
 * Plain-language read of what actually moved, computed from the data. If a
 * contributor is not measurable it simply is not mentioned.
 */
export function insights(scope, prevScope) {
  const cur = totals(scope);
  const prev = totals(prevScope);
  if (!prev.net) return [];

  const changePct = ((cur.net - prev.net) / prev.net) * 100;
  const curCh = groupBy(scope, 'channel');
  const prevCh = new Map(groupBy(prevScope, 'channel').map(r => [r.key, r]));

  const contributors = curCh
    .map(c => {
      const p = prevCh.get(c.key);
      if (!p?.net) return null;
      return { key: c.key, name: CHANNEL_BY_ID[c.key]?.name ?? c.key, change: ((c.net - p.net) / p.net) * 100, delta: c.net - p.net };
    })
    .filter(Boolean)
    .sort((a, b) => a.delta - b.delta);

  const curProd = groupBy(scope, 'product');
  const prevProd = new Map(groupBy(prevScope, 'product').map(r => [r.key, r]));
  const prodMoves = curProd
    .map(c => {
      const p = prevProd.get(c.key);
      if (!p?.net) return null;
      const product = PRODUCTS.find(x => x.id === c.key);
      return { key: c.key, name: product?.name ?? c.key, change: ((c.net - p.net) / p.net) * 100, delta: c.net - p.net };
    })
    .filter(Boolean)
    .sort((a, b) => a.delta - b.delta);

  return [{
    headline: `Revenue is ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(1)}% versus the previous period.`,
    changePct,
    contributors: contributors.slice(0, 4),
    laggards: prodMoves.filter(p => p.delta < 0).slice(0, 3),
    leaders: prodMoves.filter(p => p.delta > 0).slice(-3).reverse(),
  }];
}
