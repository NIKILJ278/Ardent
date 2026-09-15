// Single source of truth for every number in the app.
//
// One fact table is generated at (day × company × channel × product). Every
// figure the CEO sees — a KPI, a chart point, a channel total, a SKU row — is a
// filter+reduce over these same rows, so drill-down always reconciles with the
// number above it. Nothing is hand-written twice.

import {
  PRODUCTS, COMPANIES, COMPANY_BY_ID, CHANNEL_FEE_RATE, CHANNEL_COD_RATE,
  skusForProduct,
} from './catalog.js';
import { rngFor } from '../lib/prng.js';
import { TODAY } from '../lib/clock.js';
import { iso } from '../lib/format.js';

/**
 * The prototype's "today" — fixed so the demo is reproducible and "This Month"
 * reads as a complete September, matching the reference figures.
 */
export { TODAY } from '../lib/clock.js';

const HISTORY_DAYS = 700; // enough for This Year + previous-year comparison
const BASE_UNITS = 52;    // calibrated so the lead brand lands near ₹1.24 Cr/month

/** Procurement efficiency applied to catalogue COGS rates. */
const COGS_ADJ = 0.86;

/**
 * Landed cost of one unit. Exported so inventory values stock on the same
 * basis the P&L charges it out at — otherwise stock value and COGS would be
 * computed from two different numbers.
 */
export function unitCost(product) {
  return product ? product.price * product.cogsRate * COGS_ADJ : 0;
}

const SHIPPING_PER_UNIT = { amazon: 68, flipkart: 74, myntra: 79, nykaa: 71, ajio: 76, direct: 92 };

/**
 * The order-cost bucket, split into the lines a CEO actually manages. Shares
 * sum to 1, so the parts always add back to the same total — the Sales
 * waterfall can therefore never disagree with the ledger.
 */
const COST_SPLIT = { logistics: 0.52, fulfilment: 0.20, warehousing: 0.13, paymentFees: 0.10, otherCost: 0.05 };

/**
 * Share of the returns bucket that is RTO (refused on delivery) rather than a
 * customer-initiated return. COD-heavy channels skew heavily to RTO.
 */
const RTO_SHARE = { amazon: 0.34, flipkart: 0.52, myntra: 0.44, nykaa: 0.29, ajio: 0.48, direct: 0.22 };

/**
 * Share of discount funded by the marketplace rather than the brand. Platform-
 * funded discount costs the brand nothing, so the split changes the economics.
 */
const PLATFORM_FUNDED = { amazon: 0.32, flipkart: 0.41, myntra: 0.28, nykaa: 0.24, ajio: 0.35, direct: 0.0 };

/** Orders cancelled before dispatch. COD-heavy channels cancel far more. */
const CANCEL_BASE = { amazon: 0.031, flipkart: 0.058, myntra: 0.049, nykaa: 0.028, ajio: 0.054, direct: 0.019 };

/** Festive / sale-event multipliers by month-day, Indian e-commerce calendar. */
function seasonalLift(date, channelId) {
  const m = date.getMonth();
  const d = date.getDate();
  let lift = 1;

  // Great Indian Festival / Big Billion Days — early-mid October
  if (m === 9 && d >= 3 && d <= 12) lift *= channelId === 'direct' ? 1.35 : 1.95;
  // Diwali run-up — late October
  if (m === 9 && d > 12) lift *= 1.42;
  if (m === 10 && d <= 8) lift *= 1.28;
  // End-of-season sale — late June / July
  if (m === 6 && d <= 14) lift *= 1.24;
  // Republic Day sales
  if (m === 0 && d >= 20 && d <= 27) lift *= 1.31;
  // Post-festive slump
  if (m === 10 && d > 18) lift *= 0.82;
  if (m === 1) lift *= 0.91;

  // Weekly rhythm: marketplaces peak midweek, own site peaks at the weekend.
  const dow = date.getDay();
  if (channelId === 'direct') lift *= [1.14, 0.92, 0.9, 0.94, 0.99, 1.08, 1.18][dow];
  else lift *= [0.95, 1.06, 1.08, 1.05, 1.02, 0.97, 0.9][dow];

  return lift;
}

