// Single source of truth for every number in the app.
//
// One fact table at (day × brand × channel × product × variant). Every figure
// the CEO sees — a KPI, a chart point, a channel total, a SKU row — is a
// filter-and-reduce over these same rows, so drill-down always reconciles with
// the number above it.
//
// The rows are real: the backend builds them from orders synced out of your
// connected stores. Nothing here generates, estimates or pads a figure. Where a
// number needs a source that is not connected — gateway and courier costs,
// operating expenses, cash — it is null, and the page says so.

import { live, subscribe } from './live.js';
import { COMPANIES, COMPANY_BY_ID, PRODUCT_BY_ID, skusForProduct } from './catalog.js';
import { TODAY } from '../lib/clock.js';
import { iso } from '../lib/format.js';

export { TODAY } from '../lib/clock.js';

export function facts() {
  return live.rows;
}

// ── Period helpers ────────────────────────────────────────────────────────

export const PERIOD_PRESETS = [
  { id: 'today',   label: 'Today' },
  { id: 'week',    label: 'This Week' },
  { id: 'month',   label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'year',    label: 'This Year' },
  { id: 'custom',  label: 'Custom Range' },
];

/**
 * Comparison bases. Budget and target used to be fixed multiples of the actual
 * figures, which made "vs target" compare the business against itself. They are
 * gone until targets come from your own goals. A forecast is straight-line
 * arithmetic on the real run-rate, so it stays, labelled as a forecast.
 */
export const COMPARISON_MODES = [
  { id: 'previous', label: 'Previous Period' },
  { id: 'year',     label: 'Previous Year' },
  { id: 'forecast', label: 'Forecast' },
];

/**
 * The window real data covers: from the first synced order to today. Refilled
 * whenever the store changes, so date controls always offer what exists.
 */
export const DATA_RANGE = { start: null, end: null, days: 0 };

/** Data introduced starting April 1st of the current year. */
function minAprilDate(year) {
  const april = new Date(year, 3, 1); // Month 3 = April (0-indexed)
  april.setHours(0, 0, 0, 0);
  return april;
}

function refreshRange() {
  const end = new Date(TODAY);
  end.setHours(23, 59, 59, 999);
  const aprilStart = minAprilDate(end.getFullYear());
  const first = live.meta.range?.first;
  let start = first ? new Date(`${first}T00:00:00`) : aprilStart;
  if (start < aprilStart) {
    start = aprilStart;
  }
  start.setHours(0, 0, 0, 0);
  DATA_RANGE.start = start;
  DATA_RANGE.end = end;
  DATA_RANGE.days = Math.max(1, Math.round((end - start) / 86400000) + 1);
}

subscribe(refreshRange);
refreshRange();

/** A period cannot run past today — there are no orders from the future. */
function capToToday(d) {
  const end = new Date(TODAY);
  end.setHours(23, 59, 59, 999);
  return d > end ? end : d;
}

/** Ensure date never goes earlier than April 1st. */
function clampToApril(d) {
  const aprilStart = minAprilDate(TODAY.getFullYear());
  return d < aprilStart ? aprilStart : d;
}

export function resolvePeriod(presetId, custom) {
  const end = new Date(TODAY);
  end.setHours(23, 59, 59, 999);
  let start = new Date(TODAY);

  switch (presetId) {
    case 'today':
      break;
    case 'week': {
      const dow = (start.getDay() + 6) % 7; // Monday-first
      start.setDate(start.getDate() - dow);
      break;
    }
    case 'month':
      start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
      break;
    case 'quarter':
      start = new Date(TODAY.getFullYear(), Math.floor(TODAY.getMonth() / 3) * 3, 1);
      break;
    case 'year':
      start = minAprilDate(TODAY.getFullYear()); // Data starts April 1st
      break;
    case 'custom':
      if (custom?.start && custom?.end) {
        const cs = clampToApril(new Date(custom.start + 'T00:00:00'));
        const ce = capToToday(new Date(custom.end + 'T23:59:59'));
        const [a, b] = cs <= ce ? [cs, ce] : [ce, cs];
        return { start: a, end: b, label: 'Custom Range', clamped: custom.end > iso(TODAY) };
      }
      start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
      break;
    default:
      start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  }
  start = clampToApril(start);
  start.setHours(0, 0, 0, 0);
  return {
    start, end,
    label: PERIOD_PRESETS.find(p => p.id === presetId)?.label ?? 'This Month',
  };
}

