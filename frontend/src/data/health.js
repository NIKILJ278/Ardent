// Company Health — ten business dimensions, of which a CEO picks five.
//
// A dimension is not a metric. It is a question the CEO actually asks, scored
// from several underlying measures, so the Overview can carry one number per
// question instead of a wall of ratios. Which five matter is a property of the
// business: a furniture brand has no use for repeat rate, and a consumables
// brand lives on it. So the set is chosen, not assumed.
//
// Every score is computed from the same fact table as the rest of the app.
// Where a dimension needs data Ardent does not yet hold, that metric is listed
// as not connected rather than quietly invented, and the dimension scores on
// what it can measure.

import { financials, salesModel, groupBy, targetFor } from './engine.js';
import { inventorySnapshot } from './inventory.js';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n) => Math.round(clamp(n));

/** Score something where lower is better — 0 is perfect, `bad` is a zero. */
const inverse = (value, bad) => round(100 - (value / (bad || 1)) * 100);

/* ── The ten dimensions ───────────────────────────────────────────────────
   `metrics` names what feeds the score. `live: false` marks a metric Ardent
   cannot compute yet, which the configuration screen shows before you pick a
   dimension rather than after.
   ──────────────────────────────────────────────────────────────────────── */

export const DIMENSIONS = [
  {
    id: 'sales',
    label: 'Sales & Growth',
    question: 'Are we growing?',
    blurb: 'Top-line momentum against both the previous period and the plan.',
    metrics: [
      { label: 'Gross sales', live: true },
      { label: 'Net sales', live: true },
      { label: 'Growth vs previous period', live: true },
      { label: 'Target attainment', live: true },
    ],
    score: ({ fin, prevFin, target }) => {
      const attainment = target ? fin.net / target : 1;
      const growth = prevFin?.net ? (fin.net - prevFin.net) / prevFin.net : 0;
      // Attainment carries the weight; growth adjusts it either way.
      return round(clamp(attainment * 92) * 0.65 + clamp(72 + growth * 190) * 0.35);
    },
    basis: 'Net sales against target, adjusted for growth on the previous period',
  },
  {
    id: 'profitability',
    label: 'Profitability',
    question: 'Are we actually making money?',
    blurb: 'What survives after cost of goods, channel cost and the operating stack.',
    metrics: [
      { label: 'Contribution margin (CM1)', live: true },
      { label: 'EBITDA and EBITDA %', live: true },
      { label: 'Net profit', live: true },
      { label: 'Net margin %', live: true },
    ],
    score: ({ fin }) => round(
      clamp((fin.ebitdaPct / 16) * 78) * 0.6 + clamp((fin.netMarginPct / 10) * 82) * 0.4
    ),
    basis: 'EBITDA margin against a 16% benchmark, with net margin against 10%',
  },
  {
    id: 'unitEconomics',
    label: 'Unit Economics',
    question: 'Does each sale make economic sense?',
    blurb: 'Whether a single order pays for itself before any fixed cost.',
    metrics: [
      { label: 'Contribution per order', live: true },
      { label: 'COGS as % of net sales', live: true },
      { label: 'Channel cost per order', live: true },
      { label: 'Average order value', live: true },
    ],
    score: ({ model }) => {
      if (!model) return 0;
      // A healthy order keeps about a third of its value after variable cost.
      const contribution = clamp((model.cm1Pct / 32) * 86);
      const drag = inverse(model.channelCostPct, 45);
      return round(contribution * 0.7 + drag * 0.3);
    },
    basis: 'Contribution margin per order against a 32% benchmark, less channel cost drag',
  },
  {
    id: 'cash',
    label: 'Cash & Liquidity',
    question: 'Do we have enough cash?',
    blurb: 'How long the company can operate on what it holds today.',
    metrics: [
      { label: 'Cash position', live: true },
      { label: 'Monthly burn', live: true },
      { label: 'Runway in months', live: true },
      { label: 'Bank reconciliation status', live: true },
    ],
    score: ({ fin }) => round(((fin.runwayMonths ?? 0) / 8) * 88),
    basis: 'Runway against an eight-month floor',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    question: 'Is our inventory healthy and productive?',
    blurb: 'Whether stock is turning, or sitting still and tying up cash.',
    metrics: [
      { label: 'Inventory value at cost', live: true },
      { label: 'Inventory turnover', live: true },
      { label: 'Days of cover', live: true },
      { label: 'Stock-outs', live: true },
      { label: 'Dead and slow stock', live: true },
    ],
    needsInventory: true,
    score: ({ inv }) => {
      if (!inv || !inv.productCount) return 0;
      // Twelve turns a year is an excellent consumer-goods position; six is
      // ordinary. Scoring against six put every brand on the ceiling, which
      // told the CEO nothing.
      const turns = clamp((inv.turns / 12) * 100);
      // Cover has a sweet spot. Too little risks stock-outs, too much is cash
      // sitting in a warehouse, so both ends are marked down.
      const cover = inv.daysOfCover;
      const coverScore = cover <= 0 ? 0
        : cover < 30 ? clamp((cover / 30) * 80)
          : cover <= 60 ? 100
            : clamp(100 - ((cover - 60) / 60) * 70);
      const base = turns * 0.6 + coverScore * 0.4;
      // Stock-outs and dead stock are penalties, not components. A clean
      // position should not be able to inflate the score by scoring full marks
      // on the absence of a problem.
      const stockoutRate = inv.stockouts / inv.productCount;
      const deadShare = inv.valueAtCost ? inv.deadValue / inv.valueAtCost : 0;
      return round(
        base
        * (1 - clamp(stockoutRate * 2, 0, 0.5))
        * (1 - clamp(deadShare * 1.5, 0, 0.4))
      );
    },
    basis: 'Turnover and days of cover, marked down for stock-outs and dead stock',
  },
  {
    id: 'customers',
    label: 'Customers & Demand',
    question: 'Is demand healthy?',
    blurb: 'Whether demand is broadening or being bought. Optional — a project '
      + 'or high-ticket business has no meaningful repeat rate.',
    metrics: [
      { label: 'Order volume and growth', live: true },
      { label: 'Average order value', live: true },
      { label: 'Discount dependency', live: true },
      { label: 'New vs repeat customers', live: false },
      { label: 'CAC, LTV and retention', live: false },
    ],
    score: ({ model, prevModel }) => {
      if (!model) return 0;
      const orderGrowth = prevModel?.orders
        ? (model.orders - prevModel.orders) / prevModel.orders : 0;
      const aovGrowth = prevModel?.revenuePerOrder
        ? (model.revenuePerOrder - prevModel.revenuePerOrder) / prevModel.revenuePerOrder : 0;
      // Demand bought with discount is worth less than demand that holds price.
      const priceHold = inverse(model.discountPct, 28);
      return round(
        clamp(70 + orderGrowth * 180) * 0.45
        + clamp(72 + aovGrowth * 160) * 0.25
        + priceHold * 0.3
      );
    },
    basis: 'Order and basket growth, discounted for how much of it was bought with promotion',
    caveat: 'Repeat rate, CAC and LTV need a customer-identity source Ardent does not read yet.',
  },
  {
    id: 'channels',
    label: 'Channel Economics',
    question: 'Which channels are creating value?',
    blurb: 'How much of gross merchandise value survives each marketplace, and '
      + 'whether the mix is concentrated in one of them.',
    metrics: [
      { label: 'Sales by channel', live: true },
      { label: 'Realized sales after deductions', live: true },
      { label: 'Marketplace fees', live: true },
      { label: 'Contribution margin by channel', live: true },
      { label: 'Channel concentration', live: true },
    ],
    score: ({ channelModels }) => {
      if (!channelModels?.length) return 0;
      const total = channelModels.reduce((s, c) => s + c.netSales, 0) || 1;
      // Realised share: what actually lands after every marketplace deduction.
      // Keeping 82% of net sales is a strong marketplace position.
      const realized = channelModels.reduce((s, c) => s + (c.netSales - c.channelCost), 0) / total;
      const efficiency = clamp((realized / 0.82) * 100);
      // Above a third of sales through one channel is a dependency; two thirds
      // is a serious one, whatever the margin looks like today.
      const top = Math.max(...channelModels.map(c => c.netSales)) / total;
      const spread = inverse(Math.max(0, top - 0.35), 0.3);
      return round(efficiency * 0.65 + spread * 0.35);
    },
    basis: 'Share of sales surviving channel cost, marked down for dependence on one channel',
  },
  {
    id: 'products',
    label: 'Products & SKUs',
    question: 'Which products are winning or losing?',
    blurb: 'Whether the range is earning its place, or one product is carrying '
      + 'everything while the tail loses money.',
    metrics: [
      { label: 'Sales by product and SKU', live: true },
      { label: 'Margin by product', live: true },
      { label: 'Range concentration', live: true },
      { label: 'Loss-making products', live: true },
    ],
    score: ({ productModels }) => {
      if (!productModels?.length) return 0;
      const total = productModels.reduce((s, p) => s + p.netSales, 0) || 1;
      const top = Math.max(...productModels.map(p => p.netSales)) / total;
      const concentration = inverse(Math.max(0, top - 0.25), 0.45);
      const losers = productModels.filter(p => p.cm1 <= 0).length / productModels.length;
      const healthy = inverse(losers, 0.3);
      const spread = productModels.reduce((s, p) => s + p.cm1Pct, 0) / productModels.length;
      return round(concentration * 0.3 + healthy * 0.3 + clamp((spread / 32) * 86) * 0.4);
    },
    basis: 'Range concentration, the share of products below break-even, and average product margin',
  },
  {
    id: 'operations',
    label: 'Operations',
    question: 'Are we executing efficiently?',
    blurb: 'What the business loses between taking an order and keeping it.',
    metrics: [
      { label: 'Cancellation rate', live: true },
      { label: 'Return rate', live: true },
      { label: 'Return to origin rate', live: true },
      { label: 'Weeks out of stock', live: true },
      { label: 'Delivery performance', live: false },
    ],
    needsInventory: true,
    score: ({ model, inv }) => {
      if (!model) return 0;
      const returns = inverse(model.returnPct, 18);
      const cancels = inverse(model.cancelPct, 12);
      const rto = inverse(model.rtoPct, 55);
      const availability = inv?.productCount
        ? inverse(inv.stockouts / inv.productCount, 0.25) : 75;
      return round(returns * 0.35 + cancels * 0.25 + rto * 0.2 + availability * 0.2);
    },
    basis: 'Returns, cancellations and return-to-origin against tolerable ceilings',
    caveat: 'Delivery performance needs courier scan data, which is not connected yet.',
  },
  {
    id: 'workingCapital',
    label: 'Working Capital',
    question: 'Where is our money tied up?',
    blurb: 'How much of the business is locked in stock and unsettled receivables.',
    metrics: [
      { label: 'Receivables and overdues', live: true },
      { label: 'Payables', live: true },
      { label: 'Inventory value', live: true },
      { label: 'Cash conversion cycle', live: true },
    ],
    needsInventory: true,
    score: ({ fin, inv, period }) => {
      const overdueShare = fin.receivables ? fin.overdues / fin.receivables : 0;
      const collections = inverse(overdueShare, 0.5);
      // Cash conversion: days in stock plus days in receivables, less days of
      // supplier credit. Below about 45 days is a well-run consumer business.
      const days = Math.max(1, Math.round((period.end - period.start) / 86400000) + 1);
      const dailyCogs = fin.cogs / days;
      const dio = dailyCogs > 0 && inv ? inv.valueAtCost / dailyCogs : 0;
      const dailyRevenue = fin.net / days;
      const dso = dailyRevenue > 0 ? fin.receivables / dailyRevenue : 0;
      const dpo = dailyCogs > 0 ? fin.payables / dailyCogs : 0;
      const ccc = dio + dso - dpo;
      return round(collections * 0.45 + inverse(Math.max(0, ccc), 110) * 0.55);
    },
    basis: 'Overdue share of receivables, and the cash conversion cycle against a 110-day ceiling',
  },
];