/**
 * Deliberate actions the business took, and what they did to the numbers.
 *
 * These live in the fact table rather than in the page that describes them.
 * A decision recorded in the watchlist is only worth keeping if the figures
 * afterwards actually respond to it — and the response has to be visible to
 * every view at once, or Sales and Finance would tell different stories about
 * the same fix.
 *
 * Each entry ramps in over `rampDays`, because a listing change reaches buyers
 * gradually as impressions turn over. Rates are multiplied, so an intervention
 * bends the existing seasonality instead of flattening it.
 */
export const INTERVENTIONS = [
  {
    id: 'iv-sizechart',
    label: 'King size chart and reshoot',
    from: '2026-09-12', rampDays: 10,
    product: 'ko-bed-01', channel: 'amazon',
    effect: { returnRate: -0.30 },
  },
  {
    id: 'iv-dealprice',
    label: 'Festive lightning deals on Bedding',
    from: '2026-09-12', rampDays: 6,
    company: 'kosha', category: 'Bedding', channel: 'amazon',
    effect: { discountRate: 0.22 },
  },
  {
    id: 'iv-kadai',
    label: 'Cast iron kadai listing rebuild',
    from: '2026-08-14', rampDays: 14,
    product: 'ko-kit-01',
    effect: { units: 0.30 },
  },
  {
    id: 'iv-fitnote',
    label: 'XXL shirt fit note on Myntra',
    from: '2026-09-10', rampDays: 8,
    product: 've-men-02', channel: 'myntra',
    // The note did not fix a garment that is genuinely cut short.
    effect: { returnRate: 0.05 },
  },
];

/** Interventions that apply to one product on one channel. */
function interventionsFor(product, channelId) {
  return INTERVENTIONS.filter(iv =>
    (!iv.product     || iv.product     === product.id) &&
    (!iv.company     || iv.company     === product.company) &&
    (!iv.category    || iv.category    === product.category) &&
    (!iv.subcategory || iv.subcategory === product.subcategory) &&
    (!iv.channel     || iv.channel     === channelId)
  ).map(iv => ({ ...iv, fromTs: new Date(iv.from + 'T00:00:00').getTime() }));
}

/** Multiplier for one effect field on a given day, ramped in from the start. */
function interventionFactor(list, ts, field) {
  let factor = 1;
  for (const iv of list) {
    const delta = iv.effect[field];
    if (delta == null || ts < iv.fromTs) continue;
    const days = (ts - iv.fromTs) / 86400000;
    const ramp = Math.min(1, (days + 1) / Math.max(1, iv.rampDays));
    factor *= 1 + delta * ramp;
  }
  return factor;
}

let _facts = null;

