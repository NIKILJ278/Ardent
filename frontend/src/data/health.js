// Company Health — ten business dimensions, of which a CEO picks five.
//
// A dimension is not a metric. It is a question the CEO actually asks, scored
// from several underlying measures, so the Overview can carry one number per
// question instead of a wall of ratios. Which five matter is a property of the
// business, so the set is chosen, not assumed.
//
// A dimension is only scored when the data it needs is connected. One that is
// not stays on the card as "not connected" and is left out of the overall
// score, rather than being scored on a figure nobody measured.

import { salesModel, groupBy } from './engine.js';
import { availability } from './live.js';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(clamp(n));

/** Score something where lower is better — 0 is perfect, `bad` is a zero. */
const inverse = (value, bad) => round(100 - (value / (bad || 1)) * 100);

const growthOf = (cur, prev) => (prev ? (cur - prev) / prev : 0);

/* ── The ten dimensions ───────────────────────────────────────────────────
   `available` decides whether the dimension can be scored from what is
   connected. `metrics` is a getter, so each metric's `live` flag reflects the
   sources connected at the moment it is read.
   ──────────────────────────────────────────────────────────────────────── */

export const DIMENSIONS = [
  {
    id: 'sales',
    label: 'Sales & Growth',
    question: 'Are we growing?',
    blurb: 'Top-line momentum against the previous period.',
    needs: 'order data',
    get metrics() {
      return [
        { label: 'Gross sales', live: true },
        { label: 'Net sales', live: true },
        { label: 'Growth vs previous period', live: true },
        { label: 'Target attainment', live: false },
      ];
    },
    available: (a) => a.sales,
    score: ({ model, prevModel }) => round(72 + growthOf(model.netSales, prevModel?.netSales) * 190),
    basis: 'Net sales growth against the previous period',
    caveat: 'Target attainment needs targets set on the Goals page.',
  },
  {
    id: 'profitability',
    label: 'Profitability',
    question: 'Are we actually making money?',
    blurb: 'What survives after cost of goods, channel cost and the operating stack.',
    needs: 'cost of goods, channel costs and operating expenses',
    get metrics() {
      return [
        { label: 'Gross margin', live: availability().cogs },
        { label: 'Contribution margin', live: false },
        { label: 'EBITDA and net profit', live: false },
      ];
    },
    available: () => false,
    score: () => null,
    basis: 'EBITDA and net margin against benchmarks',
  },
  {
    id: 'unitEconomics',
    label: 'Unit Economics',
    question: 'Does each sale make economic sense?',
    blurb: 'Whether a single order pays for its own goods before any other cost.',
    needs: 'unit costs on every product sold',
    get metrics() {
      const a = availability();
      return [
        { label: 'Gross margin per order', live: a.cogs },
        { label: 'Cost of goods as % of net sales', live: a.cogs },
        { label: 'Average order value', live: true },
        { label: 'Channel cost per order', live: false },
      ];
    },
    available: (a) => a.cogs,
    // Before any channel cost, a healthy direct-to-consumer order keeps more
    // than half its value after the goods themselves.
    score: ({ model }) => round(((model.grossMarginPct ?? 0) / 55) * 88),
    basis: 'Gross margin against a 55% benchmark, before channel costs',
    caveat: 'Channel costs are not connected, so this stops at gross margin.',
  },
  {
    id: 'cash',
    label: 'Cash & Liquidity',
    question: 'Do we have enough cash?',
    blurb: 'How long the company can operate on what it holds today.',
    needs: 'bank statements',
    get metrics() {
      return [
        { label: 'Cash position', live: false },
        { label: 'Monthly burn', live: false },
        { label: 'Runway in months', live: false },
      ];
    },
    available: () => false,
    score: () => null,
    basis: 'Runway against an eight-month floor',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    question: 'Is our inventory healthy and productive?',
    blurb: 'Whether stock is turning, or sitting still and tying up cash.',
    needs: 'stock levels',
    get metrics() {
      return [
        { label: 'Inventory value', live: false },
        { label: 'Turnover and days of cover', live: false },
        { label: 'Stock-outs and dead stock', live: false },
      ];
    },
    available: () => false,
    score: () => null,
    basis: 'Turnover and days of cover, marked down for stock-outs and dead stock',
  },
  {
    id: 'customers',
    label: 'Customers & Demand',
    question: 'Is demand healthy?',
    blurb: 'Whether demand is broadening or being bought with discount.',
    needs: 'order data',
    get metrics() {
      return [
        { label: 'Order volume and growth', live: true },
        { label: 'Average order value', live: true },
        { label: 'Discount dependency', live: true },
        { label: 'New vs repeat customers', live: false },
        { label: 'CAC, LTV and retention', live: false },
      ];
    },
    available: (a) => a.sales,
    score: ({ model, prevModel }) => {
      // Demand bought with discount is worth less than demand that holds price.
      const priceHold = inverse(model.discountPct, 28);
      return round(
        clamp(70 + growthOf(model.orders, prevModel?.orders) * 180) * 0.45
        + clamp(72 + growthOf(model.revenuePerOrder, prevModel?.revenuePerOrder) * 160) * 0.25
        + priceHold * 0.3
      );
    },
    basis: 'Order and basket growth, discounted for how much of it was bought with promotion',
    caveat: 'Repeat rate, CAC and LTV need customer data, which is not synced yet.',
  },
  {
    id: 'channels',
    label: 'Channel Economics',
    question: 'Which channels are creating value?',
    blurb: 'How much of GMV survives each channel, and whether the mix is concentrated.',
    needs: 'marketplace connections and channel fees',
    get metrics() {
      return [
        { label: 'Sales by channel', live: true },
        { label: 'Realized sales after fees', live: false },
        { label: 'Channel concentration', live: false },
      ];
    },
    available: () => false,
    score: () => null,
    basis: 'Share of sales surviving channel cost, marked down for dependence on one channel',
  },
  {
    id: 'products',
    label: 'Products & SKUs',
    question: 'Which products are winning or losing?',
    blurb: 'Whether the range earns its place, or one product carries everything.',
    needs: 'order data',
    get metrics() {
      return [
        { label: 'Sales by product and SKU', live: true },
        { label: 'Range concentration', live: true },
        { label: 'Return rate by product', live: true },
        { label: 'Margin by product', live: availability().cogs },
      ];
    },
    available: (a) => a.sales,
    score: ({ productModels }) => {
      if (!productModels?.length) return null;
      const total = productModels.reduce((s, p) => s + p.netSales, 0) || 1;
      const top = Math.max(...productModels.map(p => p.netSales)) / total;
      const concentration = inverse(Math.max(0, top - 0.25), 0.45);
      const gross = productModels.reduce((s, p) => s + p.grossSales, 0) || 1;
      const returns = productModels.reduce((s, p) => s + p.returns, 0);
      const returnHealth = inverse((returns / gross) * 100, 18);
      return round(concentration * 0.5 + returnHealth * 0.5);
    },
    basis: 'Range concentration and the return rate across products',
  },
  {
    id: 'operations',
    label: 'Operations',
    question: 'Are we executing efficiently?',
    blurb: 'What the business loses between taking an order and keeping it.',
    needs: 'order data',
    get metrics() {
      return [
        { label: 'Cancellation rate', live: true },
        { label: 'Return rate', live: true },
        { label: 'Return to origin', live: false },
        { label: 'Delivery performance', live: false },
      ];
    },
    available: (a) => a.sales,
    score: ({ model }) => round(inverse(model.returnPct, 18) * 0.6 + inverse(model.cancelPct, 12) * 0.4),
    basis: 'Returns and cancellations against tolerable ceilings',
    caveat: 'Return-to-origin and delivery performance need courier data.',
  },
  {
    id: 'workingCapital',
    label: 'Working Capital',
    question: 'Where is our money tied up?',
    blurb: 'How much of the business is locked in stock and unsettled receivables.',
    needs: 'accounting, bank and stock data',
    get metrics() {
      return [
        { label: 'Receivables and payables', live: false },
        { label: 'Inventory value', live: false },
        { label: 'Cash conversion cycle', live: false },
      ];
    },
    available: () => false,
    score: () => null,
    basis: 'Overdue receivables and the cash conversion cycle',
  },
];

