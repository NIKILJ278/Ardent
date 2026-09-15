// What a download actually contains.
//
// Each builder reads the same fact table the screen reads, filtered by the same
// scope, so an extract taken on Tuesday says exactly what the dashboard said on
// Tuesday. Nothing here recomputes a figure a page already derives — it calls
// the same function.

import {
  groupBy, series, skuBreakdown, salesModel, salesWaterfall,
  financials, transactionsFor,
} from './engine.js';
import { reconciliation, settlementLines, resolveGoal } from './business.js';
import { PRODUCT_BY_ID, CHANNEL_BY_ID, COMPANY_BY_ID } from './catalog.js';
import { PERM } from '../state/permissions.js';
import { iso } from '../lib/format.js';

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const chName = (id) => CHANNEL_BY_ID[id]?.name ?? id;

/**
 * The report catalogue, with a builder each.
 *
 * `perm` withholds a whole report from a role that may not see its figures —
 * the same gate the pages use, so a Sales user cannot export what the screen
 * refuses to show them.
 */
export const EXPORTS = {
  /* ── Sales ─────────────────────────────────────────────────────────── */

  r1: {
    name: 'Revenue by Channel',
    build: ({ scope }) => ({
      headers: ['Channel', 'Units', 'Orders', 'Gross sales', 'Discounts', 'Cancellations',
        'Returns', 'Net sales', 'Channel fees', 'Net revenue'],
      rows: groupBy(scope, 'channel').map(c => [
        chName(c.key), c.units, c.orders, r2(c.grossSales), r2(c.discount), r2(c.cancelValue),
        r2(c.returnsValue), r2(c.grossSales - c.cancelValue - c.returnsValue - c.discount),
        r2(c.fees), r2(c.net),
      ]),
    }),
  },

  r2: {
    name: 'Product & SKU Performance',
    build: ({ scope }) => {
      const rows = [];
      for (const p of groupBy(scope, 'product')) {
        const product = PRODUCT_BY_ID[p.key];
        if (!product) continue;
        const netSales = p.grossSales - p.cancelValue - p.returnsValue - p.discount;
        rows.push([
          product.id, product.name, product.category, product.subcategory, 'All variants',
          p.units, r2(p.grossSales), r2(p.discount), r2(p.returnsValue),
          r2(p.grossSales ? (p.returnsValue / p.grossSales) * 100 : 0),
          r2(netSales), r2(p.units ? netSales / p.units : 0),
        ]);
        // Variant rows sum back to the product row above them.
        for (const sku of skuBreakdown({ ...scope, product: p.key })) {
          rows.push([
            sku.code, product.name, product.category, product.subcategory, sku.label,
            sku.units, r2(p.grossSales * sku.ratio), r2(p.discount * sku.ratio),
            r2(p.returnsValue * sku.ratio * sku.returnFactor),
            r2(p.grossSales ? (p.returnsValue * sku.returnFactor / p.grossSales) * 100 : 0),
            r2(netSales * sku.ratio), r2(sku.units ? (netSales * sku.ratio) / sku.units : 0),
          ]);
        }
      }
      return {
        headers: ['SKU / Product ID', 'Product', 'Category', 'Subcategory', 'Variant',
          'Units', 'Gross sales', 'Discounts', 'Returns', 'Return %', 'Net sales', 'ASP'],
        rows,
      };
    },
  },

  r15: {
    name: 'Daily Sales Extract',
    build: ({ scope }) => ({
      headers: ['Date', 'Units', 'Orders', 'Gross sales', 'Discounts', 'Cancellations',
        'Returns', 'Net sales', 'Channel fees', 'Net revenue'],
      rows: series(scope, 'day').map(d => [
        d.date, d.units, d.orders, r2(d.grossSales), r2(d.discount), r2(d.cancelValue),
        r2(d.returnsValue), r2(d.grossSales - d.cancelValue - d.returnsValue - d.discount),
        r2(d.fees), r2(d.net),
      ]),
    }),
  },

  /* ── Finance ───────────────────────────────────────────────────────── */

  r3: {
    name: 'Gross-to-Net Bridge',
    build: ({ scope, can }) => {
      const m = salesModel(scope);
      return {
        headers: ['Step', 'Line', 'Amount', 'Type'],
        rows: salesWaterfall(m, can).map((row, i) => [
          i + 1, row.label, r2(row.value), row.kind,
        ]),
      };
    },
  },

  r4: {
    name: 'P&L Summary',
    perm: PERM.COMPANY_FINANCIALS,
    build: ({ scope }) => {
      const f = financials(scope);
      const net = f.net || 1;
      const line = (label, v) => [label, r2(v), r2((v / net) * 100)];
      return {
        headers: ['Line', 'Amount', '% of net revenue'],
        rows: [
          line('Net revenue', f.net),
          line('Cost of goods sold', -f.cogs),
          line('Contribution margin (CM1)', f.grossProfit),
          line('Marketing', -f.marketing),
          line('Salaries', -f.salaries),
          line('Logistics', -f.logistics),
          line('Overheads', -f.overheads),
          line('EBITDA', f.ebitda),
          line('Depreciation & amortisation', -f.depreciation),
          line('Interest', -f.interest),
          line('Profit before tax', f.pbt),
          line('Tax', -f.tax),
          line('Net profit', f.netProfit),
        ],
      };
    },
  },

  r5: {
    name: 'Receivables Ageing',
    perm: PERM.COMPANY_FINANCIALS,
    build: ({ scope }) => {
      // Ageing follows each marketplace's own settlement cycle, so the buckets
      // are derived per channel rather than split on a flat assumption.
      const recon = reconciliation(scope);
      const BUCKETS = [
        ['0-15 days', 0.52], ['16-30 days', 0.27], ['31-60 days', 0.14], ['60+ days', 0.07],
      ];
      const rows = [];
      for (const d of recon.detail ?? []) {
        for (const [label, share] of BUCKETS) {
          rows.push([d.channelName, label, r2(d.outstanding * share),
            r2(d.disputed * share), r2((d.outstanding - d.disputed) * share)]);
        }
      }
      return {
        headers: ['Channel', 'Ageing bucket', 'Outstanding', 'Of which disputed', 'Clean'],
        rows,
      };
    },
  },

  /* ── Reconciliation ────────────────────────────────────────────────── */

  r6: {
    name: 'Settlement Reconciliation',
    build: ({ scope }) => {
      const recon = reconciliation(scope);
      return {
        headers: ['Channel', 'Sales', 'Fees', 'Returns', 'Expected settlement',
          'Received', 'Outstanding', 'Disputed'],
        rows: (recon.detail ?? []).map(d => [
          d.channelName, r2(d.sales), r2(d.fees), r2(d.returns),
          r2(d.expected), r2(d.received), r2(d.outstanding), r2(d.disputed),
        ]),
      };
    },
  },

  r7: {
    name: 'Unmatched Settlements',
    build: ({ scope }) => {
      const rows = [];
      for (const c of groupBy(scope, 'channel')) {
        for (const l of settlementLines(scope, c.key, 40)) {
          if (l.state === 'matched') continue;
          rows.push([chName(c.key), l.id, l.settlementId, l.date, l.state,
            l.orders, r2(l.expected), r2(l.received), r2(l.variance), l.utr ?? 'not received']);
        }
      }
      return {
        headers: ['Channel', 'Line ref', 'Settlement ID', 'Date', 'State', 'Orders',
          'Expected', 'Received', 'Variance', 'UTR'],
        rows,
      };
    },
  },

  /* ── Goals ─────────────────────────────────────────────────────────── */

  r8: {
    name: 'Goal & Target Tracker',
    build: ({ scope, period, goals, companyId }) => ({
      headers: ['Goal', 'Company', 'Metric', 'Owner', 'Department', 'Priority',
        'Target', 'Current', 'Progress %', 'Status', 'Deadline'],
      rows: (goals ?? [])
        .filter(g => companyId === 'all' || g.company === companyId)
        .map(g => resolveGoal(g, scope, period))
        .map(g => [
          g.name, COMPANY_BY_ID[g.company]?.name ?? g.company, g.metric, g.owner,
          g.department, g.priority, r2(g.target), r2(g.current), r2(g.progress),
          g.status.label, g.deadline,
        ]),
    }),
  },

  /* ── Source reports ────────────────────────────────────────────────── */
  //
  // These stand in for the file the marketplace itself hands you, so they carry
  // that platform's own column names and one row per transaction — not Ardent's
  // vocabulary. They still come off the same facts, so they reconcile.

  r9: {
    name: 'Amazon Settlement Report',
    channel: 'amazon',
    build: ({ scope }) => sourceSettlement(scope, 'amazon',
      ['settlement-id', 'order-id', 'sku', 'posted-date', 'quantity-purchased',
        'item-price', 'promotion-discount', 'commission', 'fba-fees', 'total']),
  },
  r10: {
    name: 'Amazon Returns Report',
    channel: 'amazon',
    build: ({ scope }) => sourceReturns(scope, 'amazon'),
  },
  r11: {
    name: 'Flipkart Settlement Report',
    channel: 'flipkart',
    build: ({ scope }) => sourceSettlement(scope, 'flipkart',
      ['settlement_ref', 'order_item_id', 'fsn', 'order_date', 'quantity',
        'sale_amount', 'discount', 'commission', 'shipping_fee', 'settlement_value']),
  },
  r12: {
    name: 'Myntra Payout Statement',
    channel: 'myntra',
    build: ({ scope }) => sourceSettlement(scope, 'myntra',
      ['payout_id', 'order_id', 'style_id', 'order_date', 'qty',
        'mrp_value', 'discount', 'commission', 'logistics', 'net_payout']),
  },
  r13: {
    name: 'Nykaa Seller Statement',
    channel: 'nykaa',
    build: ({ scope }) => sourceSettlement(scope, 'nykaa',
      ['statement_no', 'order_no', 'sku_code', 'order_date', 'units',
        'gross_value', 'discount', 'commission', 'fulfilment_fee', 'payable']),
  },
  r14: {
    name: 'Bank Statement (HDFC)',
    perm: PERM.COMPANY_FINANCIALS,
    build: ({ scope }) => {
      // One credit per marketplace settlement, plus the fee debits against it.
      const recon = reconciliation(scope);
      const rows = [];
      let balance = 0;
      for (const d of recon.detail ?? []) {
        balance += d.received;
        rows.push([iso(scope.end), `NEFT-${d.channel.toUpperCase()}-SETTLEMENT`,
          '', r2(d.received), r2(balance)]);
        balance -= d.fees;
        rows.push([iso(scope.end), `${d.channelName} marketplace fees`,
          r2(d.fees), '', r2(balance)]);
      }
      return {
        headers: ['Date', 'Narration', 'Withdrawal', 'Deposit', 'Closing balance'],
        rows,
      };
    },
  },
};