function buildFacts() {
  const rows = [];
  const start = new Date(TODAY);
  start.setDate(start.getDate() - HISTORY_DAYS + 1);

  for (const product of PRODUCTS) {
    const company = COMPANY_BY_ID[product.company];
    if (!company) continue;

    // Normalise the channel mix to the channels this company actually sells on.
    const mixEntries = Object.entries(product.mix).filter(([ch]) => company.channels.includes(ch));
    const mixTotal = mixEntries.reduce((s, [, v]) => s + v, 0) || 1;

    for (const [channelId, rawShare] of mixEntries) {
      const share = rawShare / mixTotal;
      const rnd = rngFor(`${product.id}|${channelId}`);
      const feeRate = CHANNEL_FEE_RATE[channelId] ?? 0.18;
      const shipPerUnit = SHIPPING_PER_UNIT[channelId] ?? 75;
      const launchTs = product.launchedOn ? new Date(product.launchedOn).getTime() : null;
      const interventions = interventionsFor(product, channelId);

      for (let i = 0; i < HISTORY_DAYS; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        const ts = date.getTime();

        // A product contributes nothing before it launches.
        if (launchTs && ts < launchTs) continue;

        // Trend ramps across the window; noise is deterministic per day.
        const progress = i / HISTORY_DAYS;
        const trendFactor = 1 + product.trend * progress;
        const noise = 0.82 + rnd() * 0.36;
        const lift = seasonalLift(date, channelId);

        // A newly launched product ramps up over its first six weeks.
        let launchRamp = 1;
        if (launchTs) {
          const daysLive = (ts - launchTs) / 86400000;
          launchRamp = Math.min(1, 0.28 + daysLive / 42);
        }

        const unitFactor = interventions.length ? interventionFactor(interventions, ts, 'units') : 1;
        const units = Math.max(
          0,
          Math.round(BASE_UNITS * product.weight * company.scale * share * trendFactor * lift * noise * launchRamp * unitFactor)
        );
        if (units === 0) continue;

        const gross = units * product.price;

        // Discounting is heavier on marketplaces and during sale events.
        const promo = lift > 1.3 ? 0.09 : 0;
        const discountRate = ((channelId === 'direct' ? 0.05 : 0.09) + promo + rnd() * 0.03)
          * (interventions.length ? interventionFactor(interventions, ts, 'discountRate') : 1);
        const discount = gross * discountRate;

        // A course has no pick, pack or courier. Its only variable cost is the
        // payment gateway, so shipping is zero and the fee rate is the gateway's.
        const digital = !!product.digital;
        const fees = (gross - discount) * (digital ? 0.022 : feeRate);
        const shipping = digital ? 0 : units * shipPerUnit;

        // Returns + RTO — COD-heavy channels leak more.
        // Digital refunds happen, but there is no COD leakage and no damage in
        // transit, so the rate is a fraction of a physical product's.
        const codRate = digital ? 0 : (CHANNEL_COD_RATE[channelId] ?? 0.3);
        const returnRate = ((digital ? 0.014 : 0.045 + codRate * 0.14) + rnd() * (digital ? 0.006 : 0.02))
          * (interventions.length ? interventionFactor(interventions, ts, 'returnRate') : 1);
        const returnsValue = (gross - discount) * returnRate;

        // Cancelled orders are booked then reversed: they inflate gross sales
        // without ever reaching fulfilment, so they are carved out separately.
        const cancelRate = digital ? rnd() * 0.006 : (CANCEL_BASE[channelId] ?? 0.04) + rnd() * 0.012;
        const cancelValue = gross * (cancelRate / (1 - cancelRate));
        const grossSales = gross + cancelValue;

        // Returns split into customer returns and RTO — different root causes,
        // different fixes. The two always sum back to the returns bucket.
        const rtoShare = RTO_SHARE[channelId] ?? 0.4;
        const rtoValue = returnsValue * rtoShare;
        const returnValue = returnsValue - rtoValue;

        // Who paid for the discount changes what it costs the brand.
        const platformShare = PLATFORM_FUNDED[channelId] ?? 0;
        const discountPlatform = discount * platformShare;
        const discountBrand = discount - discountPlatform;

        const net = gross - discount - fees - shipping - returnsValue;
        const cogs = units * product.price * product.cogsRate * COGS_ADJ * (1 - returnRate * 0.55);
        const orders = Math.max(1, Math.round(units / (1.15 + rnd() * 0.5)));

        rows.push({
          date: iso(date), ts,
          company: product.company, channel: channelId,
          category: product.category, product: product.id,
          subcategory: product.subcategory ?? product.category,
          units, orders,
          gross, grossSales, cancelValue,
          discount, discountPlatform, discountBrand,
          fees, shipping, returnsValue, returnValue, rtoValue,
          logistics:   shipping * COST_SPLIT.logistics,
          fulfilment:  shipping * COST_SPLIT.fulfilment,
          warehousing: shipping * COST_SPLIT.warehousing,
          paymentFees: shipping * COST_SPLIT.paymentFees,
          otherCost:   shipping * COST_SPLIT.otherCost,
          net, cogs, margin: net - cogs,
        });
      }
    }
  }
  rows.sort((a, b) => a.ts - b.ts);
  return rows;
}