export const DIMENSION_BY_ID = Object.fromEntries(DIMENSIONS.map(d => [d.id, d]));

/** How many indicators the Overview carries. Fixed — the card is built for it. */
export const HEALTH_SLOTS = 5;

/** The default set, as the CEO chose it. Unconnected rows say so on the card. */
export const DEFAULT_HEALTH_CONFIG = {
  dimensions: ['sales', 'profitability', 'cash', 'inventory', 'channels'],
  weights: { sales: 20, profitability: 20, cash: 20, inventory: 20, channels: 20 },
};

/** Repair a stored config: right length, known ids, weights for each. */
export function normaliseConfig(config) {
  const known = new Set(DIMENSIONS.map(d => d.id));
  let ids = (config?.dimensions ?? []).filter(id => known.has(id));
  ids = [...new Set(ids)].slice(0, HEALTH_SLOTS);
  for (const id of DEFAULT_HEALTH_CONFIG.dimensions) {
    if (ids.length >= HEALTH_SLOTS) break;
    if (!ids.includes(id)) ids.push(id);
  }
  const even = Math.round(100 / HEALTH_SLOTS);
  const weights = {};
  for (const id of ids) weights[id] = config?.weights?.[id] ?? even;
  return { dimensions: ids, weights };
}

/**
 * Score the selected dimensions and the company overall.
 *
 * The overall is a weighted average of the dimensions that could be scored.
 * If none could, it is null — a health score of zero would say the business is
 * failing, when the truth is that nothing has been measured.
 */
