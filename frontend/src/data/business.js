// Goals, events, notes, data sources and the report catalogue.
//
// Nothing here is seeded. Goals, events and notes are what you enter; sources
// are what you connect. Where a page used to show a modelled settlement or a
// departmental score, it now shows that the source is not connected.

import { totals, groupBy, TODAY, forecastFor } from './engine.js';
import { CHANNEL_BY_ID, PRODUCT_BY_ID, channelsFor } from './catalog.js';
import { live } from './live.js';

// ── Goals ─────────────────────────────────────────────────────────────────

export const GOAL_STATUS = {
  achieved:    { id: 'achieved',    label: 'Achieved',      tone: 'good' },
  ontrack:     { id: 'ontrack',     label: 'On Track',      tone: 'good' },
  atrisk:      { id: 'atrisk',      label: 'At Risk',       tone: 'warning' },
  behind:      { id: 'behind',      label: 'Behind',        tone: 'critical' },
  unavailable: { id: 'unavailable', label: 'Not connected', tone: 'neutral' },
};

export const DEPARTMENTS = ['Sales', 'Marketing', 'Operations', 'Finance', 'Supply Chain'];

/**
 * What a goal can be measured against. `available` is false where the figure
 * needs a source that is not connected; such a goal can be written down, but it
 * reports "not connected" instead of a progress bar built on a guess.
 */
export const GOAL_METRICS = {
  net:         { id: 'net',         label: 'Net sales',           kind: 'currency', available: true },
  orders:      { id: 'orders',      label: 'Orders',              kind: 'number',   available: true },
  aov:         { id: 'aov',         label: 'Average order value', kind: 'currency', available: true },
  returnPct:   { id: 'returnPct',   label: 'Return rate',         kind: 'percent',  available: true, lower: true },
  ebitdaPct:   { id: 'ebitdaPct',   label: 'EBITDA margin',       kind: 'percent',  available: false },
  receivables: { id: 'receivables', label: 'Receivables',         kind: 'currency', available: false, lower: true },
};

/** A goal's live current value from the fact table, or null if unmeasurable. */
export function goalCurrent(goal, scope) {
  const t = totals({ ...scope, company: goal.company });
  const netSales = t.grossSales - t.cancelValue - t.returnsValue - t.discount;
  switch (goal.metric) {
    case 'net':       return netSales;
    case 'orders':    return t.orders;
    case 'aov':       return t.orders ? netSales / t.orders : 0;
    case 'returnPct': return t.grossSales ? (t.returnsValue / t.grossSales) * 100 : 0;
    default:          return null;
  }
}

export function resolveGoal(goal, scope, period) {
  const current = goalCurrent(goal, scope);
  const target = goal.targetValue == null || goal.targetValue === '' ? null : Number(goal.targetValue);
  const isPct = GOAL_METRICS[goal.metric]?.kind === 'percent';

  if (current == null || target == null) {
    return {
      ...goal, current, target, progress: 0, forecast: null, forecastProgress: null,
      status: GOAL_STATUS.unavailable, isPct,
    };
  }

  const lower = !!goal.lowerIsBetter;
  const progress = lower
    ? Math.max(0, Math.min(150, (target / Math.max(current, 0.0001)) * 100))
    : Math.max(0, Math.min(150, (current / Math.max(target, 0.0001)) * 100));

  // Only additive measures can be projected forward; a rate cannot.
  const additive = goal.metric === 'net' || goal.metric === 'orders';
  const forecast = additive && period ? forecastFor(period, current) : current;
  const forecastProgress = lower
    ? (target / Math.max(forecast, 0.0001)) * 100
    : (forecast / Math.max(target, 0.0001)) * 100;

  let status;
  if (progress >= 100) status = GOAL_STATUS.achieved;
  else if (forecastProgress >= 98) status = GOAL_STATUS.ontrack;
  else if (forecastProgress >= 85) status = GOAL_STATUS.atrisk;
  else status = GOAL_STATUS.behind;

  return { ...goal, current, target, progress, forecast, forecastProgress, status, isPct };
}

// ── Business timeline & CEO notes ─────────────────────────────────────────