export function facts() {
  if (!_facts) _facts = buildFacts();
  return _facts;
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

export const COMPARISON_MODES = [
  { id: 'previous', label: 'Previous Period' },
  { id: 'year',     label: 'Previous Year' },
  { id: 'budget',   label: 'Budget' },
  { id: 'target',   label: 'Target' },
  { id: 'forecast', label: 'Forecast' },
];

/**
 * The window the fact table actually covers. Every date control clamps to it,
 * so a range can never be chosen that silently returns a partial answer.
 */
export const DATA_RANGE = (() => {
  const end = new Date(TODAY); end.setHours(23, 59, 59, 999);
  const start = new Date(TODAY);
  start.setDate(start.getDate() - HISTORY_DAYS + 1);
  start.setHours(0, 0, 0, 0);
  return { start, end, days: HISTORY_DAYS };
})();

/** Pull a date inside the covered window. */
function clampToData(d) {
  if (d < DATA_RANGE.start) return new Date(DATA_RANGE.start);
  if (d > DATA_RANGE.end) return new Date(DATA_RANGE.end);
  return d;
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
      start = new Date(TODAY.getFullYear(), 0, 1);
      break;
    case 'custom':
      if (custom?.start && custom?.end) {
        // A range outside the covered window would read as a collapse in the
        // business rather than as missing history, so it is pulled back in.
        const cs = clampToData(new Date(custom.start + 'T00:00:00'));
        const ce = clampToData(new Date(custom.end + 'T23:59:59'));
        const [a, b] = cs <= ce ? [cs, ce] : [ce, cs];
        return {
          start: a, end: b, label: 'Custom Range',
          clamped: custom.start < iso(DATA_RANGE.start) || custom.end > iso(DATA_RANGE.end),
        };
      }
      start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
      break;
    default:
      start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  }
  start.setHours(0, 0, 0, 0);
  return {
    start: clampToData(start), end: clampToData(end),
    label: PERIOD_PRESETS.find(p => p.id === presetId)?.label ?? 'This Month',
  };
}

/** The window a comparison mode reads from. Budget/target/forecast are modelled, not historic. */
/** What the comparison series is actually showing — never a fixed string. */
export function comparisonLabel(mode) {
  return {
    previous: 'Previous Period', year: 'Previous Year',
    budget: 'Budget', target: 'Target', forecast: 'Forecast',
  }[mode] ?? 'Previous Period';
}

/** True when the comparison is a historical window rather than a plan figure. */
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
  net: 0, cogs: 0, margin: 0,
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
  return target;
}

/**
 * Filter the fact table. `scope` narrows by company/channel/category/product;
 * every drill-down level is the same call with one more key set.
 */