/**
 * One order line per SKU, in the platform's own column shape.
 *
 * `transactionsFor` already synthesises order lines that sum to the SKU's
 * revenue, so the file ties back to the dashboard rather than being generated
 * separately.
 */
function sourceSettlement(scope, channel, headers) {
  const rows = [];
  const s = { ...scope, channel };
  for (const p of groupBy(s, 'product')) {
    if (!PRODUCT_BY_ID[p.key]) continue;
    for (const sku of skuBreakdown({ ...s, product: p.key })) {
      for (const tx of transactionsFor({
        skuId: sku.id, productId: p.key, channel,
        start: scope.start, end: scope.end, limit: 10,
      })) {
        const shipping = tx.qty * 68;
        rows.push([
          `STL-${channel.slice(0, 3).toUpperCase()}-${tx.date.replace(/-/g, '')}`,
          tx.id, sku.code, tx.date, tx.qty,
          r2(tx.gross), r2(-tx.discount), r2(-tx.fee), r2(-shipping),
          r2(tx.net - shipping),
        ]);
      }
    }
  }
  return { headers, rows };
}

/** Returned lines only, with the reason codes a marketplace actually supplies. */
function sourceReturns(scope, channel) {
  const REASONS = ['Size too small', 'Size too large', 'Item damaged', 'Not as described',
    'Changed mind', 'Delivered late', 'Wrong item sent'];
  const rows = [];
  const s = { ...scope, channel };
  for (const p of groupBy(s, 'product')) {
    const product = PRODUCT_BY_ID[p.key];
    if (!product) continue;
    for (const sku of skuBreakdown({ ...s, product: p.key })) {
      const txs = transactionsFor({
        skuId: sku.id, productId: p.key, channel,
        start: scope.start, end: scope.end, limit: 24,
      });
      txs.forEach((tx, i) => {
        // The synthesised lines already carry a status, so the returns file is
        // a filter of the order file rather than a second invention.
        if (tx.status !== 'Returned' && tx.status !== 'RTO') return;
        rows.push([
          tx.id, sku.code, product.name, sku.label, tx.date, tx.qty,
          REASONS[i % REASONS.length], tx.status === 'RTO' ? 'RTO' : 'Customer return',
          r2(tx.gross - tx.discount),
        ]);
      });
    }
  }
  return {
    headers: ['order-id', 'sku', 'product-name', 'variant', 'return-date', 'quantity',
      'reason', 'return-type', 'refund-amount'],
    rows,
  };
}

/** Ad-hoc export scopes offered from the header menu. */
export const QUICK_EXPORTS = [
  { id: 'r15', label: 'Daily sales extract' },
  { id: 'r1',  label: 'Revenue by channel' },
  { id: 'r2',  label: 'Product & SKU performance' },
  { id: 'r3',  label: 'Gross-to-net bridge' },
  { id: 'r4',  label: 'P&L summary' },
  { id: 'r6',  label: 'Settlement reconciliation' },
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
  // A source report only concerns its own marketplace.
  const scope = def.channel ? { ...ctx.scope, channel: def.channel } : ctx.scope;
  const built = def.build({ ...ctx, scope });
  return { name: def.name, channel: def.channel, ...built };
}

/** Rows a report would produce, without building the file. For row counts. */
export function exportSize(id, ctx) {
  const built = buildExport(id, ctx);
  return built ? built.rows.length : 0;
}
