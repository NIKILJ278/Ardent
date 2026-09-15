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
import { PRODUCT_BY_ID, skusForProduct } from './catalog.js';
import { fmtDate } from '../lib/format.js';

/** Net sales for a bucket — the same definition used everywhere else. */
const netSalesOf = (b) => b.grossSales - b.cancelValue - b.returnsValue - b.discount;

/** Which attribute naturally sits one level below the current selection. */
export function matrixDimension(scope) {
  if (scope.product) return { dim: 'variant', label: 'Variant' };
  if (scope.subcategory) return { dim: 'product', label: 'Product' };
  if (scope.category) return { dim: 'subcategory', label: 'Subcategory' };
  if (scope.channel) return { dim: 'category', label: 'Category' };
  return { dim: 'category', label: 'Category' };
}

const colLabel = (ts, grain) =>
  grain === 'month' ? fmtDate(ts, 'month') : grain === 'week' ? `w/c ${fmtDate(ts)}` : fmtDate(ts);

/**
 * Build the matrix.
 *
 * Variant rows are split from their product on the fixed ratios used across the
 * app, so a variant column always sums back to the product's own figure for
 * that period. Every other row dimension is a genuine group-by.
 */
export function attributeMatrix({ scope, grain = 'month' }) {
  const { dim, label } = matrixDimension(scope);

  // Columns are the periods.
  const buckets = series(scope, grain);
  const columns = buckets.map(b => ({ key: b.date, ts: b.ts, label: colLabel(b.ts, grain) }));

  let rows;
  if (dim === 'variant') {
    const product = PRODUCT_BY_ID[scope.product];
    if (!product) return { dim, label, columns: [], rows: [], totals: [], returns: [], grand: null };
    // Returns are distributed by the variant's own propensity, not evenly —
    // an edge size is sent back far more often than the middle of the range.
    // The factors are normalised, so the product's total return value is
    // unchanged; only its split across variants moves.
    rows = skusForProduct(product).map(v => ({
      key: v.id,
      label: v.label,
      code: v.code,
      cells: buckets.map(b => ({
        value: netSalesOf(b) * v.ratio,
        units: Math.round(b.units * v.ratio),
        returns: b.returnsValue * v.ratio * v.returnFactor,
        gross: b.grossSales * v.ratio,
      })),
    }));
  } else {
    // One series per group keeps each row on the same bucket grid.
    const groups = groupBy(scope, dim);
    rows = groups.map(g => {
      const gBuckets = series({ ...scope, [dim]: g.key }, grain);
      const byDate = new Map(gBuckets.map(b => [b.date, b]));
      return {
        key: g.key,
        label: dim === 'product' ? (PRODUCT_BY_ID[g.key]?.name ?? g.key) : g.key,
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
  }

  // Row totals across the period.
  for (const r of rows) {
    r.total = r.cells.reduce((s, c) => s + c.value, 0);
    r.totalUnits = r.cells.reduce((s, c) => s + c.units, 0);
    r.totalReturns = r.cells.reduce((s, c) => s + c.returns, 0);
    r.totalGross = r.cells.reduce((s, c) => s + c.gross, 0);
    r.returnPct = r.totalGross > 0 ? (r.totalReturns / r.totalGross) * 100 : 0;
    // Direction of travel across the row, first bucket to last.
    const first = r.cells[0]?.value ?? 0;
    const last = r.cells[r.cells.length - 1]?.value ?? 0;
    r.trend = first > 0 ? ((last - first) / first) * 100 : null;
  }
  rows.sort((a, b) => b.total - a.total);

  // Column totals, and the returns block that sits beneath them.
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