export function query({ start, end, company = 'all', channel, category, subcategory, product } = {}) {
  const s = start ? start.getTime() : -Infinity;
  const e = end ? end.getTime() : Infinity;
  return facts().filter(r =>
    r.ts >= s && r.ts <= e &&
    (company === 'all' || r.company === company) &&
    (!channel  || r.channel  === channel) &&
    (!category    || r.category    === category) &&
    (!subcategory || r.subcategory === subcategory) &&
    (!product     || r.product     === product)
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

/** Daily / weekly / monthly series for charting. */
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

export function series(scope, granularity = 'day') {
  const map = new Map();
  for (const row of query(scope)) {
    const bucket = granularity === 'day' ? row.date : bucketStart(row.ts, granularity);
    if (!map.has(bucket)) map.set(bucket, { date: bucket, ts: new Date(bucket + 'T00:00:00').getTime(), ...ZERO() });
    accumulate(map.get(bucket), row);
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts);
}

/** SKU-level split of a product, derived from fixed ratios so it sums exactly. */
export function skuBreakdown(scope) {
  const product = PRODUCTS.find(p => p.id === scope.product);
  if (!product) return [];
  const t = totals(scope);
  return skusForProduct(product).map(sku => ({
    ...sku,
    units: Math.round(t.units * sku.ratio),
    net: t.net * sku.ratio,
    gross: t.gross * sku.ratio,
    margin: t.margin * sku.ratio,
  }));
}

/** Synthetic transactions for a SKU that sum to that SKU's revenue. */
export function transactionsFor({ skuId, productId, channel, start, end, limit = 60 }) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return [];
  const sku = skusForProduct(product).find(s => s.id === skuId);
  if (!sku) return [];

  const rows = query({ start, end, company: product.company, channel, product: productId });
  const rnd = rngFor(`${skuId}|${channel}|tx`);
  const CITIES = ['Mumbai', 'Bengaluru', 'Delhi', 'Pune', 'Hyderabad', 'Chennai', 'Ahmedabad', 'Kolkata', 'Jaipur', 'Surat'];
  const STATES = { Mumbai: 'MH', Pune: 'MH', Bengaluru: 'KA', Delhi: 'DL', Hyderabad: 'TS', Chennai: 'TN', Ahmedabad: 'GJ', Surat: 'GJ', Kolkata: 'WB', Jaipur: 'RJ' };

  const out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const row = rows[i];
    const skuUnits = Math.round(row.units * sku.ratio);
    if (skuUnits <= 0) continue;
    const orderCount = Math.max(1, Math.round(skuUnits / (1.2 + rnd() * 0.6)));

    for (let j = 0; j < orderCount && out.length < limit; j++) {
      const qty = Math.max(1, Math.round(skuUnits / orderCount));
      const gross = qty * product.price;
      const discount = gross * (0.05 + rnd() * 0.09);
      const fee = (gross - discount) * (CHANNEL_FEE_RATE[row.channel] ?? 0.18);
      const city = CITIES[Math.floor(rnd() * CITIES.length)];
      const isCod = rnd() < (CHANNEL_COD_RATE[row.channel] ?? 0.3);
      const r = rnd();
      const status = r < 0.055 ? 'Returned' : r < 0.085 ? 'RTO' : r < 0.115 ? 'In Transit' : 'Delivered';

      out.push({
        id: `${row.channel.slice(0, 2).toUpperCase()}-${row.date.replace(/-/g, '')}-${String(out.length + 1).padStart(4, '0')}`,
        date: row.date, ts: row.ts,
        channel: row.channel, skuCode: sku.code, variant: sku.label,
        product: product.name, qty,
        gross, discount, fee, net: gross - discount - fee,
        payment: isCod ? 'COD' : 'Prepaid',
        city, state: STATES[city], status,
      });
    }
  }
  return out;
}

// ── Derived business metrics ──────────────────────────────────────────────

/**
 * The sales-to-profit ladder, identical at every level of the hierarchy.
 *
 *   Gross Sales − Cancellations − Returns − Discounts = Net Sales
 *   Net Sales − COGS − Channel Fees − Logistics − Warehousing
 *             − Fulfilment − Payment Fees − Other        = CM1
 *   CM1 − Marketing                                       = CM2
 *   CM2 − Salaries − Overheads − D&A − Interest − Tax     = Net Margin
 *
 * Because every line is summed from the same fact rows, a channel, category,
 * product or SKU uses this exact function — the CEO reads one structure the
 * whole way down. CM1 is identical to the ledger's contribution figure and Net
 * Margin to the P&L's net profit, so Sales can never drift from Finance.
 */