export const DIMENSION_BY_ID = Object.fromEntries(DIMENSIONS.map(d => [d.id, d]));

/** How many indicators the Overview carries. Fixed — the card is built for it. */
export const HEALTH_SLOTS = 5;

/**
 * The default set. Deliberately excludes Customers & Demand: repeat rate is
 * meaningless for a good share of the businesses Ardent serves, and a default
 * that scores every company on it would be wrong more often than right.
 */
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
 * The inventory snapshot is a full catalogue scan, so it is only taken when a
 * selected dimension actually needs it.
 */
export function companyHealth({ scope, prevScope, period, companyId, config }) {
  const cfg = normaliseConfig(config);
  const selected = cfg.dimensions.map(id => DIMENSION_BY_ID[id]);

  const fin = financials(scope);
  const prevFin = financials(prevScope);
  const model = salesModel(scope);
  const prevModel = salesModel(prevScope);
  const target = targetFor(companyId, fin.net);

  const needsInventory = selected.some(d => d.needsInventory);
  const inv = needsInventory ? inventorySnapshot({ period, companyId }) : null;

  const needsChannels = selected.some(d => d.id === 'channels');
  const channelModels = needsChannels
    ? groupBy(scope, 'channel').map(c => salesModel({ ...scope, channel: c.key }))
    : null;

  const needsProducts = selected.some(d => d.id === 'products');
  const productModels = needsProducts
    ? groupBy(scope, 'product').map(p => salesModel({ ...scope, product: p.key }))
    : null;

  const ctx = { fin, prevFin, model, prevModel, target, inv, channelModels, productModels, period, scope };

  const scores = {};
  for (const d of selected) scores[d.id] = d.score(ctx);

  const totalWeight = cfg.dimensions.reduce((s, id) => s + (cfg.weights[id] ?? 0), 0) || 1;
  const overall = Math.round(
    cfg.dimensions.reduce((s, id) => s + scores[id] * (cfg.weights[id] ?? 0), 0) / totalWeight
  );

  return { overall, scores, config: cfg, dimensions: selected, context: ctx };
}

