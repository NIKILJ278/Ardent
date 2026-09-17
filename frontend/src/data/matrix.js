// Attribute × period matrix.
//
// A curtain seller thinks in lengths — 5ft, 6ft, 7ft, 8ft — and wants those
// down the side with months across the top, then returns underneath. That
// reads far better than one bar per attribute for a single period, because the
// eye compares along a row instead of holding numbers in memory.
//
// The row dimension is whatever sits one level below the current selection, so
// the same view works at category, subcategory, product and variant level.

import { series, groupBy } from './engine.js';
import { PRODUCT_BY_ID, variantById } from './catalog.js';
import { fmtDate } from '../lib/format.js';

/** Net sales for a bucket — the same definition used everywhere else. */
const netSalesOf = (b) => b.grossSales - b.cancelValue - b.returnsValue - b.discount;

/** Which attribute naturally sits one level below the current selection. */
export function matrixDimension(scope) {
  if (scope.product) return { dim: 'variant', label: 'Variant' };
  if (scope.subcategory) return { dim: 'product', label: 'Product' };
  if (scope.category) return { dim: 'subcategory', label: 'Subcategory' };
  return { dim: 'category', label: 'Category' };
}

const colLabel = (ts, grain) =>
  grain === 'month' ? fmtDate(ts, 'month') : grain === 'week' ? `w/c ${fmtDate(ts)}` : fmtDate(ts);

function rowLabel(dim, key) {
  if (dim === 'product') return PRODUCT_BY_ID[key]?.name ?? key;
  if (dim === 'variant') return variantById(key)?.title ?? 'Default';
  return key;
}

/**
 * Build the matrix. Every row dimension — variants included — is a genuine
 * group-by over real orders, so each size shows its own sales and returns and
 * the rows always sum to the column totals.
 */
export function attributeMatrix({ scope, grain = 'month' }) {
  const { dim, label } = matrixDimension(scope);

  const buckets = series(scope, grain);
  const columns = buckets.map(b => ({ key: b.date, ts: b.ts, label: colLabel(b.ts, grain) }));

  const rows = groupBy(scope, dim).map(g => {
    const byDate = new Map(series({ ...scope, [dim]: g.key }, grain).map(b => [b.date, b]));
    return {
      key: g.key,
      label: rowLabel(dim, g.key),
      code: dim === 'variant' ? variantById(g.key)?.sku ?? null : null,
      cells: buckets.map(b => {
        const m = byDate.get(b.date);
        return {
          value: m ? netSalesOf(m) : 0,
          units: m ? m.units : 0,
          returns: m ? m.returnsValue : 0,
          gross: m ? m.grossSales : 0,
        };
      }),
    };
  });

  for (const r of rows) {
    r.total = r.cells.reduce((s, c) => s + c.value, 0);
    r.totalUnits = r.cells.reduce((s, c) => s + c.units, 0);
    r.totalReturns = r.cells.reduce((s, c) => s + c.returns, 0);
    r.totalGross = r.cells.reduce((s, c) => s + c.gross, 0);
    r.returnPct = r.totalGross > 0 ? (r.totalReturns / r.totalGross) * 100 : 0;
    const first = r.cells[0]?.value ?? 0;
    const last = r.cells[r.cells.length - 1]?.value ?? 0;
    r.trend = first > 0 ? ((last - first) / first) * 100 : null;
  }
  rows.sort((a, b) => b.total - a.total);

  const totals = buckets.map((b, i) => ({
    key: b.date,
    value: rows.reduce((s, r) => s + r.cells[i].value, 0),
    units: rows.reduce((s, r) => s + r.cells[i].units, 0),
  }));
  const returns = buckets.map((b, i) => {
    const value = rows.reduce((s, r) => s + r.cells[i].returns, 0);
    const gross = rows.reduce((s, r) => s + r.cells[i].gross, 0);
    return { key: b.date, value, gross, pct: gross > 0 ? (value / gross) * 100 : 0 };
  });

  const grandGross = returns.reduce((s, c) => s + c.gross, 0);
  const grandReturns = returns.reduce((s, c) => s + c.value, 0);

  return {
    dim, label, columns, rows, totals, returns,
    grand: {
      value: totals.reduce((s, c) => s + c.value, 0),
      units: totals.reduce((s, c) => s + c.units, 0),
      returns: grandReturns,
      returnPct: grandGross > 0 ? (grandReturns / grandGross) * 100 : 0,
    },
  };
}