export function salesModel(scope) {
  const t = totals(scope);

  const netSales = t.grossSales - t.cancelValue - t.returnsValue - t.discount;
  const variableCosts = t.fees + t.logistics + t.warehousing + t.fulfilment + t.paymentFees + t.otherCost;
  const cm1 = netSales - t.cogs - variableCosts;

  // Company-level costs use the same rates as the P&L so the two agree.
  const marketing = t.net * 0.105;
  const salaries  = t.net * 0.072;
  // 0.026 admin + 0.028 company logistics overhead. The latter is the network
  // cost that sits above per-order shipping, which is already a CM1 line — it
  // belongs here so the ladder lands on the same net profit as the P&L.
  const overheads = t.net * (0.026 + 0.028);
  const cm2 = cm1 - marketing;

  const depreciation = t.net * 0.012;
  const interest     = t.net * 0.008;
  const pbt = cm2 - salaries - overheads - depreciation - interest;
  const tax = Math.max(0, pbt) * 0.252;
  const netMargin = pbt - tax;

  const pctOf = (v) => (netSales ? (v / netSales) * 100 : 0);

  return {
    units: t.units, orders: t.orders,
    grossSales: t.grossSales,
    cancellations: t.cancelValue,
    returns: t.returnsValue,
    discounts: t.discount,
    netSales,
    // Sales-performance measures
    asp: t.units ? netSales / t.units : 0,
    unitsPerOrder: t.orders ? t.units / t.orders : 0,
    revenuePerOrder: t.orders ? netSales / t.orders : 0,
    discountPerOrder: t.orders ? t.discount / t.orders : 0,
    discountPlatform: t.discountPlatform,
    discountBrand: t.discountBrand,
    customerReturns: t.returnValue,
    rto: t.rtoValue,
    cogs: t.cogs,
    channelFees: t.fees,
    logistics: t.logistics,
    warehousing: t.warehousing,
    fulfilment: t.fulfilment,
    paymentFees: t.paymentFees,
    otherCost: t.otherCost,
    variableCosts,
    cm1, cm2, marketing, salaries, overheads, depreciation, interest, tax, netMargin,

    // Rates the CEO reads first.
    cancelPct: t.grossSales ? (t.cancelValue / t.grossSales) * 100 : 0,
    returnPct: t.grossSales ? (t.returnsValue / t.grossSales) * 100 : 0,
    customerReturnPct: t.grossSales ? (t.returnValue / t.grossSales) * 100 : 0,
    rtoPct: t.grossSales ? (t.rtoValue / t.grossSales) * 100 : 0,
    discountPct: t.grossSales ? (t.discount / t.grossSales) * 100 : 0,
    platformFundedPct: t.discount ? (t.discountPlatform / t.discount) * 100 : 0,

    // Channel economics — what it costs to sell through this channel. COGS is
    // deliberately excluded: it is a product cost, not a channel cost.
    channelCost: variableCosts,
    // Grouped the way a marketplace statement reads.
    logisticsCollection: t.logistics + t.paymentFees,
    otherDeductions: t.warehousing + t.fulfilment + t.otherCost,
    // What actually reaches us after the marketplace has taken its cut. This is
    // the endpoint of channel economics: it deliberately stops before COGS, so
    // it carries no internal cost or profit information.
    realizedSales: netSales - variableCosts,
    realizedPct: t.grossSales ? ((netSales - variableCosts) / t.grossSales) * 100 : 0,
    totalDeductions: t.grossSales - (netSales - variableCosts),
    channelCostPct: pctOf(variableCosts),
    channelCostPerOrder: t.orders ? variableCosts / t.orders : 0,
    feesPerOrder: t.orders ? t.fees / t.orders : 0,
    logisticsPerOrder: t.orders ? t.logistics / t.orders : 0,
    otherCostPerOrder: t.orders ? (t.warehousing + t.fulfilment + t.paymentFees + t.otherCost) / t.orders : 0,
    contributionPerOrder: t.orders ? cm1 / t.orders : 0,
    cm1Pct: pctOf(cm1),
    cm2Pct: pctOf(cm2),
    netMarginPct: pctOf(netMargin),
    cogsPct: pctOf(t.cogs),
    channelFeesPct: pctOf(t.fees),
    logisticsPct: pctOf(t.logistics),
    warehousingPct: pctOf(t.warehousing),
    fulfilmentPct: pctOf(t.fulfilment),
    paymentFeesPct: pctOf(t.paymentFees),
    otherCostPct: pctOf(t.otherCost),
    aov: t.orders ? netSales / t.orders : 0,
    pctOf,
  };
}

/**
 * The waterfall rows. `perm` tags the lines that require permission, so one
 * definition serves every role — a Sales user simply receives fewer rows.
 * There is never a second, divergent calculation.
 */