/** What the comparison series is actually showing — never a fixed string. */
export function comparisonLabel(mode, period = null) {
  const base = {
    previous: 'Previous Period', year: 'Previous Year', forecast: 'Forecast',
  }[mode] ?? 'Previous Period';
  if (!period || mode === 'forecast') return base;
  const win = comparisonWindow(period, mode);
  if (win?.start && win?.end) {
    return `${base} (${fmtDate(win.start)} – ${fmtDate(win.end, 'long')})`;
  }
  return base;
}

/** True when the comparison is a historical window rather than a projection. */
export function isHistoricalComparison(mode) {
  return mode === 'previous' || mode === 'year';
}

export function comparisonWindow(period, mode) {
  const days = Math.max(1, Math.round((period.end - period.start) / 86400000) + 1);
  if (mode === 'year') {
    const start = new Date(period.start); start.setFullYear(start.getFullYear() - 1);
    const end = new Date(period.end);     end.setFullYear(end.getFullYear() - 1);
    return { start, end };
  }
  const end = new Date(period.start); end.setDate(end.getDate() - 1); end.setHours(23, 59, 59, 999);
  const start = new Date(end);        start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
  return { start, end };
}

// ── Aggregation ───────────────────────────────────────────────────────────

const ZERO = () => ({
  units: 0, orders: 0, gross: 0, grossSales: 0, cancelValue: 0,
  discount: 0, discountPlatform: 0, discountBrand: 0,
  fees: 0, shipping: 0, returnsValue: 0, returnValue: 0, rtoValue: 0,
  logistics: 0, fulfilment: 0, warehousing: 0, paymentFees: 0, otherCost: 0,
  net: 0, cogs: 0, margin: 0, returnUnits: 0, costGaps: 0,
});

function accumulate(target, row) {
  target.units += row.units; target.orders += row.orders;
  target.gross += row.gross; target.grossSales += row.grossSales;
  target.cancelValue += row.cancelValue;
  target.discount += row.discount;
  target.discountPlatform += row.discountPlatform;
  target.discountBrand += row.discountBrand;
  target.fees += row.fees;   target.shipping += row.shipping;
  target.returnsValue += row.returnsValue;
  target.returnValue += row.returnValue; target.rtoValue += row.rtoValue;
  target.logistics += row.logistics;     target.fulfilment += row.fulfilment;
  target.warehousing += row.warehousing; target.paymentFees += row.paymentFees;
  target.otherCost += row.otherCost;
  target.net += row.net;     target.cogs += row.cogs; target.margin += row.margin;
  target.returnUnits += row.returnUnits || 0;
  target.costGaps += row.costGaps || 0;
  return target;
}

/**
 * Filter the fact table. `scope` narrows by brand, channel, category, product
 * or variant; every drill-down level is the same call with one more key set.
 */
export function query({ start, end, company = 'all', channel, category, subcategory, product, variant } = {}) {
  const s = start ? start.getTime() : -Infinity;
  const e = end ? end.getTime() : Infinity;
  return facts().filter(r =>
    r.ts >= s && r.ts <= e &&
    (company === 'all' || r.company === company) &&
    (!channel     || r.channel     === channel) &&
    (!category    || r.category    === category) &&
    (!subcategory || r.subcategory === subcategory) &&
    (!product     || r.product     === product) &&
    (!variant     || r.variant     === variant)
  );
}

export function totals(scope) {
  return query(scope).reduce(accumulate, ZERO());
}