export function companyHealth({ scope, prevScope, period, config }) {
  const cfg = normaliseConfig(config);
  const selected = cfg.dimensions.map(id => DIMENSION_BY_ID[id]);
  const avail = availability();

  const model = salesModel(scope);
  const prevModel = salesModel(prevScope);
  const productModels = avail.sales && selected.some(d => d.id === 'products')
    ? groupBy(scope, 'product').map(p => salesModel({ ...scope, product: p.key }))
    : null;

  const ctx = { model, prevModel, productModels, period, scope, avail };

  const scores = {};
  const unavailable = [];
  for (const d of selected) {
    const score = d.available(avail) ? d.score(ctx) : null;
    scores[d.id] = score;
    if (score == null) unavailable.push(d.id);
  }

  const scored = cfg.dimensions.filter(id => scores[id] != null);
  const weight = scored.reduce((s, id) => s + (cfg.weights[id] ?? 0), 0);
  const overall = scored.length && weight
    ? Math.round(scored.reduce((s, id) => s + scores[id] * (cfg.weights[id] ?? 0), 0) / weight)
    : null;

  return { overall, scores, config: cfg, dimensions: selected, context: ctx, unavailable, scoredCount: scored.length };
}

/**
 * The live figures behind one dimension, for the breakdown view. Values are
 * pre-formatted strings so the modal stays a presentation layer.
 */
export function dimensionDetail(id, ctx, fmt) {
  const { money, num, pct } = fmt;
  const { model, prevModel, productModels, avail } = ctx;
  const off = 'not connected';
  const growth = prevModel?.netSales ? ((model.netSales - prevModel.netSales) / prevModel.netSales) * 100 : null;

  switch (id) {
    case 'sales':
      return [
        ['Gross sales', money(model.grossSales)],
        ['Net sales', money(model.netSales)],
        ['Growth vs previous', growth == null ? '—' : pct(growth)],
        ['Target attainment', 'set a target on Goals'],
      ];
    case 'profitability':
      return [
        ['Gross margin', avail.cogs ? `${money(model.grossMargin)} · ${pct(model.grossMarginPct)}` : off],
        ['Contribution margin', off],
        ['EBITDA and net profit', off],
      ];
    case 'unitEconomics':
      return [
        ['Gross margin per order', avail.cogs ? money(model.grossMarginPerOrder) : off],
        ['Cost of goods % of net sales', avail.cogs ? pct(model.cogsPct) : off],
        ['Average order value', money(model.revenuePerOrder)],
        ['Channel cost per order', off],
      ];
    case 'cash':
      return [['Cash position', off], ['Monthly burn', off], ['Runway', off]];
    case 'inventory':
      return [['Inventory value', off], ['Turnover', off], ['Stock-outs', off]];
    case 'customers':
      return [
        ['Orders', num(model.orders)],
        ['Order growth', prevModel?.orders ? pct(((model.orders - prevModel.orders) / prevModel.orders) * 100) : '—'],
        ['Average order value', money(model.revenuePerOrder)],
        ['Discount dependency', pct(model.discountPct)],
        ['Repeat rate, CAC, LTV', off],
      ];
    case 'channels':
      return [['Realized sales after fees', off], ['Channel concentration', off]];
    case 'products': {
      if (!productModels?.length) return [['Products selling', '0']];
      const total = productModels.reduce((s, p) => s + p.netSales, 0) || 1;
      const top = Math.max(...productModels.map(p => p.netSales));
      return [
        ['Products selling', String(productModels.length)],
        ['Largest product share', pct((top / total) * 100)],
        ['Return rate', pct(model.returnPct)],
        ['Margin by product', avail.cogs ? 'see Sales' : off],
      ];
    }
    case 'operations':
      return [
        ['Cancellation rate', pct(model.cancelPct)],
        ['Return rate', pct(model.returnPct)],
        ['Return to origin', off],
        ['Delivery performance', off],
      ];
    case 'workingCapital':
      return [['Receivables and payables', off], ['Inventory value', off], ['Cash conversion cycle', off]];
    default:
      return [];
  }
}