export function salesWaterfall(m, can) {
  const rows = [
    { id: 'gross',       label: 'Gross Sales',        value: m.grossSales,     kind: 'start' },
    { id: 'discounts',   label: 'Discounts',          value: -m.discounts,     kind: 'cost' },
    { id: 'cancel',      label: 'Cancellations',      value: -m.cancellations, kind: 'cost' },
    { id: 'returns',     label: 'Returns & RTO',      value: -m.returns,       kind: 'cost' },
    { id: 'netSales',    label: 'Net Sales',          value: m.netSales,       kind: 'subtotal' },
    { id: 'cogs',        label: 'Cost of Goods Sold', value: -m.cogs,          kind: 'cost', perm: 'fin.cogs' },
    { id: 'fees',        label: 'Channel Fees',       value: -m.channelFees,   kind: 'cost' },
    { id: 'logistics',   label: 'Logistics',          value: -m.logistics,     kind: 'cost' },
    { id: 'warehousing', label: 'Warehousing',        value: -m.warehousing,   kind: 'cost' },
    { id: 'fulfilment',  label: 'Fulfilment',         value: -m.fulfilment,    kind: 'cost' },
    { id: 'payment',     label: 'Payment & Collection', value: -m.paymentFees, kind: 'cost' },
    { id: 'other',       label: 'Other Channel Costs', value: -m.otherCost,    kind: 'cost' },
    { id: 'channelCost', label: 'Total Channel Cost', value: m.channelCost,    kind: 'subtotal', salesOnly: true },
    { id: 'cm1',         label: 'CM1',                value: m.cm1,            kind: 'subtotal', perm: 'fin.contribution' },
    { id: 'marketing',   label: 'Marketing & Ads',    value: -m.marketing,     kind: 'cost',     perm: 'fin.contribution' },
    { id: 'cm2',         label: 'CM2',                value: m.cm2,            kind: 'subtotal', perm: 'fin.contribution' },
    { id: 'opex',        label: 'Salaries & Overheads', value: -(m.salaries + m.overheads), kind: 'cost', perm: 'fin.netMargin' },
    { id: 'below',       label: 'D&A, Interest & Tax',  value: -(m.depreciation + m.interest + m.tax), kind: 'cost', perm: 'fin.netMargin' },
    { id: 'netMargin',   label: 'Net Margin',         value: m.netMargin,      kind: 'total',    perm: 'fin.netMargin' },
  ];
  if (!can) return rows.filter(r => !r.salesOnly);
  // A viewer without contribution rights ends on total channel cost instead.
  const showsProfit = can('fin.contribution') || can('fin.netMargin');
  return rows.filter(r => (r.perm ? can(r.perm) : true) && (r.salesOnly ? !showsProfit : true));
}

/**
 * GMV → marketplace deductions → Marketplace Realized Sales, as stepped
 * waterfall rows. Each deduction starts where the previous one ended, so the
 * bars read as a single falling sequence rather than separate magnitudes.
 *
 * Deliberately stops at realized sales — COGS, contribution and profit belong
 * to the layer above and are never computed here.
 */
export function marketplaceWaterfall(m) {
  const deductions = [
    { id: 'discounts',   label: 'Discounts',       value: m.discounts },
    { id: 'cancel',      label: 'Cancellations',   value: m.cancellations },
    { id: 'returns',     label: 'Returns / RTO',   value: m.returns },
    { id: 'fees',        label: 'Marketplace Fees', value: m.channelFees },
    { id: 'logistics',   label: 'Logistics / Collection', value: m.logisticsCollection },
    { id: 'other',       label: 'Other Deductions', value: m.otherDeductions },
  ];

  const steps = [{ id: 'gmv', label: 'GMV', kind: 'total', base: 0, value: m.grossSales, amount: m.grossSales }];
  let running = m.grossSales;
  for (const d of deductions) {
    running -= d.value;
    steps.push({ id: d.id, label: d.label, kind: 'cost', base: running, value: d.value, amount: -d.value });
  }
  steps.push({ id: 'realized', label: 'Realized Sales', kind: 'total', base: 0, value: running, amount: running });
  return steps;
}

/** Cash at bank, per company. A point-in-time balance, independent of period. */
const CASH_RESERVE = {
  kosha: 21_500_000, verve: 11_400_000, nutreats: 6_900_000, aurelia: 5_200_000,
  all: 45_000_000,
};

