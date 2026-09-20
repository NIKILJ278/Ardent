// What a download actually contains.
//
// Each builder reads the same fact table the screen reads, filtered by the same
// scope, so an extract says exactly what the dashboard said. Only reports that
// synced order data can fill are offered. A column whose figure is not recorded
// — cost of goods on an uncosted product — is left blank, never written as zero.

import { groupBy, series, salesModel, salesWaterfall } from './engine.js';
import { resolveGoal, GOAL_METRICS } from './business.js';
import { PRODUCT_BY_ID, CHANNEL_BY_ID, variantById } from './catalog.js';
import { currencyCode } from '../lib/format.js';

/** A money column names its currency: a bare "Net sales" is ambiguous in a
 *  file that has left the dashboard behind. */
const cur = (label) => `${label} (${currencyCode()})`;

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const chName = (id) => CHANNEL_BY_ID[id]?.name ?? id;
const netOf = (t) => t.grossSales - t.cancelValue - t.returnsValue - t.discount;
const returnPct = (t) => r2(t.grossSales ? (t.returnsValue / t.grossSales) * 100 : 0);
/** Cost of goods only when every unit in the row was costed. */
const cogsCell = (t) => (t.costGaps === 0 && t.units > 0 ? r2(t.cogs) : '');

export const EXPORTS = {
  r1: {
    name: 'Revenue by Channel',
    build: ({ scope }) => ({
      headers: ['Channel', 'Units', 'Orders', cur('Gross sales'), cur('Discounts'),
        cur('Cancellations'), cur('Returns'), cur('Net sales')],
      rows: groupBy(scope, 'channel').map(c => [
        chName(c.key), c.units, c.orders, r2(c.grossSales), r2(c.discount),
        r2(c.cancelValue), r2(c.returnsValue), r2(netOf(c)),
      ]),
    }),
  },

  r2: {
    name: 'Product & SKU Performance',
    build: ({ scope }) => {
      const rows = [];
      for (const p of groupBy(scope, 'product')) {
        const product = PRODUCT_BY_ID[p.key];
        const base = [product?.name ?? p.key, product?.category ?? '', product?.subcategory ?? ''];
        const line = (id, variant, t) => {
          const net = netOf(t);
          return [id, ...base, variant, t.units, r2(t.grossSales), r2(t.discount), r2(t.returnsValue),
            returnPct(t), r2(net), r2(t.units ? net / t.units : 0), cogsCell(t)];
        };
        rows.push(line(p.key, 'All variants', p));
        // Each variant from its own orders, so the lines sum back to the product.
        for (const v of groupBy({ ...scope, product: p.key }, 'variant')) {
          const meta = variantById(v.key);
          rows.push(line(meta?.sku || v.key, meta?.title ?? 'Default', v));
        }
      }
      return {
        headers: ['SKU / Product ID', 'Product', 'Category', 'Subcategory', 'Variant', 'Units',
          cur('Gross sales'), cur('Discounts'), cur('Returns'), 'Return %', cur('Net sales'),
          cur('ASP'), cur('Cost of goods')],
        rows,
      };
    },
  },

  r15: {
    name: 'Daily Sales Extract',
    build: ({ scope }) => ({
      headers: ['Date', 'Units', 'Orders', cur('Gross sales'), cur('Discounts'),
        cur('Cancellations'), cur('Returns'), cur('Net sales')],
      rows: series(scope, 'day').map(d => [
        d.date, d.units, d.orders, r2(d.grossSales), r2(d.discount),
        r2(d.cancelValue), r2(d.returnsValue), r2(netOf(d)),
      ]),
    }),
  },

  r3: {
    name: 'Gross-to-Net Bridge',
    build: ({ scope, can }) => {
      const steps = salesWaterfall(salesModel(scope), can);
      return {
        headers: ['Step', 'Line', cur('Amount'), 'Type'],
        rows: [
          ...steps.map((row, i) => [i + 1, row.label, r2(row.value), row.kind]),
          // Named in the file too, so the bridge is never read as complete.
          ...steps.missing.map(label => ['', label, '', 'not connected']),
        ],
      };
    },
  },

  r8: {
    name: 'Goal & Target Tracker',
    build: ({ scope, period, goals, companyId }) => ({
      headers: ['Goal', 'Metric', 'Owner', 'Department', 'Priority', 'Target', 'Current', 'Progress %', 'Status', 'Deadline'],
      rows: (goals ?? [])
        .filter(g => companyId === 'all' || g.company === companyId)
        .map(g => resolveGoal(g, scope, period))
        .map(g => [
          g.name, GOAL_METRICS[g.metric]?.label ?? g.metric, g.owner ?? '', g.department ?? '',
          g.priority ?? '', g.target ?? '', g.current == null ? '' : r2(g.current),
          g.current == null || g.target == null ? '' : r2(g.progress), g.status.label, g.deadline ?? '',
        ]),
    }),
  },
};

/** Ad-hoc export scopes offered from the header menu. */
export const QUICK_EXPORTS = [
  { id: 'r15', label: 'Daily sales extract' },
  { id: 'r1',  label: 'Revenue by channel' },
  { id: 'r2',  label: 'Product & SKU performance' },
  { id: 'r3',  label: 'Gross-to-net bridge' },
  { id: 'r8',  label: 'Goals & targets' },
];

/** Can this role download this report? */
export function canExport(id, can) {
  const def = EXPORTS[id];
  return !!def && (!def.perm || can(def.perm));
}

/** Build one report, or null if the role may not have it. */
export function buildExport(id, ctx) {
  const def = EXPORTS[id];
  if (!def) return null;
  if (def.perm && ctx.can && !ctx.can(def.perm)) return null;
  return { name: def.name, ...def.build(ctx) };
}