/** Group rows by a key and return sorted totals, largest first. */
export function groupBy(scope, key) {
  const map = new Map();
  for (const row of query(scope)) {
    const k = row[key];
    if (!map.has(k)) map.set(k, { key: k, ...ZERO() });
    accumulate(map.get(k), row);
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

/**
 * The bucket a timestamp falls into, as an ISO date. Exported so anything that
 * needs to line up with a chart's x-axis (event markers, annotations) derives
 * the bucket the same way the series does, instead of re-implementing it.
 */
export function bucketStart(ts, granularity = 'day') {
  const d = new Date(ts);
  if (granularity === 'week') {
    const dow = (d.getDay() + 6) % 7; // Monday-first
    d.setDate(d.getDate() - dow);
  } else if (granularity === 'month') {
    d.setDate(1);
  }
  return iso(d);
}

/** Daily / weekly / monthly series for charting. */
export function series(scope, granularity = 'day') {
  const map = new Map();
  for (const row of query(scope)) {
    const bucket = granularity === 'day' ? row.date : bucketStart(row.ts, granularity);
    if (!map.has(bucket)) map.set(bucket, { date: bucket, ts: new Date(bucket + 'T00:00:00').getTime(), ...ZERO() });
    accumulate(map.get(bucket), row);
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * A product's variants, each with its own real figures.
 *
 * Variants used to be fixed-ratio splits of their product, which made every
 * size look identical. Each row here is summed from that variant's own orders.
 */
export function skuBreakdown(scope) {
  const product = PRODUCT_BY_ID[scope.product];
  if (!product) return [];
  const byVariant = new Map(groupBy(scope, 'variant').map(r => [r.key, r]));
  return skusForProduct(product)
    .map(sku => {
      const t = byVariant.get(sku.id) ?? { key: sku.id, ...ZERO() };
      return {
        ...sku,
        units: t.units,
        orders: t.orders,
        grossSales: t.grossSales,
        gross: t.gross,
        net: t.net,
        returnsValue: t.returnsValue,
        cancelValue: t.cancelValue,
        discount: t.discount,
        cogs: t.costGaps === 0 ? t.cogs : null,
      };
    })
    .filter(s => s.units > 0 || s.grossSales > 0);
}

/**
 * Order lines behind a SKU.
 *
 * These were synthesised. Real order lines need an orders endpoint on the
 * backend, which does not exist yet — so there are none to show rather than
 * invented ones.
 */
export function transactionsFor() {
  return [];
}

// ── Derived business metrics ──────────────────────────────────────────────

/**
 * The sales ladder, identical at every level of the hierarchy.
 *
 *   Gross Sales − Cancellations − Returns − Discounts = Net Sales
 *   Net Sales − Cost of Goods                         = Gross Margin
 *
 * That is as far as synced order data reaches. Channel costs, marketing and
 * operating expenses need sources that are not connected, so contribution and
 * net margin are null rather than a figure that quietly assumes them away.
 */
export function salesModel(scope) {
  const t = totals(scope);

  const netSales = t.grossSales - t.cancelValue - t.returnsValue - t.discount;
  // Cost of goods only counts when every row in scope carried a unit cost; a
  // partial figure would understate cost and overstate margin.
  const costComplete = t.costGaps === 0 && t.units > 0;
  const cogs = costComplete ? t.cogs : null;
  const grossMargin = cogs == null ? null : netSales - cogs;

  const ofGross = (v) => (t.grossSales ? (v / t.grossSales) * 100 : 0);
  const ofNet = (v) => (v == null || !netSales ? null : (v / netSales) * 100);
  const perOrder = (v) => (v == null || !t.orders ? null : v / t.orders);

  return {
    units: t.units,
    orders: t.orders,
    grossSales: t.grossSales,
    cancellations: t.cancelValue,
    returns: t.returnsValue,
    discounts: t.discount,
    netSales,

    asp: t.units ? netSales / t.units : 0,
    unitsPerOrder: t.orders ? t.units / t.orders : 0,
    revenuePerOrder: t.orders ? netSales / t.orders : 0,
    aov: t.orders ? netSales / t.orders : 0,
    discountPerOrder: t.orders ? t.discount / t.orders : 0,
    // Shopify does not say who funded a discount; on your own store it is you.
    discountPlatform: 0,
    discountBrand: t.discount,
    customerReturns: t.returnsValue,
    returnUnits: t.returnUnits,

    cancelPct: ofGross(t.cancelValue),
    returnPct: ofGross(t.returnsValue),
    customerReturnPct: ofGross(t.returnsValue),
    discountPct: ofGross(t.discount),

    cogs,
    cogsPct: ofNet(cogs),
    costComplete,
    costGaps: t.costGaps,
    grossMargin,
    grossMarginPct: ofNet(grossMargin),
    grossMarginPerOrder: perOrder(grossMargin),

    // Not reported by any connected source.
    rto: null, rtoPct: null, platformFundedPct: null,
    channelFees: null, logistics: null, warehousing: null, fulfilment: null,
    paymentFees: null, otherCost: null, variableCosts: null, channelCost: null,
    logisticsCollection: null, otherDeductions: null,
    realizedSales: null, realizedPct: null, totalDeductions: null,
    channelCostPct: null, channelCostPerOrder: null, feesPerOrder: null,
    logisticsPerOrder: null, otherCostPerOrder: null, contributionPerOrder: null,
    channelFeesPct: null, logisticsPct: null, warehousingPct: null,
    fulfilmentPct: null, paymentFeesPct: null, otherCostPct: null,
    cm1: null, cm2: null, cm1Pct: null, cm2Pct: null,
    marketing: null, salaries: null, overheads: null,
    depreciation: null, interest: null, tax: null,
    netMargin: null, netMarginPct: null,

    known: { cogs: costComplete, channelCosts: false, marketing: false, opex: false, rto: false },
  };
}

/**
 * The waterfall rows. Cost of goods appears only for a viewer allowed to see it,
 * and only when every sale in scope was costed. `missing` names what the ladder
 * cannot show yet, so the page can say so beside it.
 */
export function salesWaterfall(m, can) {
  const showCogs = m.known.cogs && (!can || can('fin.cogs'));
  const rows = [
    { id: 'gross',     label: 'Gross Sales',   value: m.grossSales,     kind: 'start' },
    { id: 'discounts', label: 'Discounts',     value: -m.discounts,     kind: 'cost' },
    { id: 'cancel',    label: 'Cancellations', value: -m.cancellations, kind: 'cost' },
    { id: 'returns',   label: 'Returns',       value: -m.returns,       kind: 'cost' },
    { id: 'netSales',  label: 'Net Sales',     value: m.netSales,       kind: 'subtotal' },
  ];
  if (showCogs) {
    rows.push(
      { id: 'cogs',        label: 'Cost of Goods Sold', value: -m.cogs,       kind: 'cost',  perm: 'fin.cogs' },
      { id: 'grossMargin', label: 'Gross Margin',       value: m.grossMargin, kind: 'total', perm: 'fin.cogs' },
    );
  }
  rows.missing = [
    !m.known.cogs && 'Cost of goods — add unit costs to your Shopify products',
    'Gateway, courier and warehousing costs',
    'Marketing, salaries and overheads',
  ].filter(Boolean);
  return rows;
}

/**
 * GMV down to net sales, as stepped waterfall rows. Marketplace fees and other
 * deductions would continue the ladder, but no marketplace is connected.
 */
export function marketplaceWaterfall(m) {
  const deductions = [
    { id: 'discounts', label: 'Discounts',     value: m.discounts },
    { id: 'cancel',    label: 'Cancellations', value: m.cancellations },
    { id: 'returns',   label: 'Returns',       value: m.returns },
  ];

  const steps = [{ id: 'gmv', label: 'GMV', kind: 'total', base: 0, value: m.grossSales, amount: m.grossSales }];
  let running = m.grossSales;
  for (const d of deductions) {
    running -= d.value;
    steps.push({ id: d.id, label: d.label, kind: 'cost', base: running, value: d.value, amount: -d.value });
  }
  steps.push({ id: 'netSales', label: 'Net Sales', kind: 'total', base: 0, value: running, amount: running });
  steps.missing = ['Marketplace fees, logistics and other deductions'];
  return steps;
}

/**
 * Finance figures. Sales and, where costed, gross margin are real. Expenses,
 * cash, receivables and payables need accounting and bank sources, so they are
 * null — a runway built on an assumed cash balance is worse than none.
 */
export function financials(scope) {
  const t = totals(scope);
  const m = salesModel(scope);
  return {
    ...t,
    netSales: m.netSales,
    cogs: m.cogs,
    margin: m.grossMargin,
    costComplete: m.costComplete,
    grossProfit: m.grossMargin,
    grossMarginPct: m.grossMarginPct,
    marketing: null, salaries: null, logistics: null, overheads: null, opex: null,
    ebitda: null, ebitdaPct: null, depreciation: null, interest: null, pbt: null, tax: null,
    netProfit: null, netMarginPct: null,
    cash: null, burnRate: null, runwayMonths: null,
    receivables: null, payables: null, overdues: null,
    available: {
      sales: t.grossSales > 0,
      cogs: m.costComplete,
      expenses: false,
      cash: false,
      receivables: false,
    },
  };
}

// ── Health cut-points ─────────────────────────────────────────────────────

export const HEALTH_CUTS = { good: 80, watch: 65, atRisk: 50 };

export function healthBand(score) {
  if (score == null) return { id: 'unknown', label: 'Not enough data', tone: 'neutral' };
  if (score >= HEALTH_CUTS.good)   return { id: 'good',     label: 'Healthy',         tone: 'good' };
  if (score >= HEALTH_CUTS.watch)  return { id: 'watch',    label: 'Stable',          tone: 'warning' };
  if (score >= HEALTH_CUTS.atRisk) return { id: 'at-risk',  label: 'Needs Attention', tone: 'serious' };
  return { id: 'critical', label: 'Critical', tone: 'critical' };
}

/** Tone for a single indicator score — same cut-points as the overall band. */
export function indicatorTone(score) {
  return healthBand(score).tone;
}

/**
 * Thresholds behind the headline status. Stated here rather than inline so the
 * classification stays auditable and is changed in one place.
 */
export const PHASE_CUTS = {
  growthFlat: 1,       // ±% treated as holding steady
  runwayLow: 6,        // months
  runwaySafe: 9,       // months
  marginHealthy: 10,   // net margin %
  marginThin: 0,
};

export function growthTone(pct) {
  if (pct == null) return 'neutral';
  if (pct > PHASE_CUTS.growthFlat) return 'good';
  if (pct < -PHASE_CUTS.growthFlat) return 'critical';
  return 'info';
}
export function runwayTone(months) {
  if (months == null) return 'neutral';
  if (months >= PHASE_CUTS.runwaySafe) return 'good';
  if (months >= PHASE_CUTS.runwayLow) return 'warning';
  return 'critical';
}
export function marginTone(pct) {
  if (pct == null) return 'neutral';
  if (pct >= PHASE_CUTS.marginHealthy) return 'good';
  if (pct > PHASE_CUTS.marginThin) return 'warning';
  return 'critical';
}

/**
 * The one-line read on where the business stands. Rules are fixed and ordered —
 * cash first, because nothing else matters if the company runs out of it.
 *
 * Without cash and margin, the read rests on growth alone and says so, rather
 * than presuming the business is profitable.
 */
export function businessPhase({ growthPct, runwayMonths, netMarginPct }) {
  if (growthPct == null) {
    return {
      id: 'unknown', label: 'Not enough history',
      blurb: 'Growth needs a previous period with sales to compare against.', tone: 'neutral',
    };
  }
  const g = growthPct;

  if (runwayMonths == null && netMarginPct == null) {
    const tail = 'Profit and cash need cost and bank data to judge.';
    if (g > PHASE_CUTS.growthFlat) return { id: 'growing', label: 'Growing', blurb: `Sales are growing. ${tail}`, tone: 'good' };
    if (g < -PHASE_CUTS.growthFlat) return { id: 'contracting', label: 'Contracting', blurb: `Sales are falling. ${tail}`, tone: 'warning' };
    return { id: 'steady', label: 'Holding steady', blurb: `Sales are flat. ${tail}`, tone: 'info' };
  }

  const r = runwayMonths ?? 0;
  const m = netMarginPct ?? 0;
  if (r > 0 && r < PHASE_CUTS.runwayLow) {
    return { id: 'cash-constrained', label: 'Cash Constrained', blurb: 'Runway is short — protect cash before pushing growth.', tone: 'critical' };
  }
  if (g < -PHASE_CUTS.growthFlat) {
    return m > PHASE_CUTS.marginThin
      ? { id: 'contracting', label: 'Contracting', blurb: 'Revenue is falling, though you are still profitable.', tone: 'warning' }
      : { id: 'declining',   label: 'Declining',   blurb: 'Revenue and margin are both under pressure.', tone: 'critical' };
  }
  if (g <= PHASE_CUTS.growthFlat) {
    return m > PHASE_CUTS.marginThin
      ? { id: 'stable', label: 'Stable', blurb: 'Revenue is holding steady and profitable.', tone: 'info' }
      : { id: 'flat-unprofitable', label: 'Flat', blurb: 'Revenue is flat and not yet covering costs.', tone: 'warning' };
  }
  if (m >= PHASE_CUTS.marginHealthy) {
    return { id: 'growing-efficiently', label: 'Growing', blurb: 'You are growing efficiently.', tone: 'good' };
  }
  if (m > PHASE_CUTS.marginThin) {
    return { id: 'growing-thin', label: 'Growing', blurb: 'Growing, but margin is thin.', tone: 'warning' };
  }
  return { id: 'growing-unprofitably', label: 'Growing', blurb: 'Growing while losing money on every sale.', tone: 'serious' };
}

/**
 * Targets and budgets come from your goals, not from the actuals. Until one is
 * set there is nothing honest to compare against, so these return null.
 */
export function targetFor() { return null; }
export function budgetFor() { return null; }

/** Straight-line forecast to period end from the real run-rate so far. */
export function forecastFor(period, actualNet) {
  const elapsed = Math.max(1, Math.round((Math.min(TODAY, period.end) - period.start) / 86400000) + 1);
  const total = Math.max(1, Math.round((period.end - period.start) / 86400000) + 1);
  return (actualNet / elapsed) * total;
}

export function companyLabel(id) {
  return id === 'all' ? 'All Brands' : COMPANY_BY_ID[id]?.name ?? id;
}

export { COMPANIES, COMPANY_BY_ID };