/**
 * The live figures behind one dimension, for the breakdown view. Values are
 * pre-formatted strings so the modal stays a presentation layer.
 */
export function dimensionDetail(id, ctx, fmt) {
  const { inr, num, pct } = fmt;
  const { fin, prevFin, model, prevModel, target, inv, channelModels, productModels, period } = ctx;
  const growth = prevFin?.net ? ((fin.net - prevFin.net) / prevFin.net) * 100 : 0;

  switch (id) {
    case 'sales':
      return [
        ['Gross sales', inr(model.grossSales)],
        ['Net sales', inr(model.netSales)],
        ['Growth vs previous', pct(growth)],
        ['Target attainment', target ? pct((fin.net / target) * 100) : '—'],
      ];
    case 'profitability':
      return [
        ['Contribution margin (CM1)', `${inr(fin.grossProfit)} · ${pct(fin.grossMarginPct)}`],
        ['EBITDA', `${inr(fin.ebitda)} · ${pct(fin.ebitdaPct)}`],
        ['Net profit', inr(fin.netProfit)],
        ['Net margin', pct(fin.netMarginPct)],
      ];
    case 'unitEconomics':
      return [
        ['Contribution per order', inr(model.contributionPerOrder)],
        ['COGS % of net sales', pct(model.cogsPct)],
        ['Channel cost per order', inr(model.channelCostPerOrder)],
        ['Average order value', inr(model.revenuePerOrder)],
      ];
    case 'cash':
      return [
        ['Cash position', inr(fin.cash)],
        ['Monthly burn', inr(fin.burnRate)],
        ['Runway', fin.runwayMonths ? `${fin.runwayMonths.toFixed(1)} months` : '—'],
      ];
    case 'inventory':
      return inv ? [
        ['Inventory at cost', inr(inv.valueAtCost)],
        ['Turnover', `${inv.turns.toFixed(1)}x`],
        ['Days of cover', `${Math.round(inv.daysOfCover)} days`],
        ['Products out of stock', `${inv.stockouts} of ${inv.productCount}`],
        ['Dead stock', inr(inv.deadValue)],
      ] : [];
    case 'customers':
      return [
        ['Orders', num(model.orders)],
        ['Order growth', prevModel?.orders ? pct(((model.orders - prevModel.orders) / prevModel.orders) * 100) : '—'],
        ['Average order value', inr(model.revenuePerOrder)],
        ['Discount dependency', pct(model.discountPct)],
        ['Repeat rate, CAC, LTV', 'not connected'],
      ];
    case 'channels': {
      if (!channelModels?.length) return [];
      const total = channelModels.reduce((s, c) => s + c.netSales, 0) || 1;
      const realized = channelModels.reduce((s, c) => s + (c.netSales - c.channelCost), 0);
      const top = channelModels.reduce((a, c) => (c.netSales > a.netSales ? c : a));
      return [
        ['Channels selling', String(channelModels.length)],
        ['Realized after channel cost', `${inr(realized)} · ${pct((realized / total) * 100)}`],
        ['Channel fees', inr(channelModels.reduce((s, c) => s + c.channelFees, 0))],
        ['Largest channel share', pct((top.netSales / total) * 100)],
      ];
    }
    case 'products': {
      if (!productModels?.length) return [];
      const total = productModels.reduce((s, p) => s + p.netSales, 0) || 1;
      const top = Math.max(...productModels.map(p => p.netSales));
      return [
        ['Products selling', String(productModels.length)],
        ['Largest product share', pct((top / total) * 100)],
        ['Below break-even', String(productModels.filter(p => p.cm1 <= 0).length)],
        ['Average product margin', pct(productModels.reduce((s, p) => s + p.cm1Pct, 0) / productModels.length)],
      ];
    }
    case 'operations':
      return [
        ['Cancellation rate', pct(model.cancelPct)],
        ['Return rate', pct(model.returnPct)],
        ['Return to origin', pct(model.rtoPct)],
        ['Weeks out of stock', inv ? String(inv.weeksStockedOut) : '—'],
        ['Delivery performance', 'not connected'],
      ];
    case 'workingCapital': {
      const days = Math.max(1, Math.round((period.end - period.start) / 86400000) + 1);
      const dailyCogs = fin.cogs / days;
      const dailyRevenue = fin.net / days;
      const dio = dailyCogs > 0 && inv ? inv.valueAtCost / dailyCogs : 0;
      const dso = dailyRevenue > 0 ? fin.receivables / dailyRevenue : 0;
      const dpo = dailyCogs > 0 ? fin.payables / dailyCogs : 0;
      return [
        ['Receivables', `${inr(fin.receivables)} · ${pct(fin.receivables ? (fin.overdues / fin.receivables) * 100 : 0)} overdue`],
        ['Payables', inr(fin.payables)],
        ['Inventory at cost', inv ? inr(inv.valueAtCost) : '—'],
        ['Days in stock / receivable / payable', `${Math.round(dio)} / ${Math.round(dso)} / ${Math.round(dpo)}`],
        ['Cash conversion cycle', `${Math.round(dio + dso - dpo)} days`],
      ];
    }
    default:
      return [];
  }
}