/** Finance figures modelled off actual net revenue so they stay consistent. */
export function financials(scope) {
  const t = totals(scope);
  const grossProfit = t.margin;

  // Operating cost stack, expressed against net revenue.
  const marketing = t.net * 0.105;
  const salaries  = t.net * 0.072;
  const logistics = t.net * 0.028;
  const overheads = t.net * 0.026;
  const opex = marketing + salaries + logistics + overheads;

  const ebitda = grossProfit - opex;
  const depreciation = t.net * 0.012;
  const interest = t.net * 0.008;
  const pbt = ebitda - depreciation - interest;
  const tax = Math.max(0, pbt) * 0.252;
  const netProfit = pbt - tax;

  // Normalise the burn to a monthly figure regardless of the period length.
  const periodDays = Math.max(1, Math.round((scope.end - scope.start) / 86400000) + 1);

  // Cash and runway describe the company, not a channel. Under a channel filter
  // the burn is still computed company-wide — otherwise full company cash would
  // be divided by one channel's costs and runway would read far too long.
  const companyNet = scope.channel
    ? totals({ ...scope, channel: undefined }).net
    : t.net;
  const companyOpex = companyNet * (0.105 + 0.072 + 0.028 + 0.026);
  const monthlyBurn = (companyOpex / periodDays) * 30;

  const cash = CASH_RESERVE[scope.company ?? 'all'] ?? CASH_RESERVE.all;
  const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : null;

  return {
    ...t,
    grossProfit,
    grossMarginPct: t.net ? (grossProfit / t.net) * 100 : 0,
    marketing, salaries, logistics, overheads, opex,
    ebitda,
    ebitdaPct: t.net ? (ebitda / t.net) * 100 : 0,
    depreciation, interest, pbt, tax, netProfit,
    netMarginPct: t.net ? (netProfit / t.net) * 100 : 0,
    cash,
    burnRate: monthlyBurn,
    runwayMonths,
    receivables: t.net * 0.226,
    payables: t.net * 0.153,
    overdues: t.net * 0.028,
  };
}

/**
 * Company Health — a weighted, fully explainable score. Each component is a
 * real measured ratio scaled to 0-100, never an opaque model output.
 */
/*
 * Company Health moved to data/health.js, where a CEO picks five business
 * dimensions out of ten. The cut-points below stay here because the band and
 * indicator tones are shared by both the score and the KPI strip.
 */

export const HEALTH_CUTS = { good: 80, watch: 65, atRisk: 50 };

export function healthBand(score) {
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
 * The one-line read on where the business stands, from three measured signals.
 * Rules are fixed and ordered — cash first, because nothing else matters if the
 * company runs out of it. Nothing here is inferred or generated.
 */
export function businessPhase({ growthPct, runwayMonths, netMarginPct }) {
  const g = growthPct ?? 0;
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
 * Targets are stored as a multiple of a company's typical run-rate so
 * "vs Target" is meaningful for any period length.
 */
const TARGET_INDEX = { kosha: 1.09, verve: 1.14, nutreats: 1.21, aurelia: 1.05, all: 1.11 };
const BUDGET_INDEX = { kosha: 1.04, verve: 1.08, nutreats: 1.12, aurelia: 1.02, all: 1.06 };

export function targetFor(companyId, actualNet)   { return actualNet * (TARGET_INDEX[companyId] ?? 1.15); }
export function budgetFor(companyId, actualNet)   { return actualNet * (BUDGET_INDEX[companyId] ?? 1.10); }

/** Straight-line forecast to period end from run-rate so far. */
export function forecastFor(period, actualNet) {
  const elapsed = Math.max(1, Math.round((Math.min(TODAY, period.end) - period.start) / 86400000) + 1);
  const total = Math.max(1, Math.round((period.end - period.start) / 86400000) + 1);
  return (actualNet / elapsed) * total;
}

export function companyLabel(id) {
  return id === 'all' ? 'All Brands' : COMPANY_BY_ID[id]?.name ?? id;
}

export { COMPANIES, COMPANY_BY_ID };