export const EVENT_KINDS = {
  launch:    { id: 'launch',    label: 'Product Launch',  tone: 'good' },
  price:     { id: 'price',     label: 'Price Change',    tone: 'warning' },
  campaign:  { id: 'campaign',  label: 'Campaign',        tone: 'info' },
  promotion: { id: 'promotion', label: 'Promotion',       tone: 'info' },
  channel:   { id: 'channel',   label: 'New Marketplace', tone: 'good' },
  ops:       { id: 'ops',       label: 'Operational',     tone: 'serious' },
  business:  { id: 'business',  label: 'Business Event',  tone: 'info' },
  note:      { id: 'note',      label: 'CEO Note',        tone: 'neutral' },
};

/** Where an event was captured from — only systems Ardent actually reads. */
export const EVENT_SOURCES = {
  shopify: { label: 'Shopify',           capture: 'API' },
  manual:  { label: 'Entered in Ardent', capture: 'Manual' },
};

/** Channels an event applies to. `'all'` expands to the brand's channels. */
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

/**
 * Filter timeline rows to a brand and period. Rows are passed in, so events and
 * notes entered at runtime show up here and stay consistent with the markers on
 * the revenue chart.
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

// ── Data sources ──────────────────────────────────────────────────────────

export const SOURCE_STATUS = {
  connected:    { label: 'Connected',       tone: 'good' },
  syncing:      { label: 'Syncing',         tone: 'info' },
  error:        { label: 'Needs Attention', tone: 'critical' },
  disconnected: { label: 'Disconnected',    tone: 'neutral' },
};

/** Sources Ardent can read once connected, with what each one unlocks. */
export const PLANNED_SOURCES = [
  { id: 'amazon',     name: 'Amazon Seller Central', kind: 'Marketplace', unlocks: 'Amazon orders, fees and settlements' },
  { id: 'flipkart',   name: 'Flipkart Seller Hub',   kind: 'Marketplace', unlocks: 'Flipkart orders, fees and settlements' },
  { id: 'myntra',     name: 'Myntra Partner Portal', kind: 'Marketplace', unlocks: 'Myntra orders and payouts' },
  { id: 'meta_ads',   name: 'Meta Ads',              kind: 'Advertising', unlocks: 'Ad spend, ROAS and attributed revenue' },
  { id: 'google_ads', name: 'Google Ads',            kind: 'Advertising', unlocks: 'Search and Performance Max spend' },
  { id: 'bank',       name: 'Bank statements',       kind: 'Finance',     unlocks: 'Cash position, runway and reconciliation' },
  { id: 'accounting', name: 'Tally / accounting',    kind: 'Finance',     unlocks: 'Expenses, receivables, payables and GST' },
];

/** The sources actually connected to this brand, as the backend reports them. */
export function dataSources() {
  return live.meta.connections.map(c => ({
    id: c.id,
    platform: c.platform,
    name: c.platform === 'shopify'
      ? `Shopify · ${c.display_name || c.external_account_id}`
      : (c.display_name || c.platform),
    kind: 'API',
    status: SOURCE_STATUS[c.status] ? c.status : 'disconnected',
    lastSync: c.last_synced_at ? new Date(c.last_synced_at) : null,
    records: c.platform === 'shopify' ? live.meta.orderCount : null,
    message: c.last_error || null,
    connection: c,
  }));
}

/** Planned sources not yet connected to this brand. */
export function unconnectedSources() {
  const connected = new Set(live.meta.connections.map(c => c.platform));
  return PLANNED_SOURCES.filter(s => !connected.has(s.id));
}

// ── Reports ───────────────────────────────────────────────────────────────

/** Only reports that real synced data can actually fill. */
export const REPORT_CATALOG = [
  { id: 'r1',  name: 'Revenue by Channel',        group: 'Sales',   origin: 'ardent', formats: ['CSV'] },
  { id: 'r2',  name: 'Product & SKU Performance', group: 'Sales',   origin: 'ardent', formats: ['CSV'] },
  { id: 'r15', name: 'Daily Sales Extract',       group: 'Sales',   origin: 'ardent', formats: ['CSV'] },
  { id: 'r3',  name: 'Gross-to-Net Bridge',       group: 'Finance', origin: 'ardent', formats: ['CSV'] },
  { id: 'r8',  name: 'Goal & Target Tracker',     group: 'Goals',   origin: 'ardent', formats: ['CSV'] },
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
      return { key: c.key, name: PRODUCT_BY_ID[c.key]?.name ?? c.key, change: ((c.net - p.net) / p.net) * 100, delta: c.net - p.net };
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
