// Weekly stock position, simulated forward from actual demand.
//
// Stock is not invented per week — it is the running balance of a real
// replenishment cycle:
//
//   closing = opening + receipts + restocked returns − units sold
//
// The simulation starts well before the reporting window so the opening
// position at the start of the period is itself derived, not assumed. Because
// it is driven by the same units the sales figures come from, a week where
// cover runs thin lines up with the week sales actually dipped — which is what
// makes "why did this fall?" answerable.

import { series, bucketStart, query, unitCost } from './engine.js';
import { isDigital, PRODUCT_BY_ID, skusForProduct } from './catalog.js';
import { rngFor } from '../lib/prng.js';

/** Weeks of history simulated before the window, to settle the opening stock. */
const WARMUP_WEEKS = 26;

/** Share of returned units that comes back in sellable condition. */
const RESTOCK_RATE = 0.62;

export const STOCK_STATES = {
  healthy:  { label: 'Healthy',   tone: 'good' },
  low:      { label: 'Low cover', tone: 'warning' },
  critical: { label: 'Critical',  tone: 'critical' },
  stockout: { label: 'Stocked out', tone: 'critical' },
};

/**
 * Replenishment parameters, stable per product.
 *
 * The reorder point must cover demand across the whole lead time plus a safety
 * buffer. Setting it below the lead time guarantees a stockout on every cycle —
 * the order simply cannot arrive before the shelf empties.
 */
function planFor(productId) {
  const rnd = rngFor(`inv|${productId}`);
  const leadTimeWeeks = 2 + Math.round(rnd() * 2);        // 2–4 weeks to arrive
  const safetyWeeks = 1 + Math.round(rnd() * 2);          // 1–3 weeks of buffer
  const reorderCoverWeeks = leadTimeWeeks + safetyWeeks;  // 3–7 weeks
  return {
    leadTimeWeeks, safetyWeeks, reorderCoverWeeks,
    // Order up to a level that leaves a sensible run before the next order.
    targetCoverWeeks: reorderCoverWeeks + 4 + Math.round(rnd() * 4),
  };
}

/**
 * Weekly sales and stock for one product.
 *
 * Sales metrics honour the channel filter. Stock deliberately does NOT — one
 * warehouse serves every channel, so "stock in hand on Amazon" is not a real
 * quantity. The caller is told which is which via `stockIsCompanyWide`.
 */
export function productWeekly({ period, companyId, productId, channel }) {
  const product = PRODUCT_BY_ID[productId];
  if (!product) return { weeks: [], plan: null, product: null };

  const warmStart = new Date(period.start);
  warmStart.setDate(warmStart.getDate() - WARMUP_WEEKS * 7);

  // Demand that drives stock is always every channel, and runs on unbroken
  // weeks so the balance carries correctly across the window boundary.
  const demandRows = series(
    { start: warmStart, end: period.end, company: companyId, product: productId },
    'week'
  );

  // Reported sales are queried against the period itself, so a week that
  // straddles the start is clipped to it. Without this the first bucket would
  // include days before the period and the weekly rows would over-count.
  const viewRows = series(
    { start: period.start, end: period.end, company: companyId, product: productId, channel },
    'week'
  );
  const viewByWeek = new Map(viewRows.map(r => [r.date, r]));

  const periodStartTs = period.start.getTime();
  const periodEndTs = period.end.getTime();

  const plan = planFor(productId);
  const avgWeekly = demandRows.length
    ? demandRows.reduce((s, r) => s + r.units, 0) / demandRows.length
    : 0;
  const targetStock = Math.round(avgWeekly * plan.targetCoverWeeks);
  const reorderPoint = Math.round(avgWeekly * plan.reorderCoverWeeks);

  let stock = targetStock;
  const inbound = new Map();          // week index → qty arriving
  const out = [];
  const periodStartBucket = bucketStart(period.start.getTime(), 'week');

  demandRows.forEach((row, i) => {
    const arriving = inbound.get(i) ?? 0;
    stock += arriving;

    const returnUnits = row.gross > 0
      ? Math.round(row.units * (row.returnsValue / row.gross) * RESTOCK_RATE)
      : 0;
    stock += returnUnits;

    // Demand that could not be served is a real stockout, recorded rather than
    // hidden by letting the balance go negative.
    const shortfall = Math.max(0, row.units - stock);
    const sold = row.units - shortfall;
    stock = Math.max(0, stock - sold);

    // Replenish on the reorder point, counting stock already on the water.
    const onOrder = [...inbound.entries()]
      .filter(([wk]) => wk > i).reduce((s, [, q]) => s + q, 0);
    if (stock + onOrder <= reorderPoint) {
      const qty = Math.max(0, targetStock - stock - onOrder);
      if (qty > 0) inbound.set(i + plan.leadTimeWeeks, (inbound.get(i + plan.leadTimeWeeks) ?? 0) + qty);
    }

    // Only weeks inside the reporting window are reported.
    if (row.date < periodStartBucket) return;

    const view = viewByWeek.get(row.date);
    const units = view?.units ?? 0;
    const netSales = view ? view.grossSales - view.cancelValue - view.returnsValue - view.discount : 0;
    const grossV = view?.gross ?? 0;
    const returnPct = grossV > 0 ? ((view.returnsValue / grossV) * 100) : 0;
    const cover = avgWeekly > 0 ? stock / avgWeekly : 0;

    // A week only partly inside the window shows less trade than a full one.
    const weekEndTs = row.ts + 6 * 86400000;
    const partial = row.ts < periodStartTs || weekEndTs > periodEndTs;

    out.push({
      id: row.date,
      week: row.date,
      ts: row.ts,
      partial,
      units,
      netSales,
      asp: units > 0 ? netSales / units : 0,
      returnPct,
      closingStock: stock,
      received: arriving,
      restocked: returnUnits,
      coverWeeks: cover,
      shortfall,
      state: stock === 0 ? 'stockout'
        : cover < 1.5 ? 'critical'
        : cover < plan.reorderCoverWeeks ? 'low'
        : 'healthy',
    });
  });

  return {
    product, plan, weeks: out,
    avgWeeklyDemand: avgWeekly,
    targetStock, reorderPoint,
    stockIsCompanyWide: !!channel,
    closingStock: out.length ? out[out.length - 1].closingStock : 0,
    weeksStockedOut: out.filter(w => w.state === 'stockout').length,
    lostUnits: out.reduce((s, w) => s + w.shortfall, 0),
  };
}

/* ── Catalogue-wide position ─────────────────────────────────────────────── */

export const MOVEMENT = {
  fast:   { label: 'Fast moving', tone: 'good' },
  steady: { label: 'Steady',      tone: 'info' },
  slow:   { label: 'Slow moving', tone: 'warning' },
  dead:   { label: 'Dead stock',  tone: 'critical' },
};

/** Cover beyond this is capital sitting still rather than a healthy buffer. */
const OVERSTOCK_WEEKS = 16;

/**
 * Stock position for every SKU in the catalogue.
 *
 * Demand is aggregated in ONE pass over the fact table and bucketed by
 * (product × week) rather than re-querying per product — across ~70 SKUs that
 * is the difference between one scan and a hundred and forty.
 *
 * Stock is simulated at product level, because that is where replenishment
 * happens, then split across SKUs on the same fixed variant ratios used
 * everywhere else, so SKU stock always sums back to its product.
 */
export function inventorySnapshot({ period, companyId }) {
  const warmStart = new Date(period.start);
  warmStart.setDate(warmStart.getDate() - WARMUP_WEEKS * 7);

  const rows = query({ start: warmStart, end: period.end, company: companyId });
  const byProduct = new Map();
  // Sold-in-period is accumulated from the rows themselves, not from week
  // buckets: a week straddling the period start would otherwise be counted in
  // full and overstate both demand and cost of sales.
  const soldInPeriod = new Map();
  const periodStartTs = period.start.getTime();

  for (const r of rows) {
    let p = byProduct.get(r.product);
    if (!p) { p = new Map(); byProduct.set(r.product, p); }
    const wk = bucketStart(r.ts, 'week');
    let w = p.get(wk);
    if (!w) { w = { week: wk, ts: new Date(`${wk}T00:00:00`).getTime(), units: 0, gross: 0, returnsValue: 0 }; p.set(wk, w); }
    w.units += r.units; w.gross += r.gross; w.returnsValue += r.returnsValue;

    if (r.ts >= periodStartTs) soldInPeriod.set(r.product, (soldInPeriod.get(r.product) ?? 0) + r.units);
  }

  const periodStartBucket = bucketStart(period.start.getTime(), 'week');
  const skuRows = [];
  const productRows = [];

  for (const [productId, weekMap] of byProduct) {
    const product = PRODUCT_BY_ID[productId];
    if (!product) continue;
    // A course has no stock to count, no cover to run out of and no reorder
    // point. Including one would make turnover and days-of-cover meaningless.
    if (isDigital(product)) continue;

    const weeks = [...weekMap.values()].sort((a, b) => a.ts - b.ts);
    const plan = planFor(productId);
    const avgWeekly = weeks.reduce((s, w) => s + w.units, 0) / Math.max(1, weeks.length);
    const targetStock = Math.round(avgWeekly * plan.targetCoverWeeks);
    const reorderPoint = Math.round(avgWeekly * plan.reorderCoverWeeks);

    let stock = targetStock;
    const inbound = new Map();
    const periodUnits = soldInPeriod.get(productId) ?? 0;
    let weeksInPeriod = 0, stockoutWeeks = 0;
    let lastReceipt = null;

    weeks.forEach((w, i) => {
      const arriving = inbound.get(i) ?? 0;
      stock += arriving;
      if (arriving > 0) lastReceipt = w.week;

      const restocked = w.gross > 0 ? Math.round(w.units * (w.returnsValue / w.gross) * RESTOCK_RATE) : 0;
      stock += restocked;
      const shortfall = Math.max(0, w.units - stock);
      stock = Math.max(0, stock - (w.units - shortfall));

      const onOrder = [...inbound.entries()].filter(([k]) => k > i).reduce((s, [, q]) => s + q, 0);
      if (stock + onOrder <= reorderPoint) {
        const qty = Math.max(0, targetStock - stock - onOrder);
        if (qty > 0) inbound.set(i + plan.leadTimeWeeks, (inbound.get(i + plan.leadTimeWeeks) ?? 0) + qty);
      }

      if (w.week >= periodStartBucket) {
        weeksInPeriod += 1;
        if (stock === 0) stockoutWeeks += 1;
      }
    });

    const lastIndex = weeks.length - 1;
    const pending = [...inbound.entries()].filter(([k]) => k > lastIndex);
    const onOrder = pending.reduce((s, [, q]) => s + q, 0);
    const nextArrival = pending.sort((a, b) => a[0] - b[0])[0];

    const weeklyDemand = weeksInPeriod ? periodUnits / weeksInPeriod : 0;
    const cover = weeklyDemand > 0 ? stock / weeklyDemand : (stock > 0 ? Infinity : 0);
    const cost = unitCost(product);

    const movement =
      periodUnits === 0 ? 'dead'
      : cover > OVERSTOCK_WEEKS ? 'slow'
      : weeklyDemand >= avgWeekly * 1.1 ? 'fast'
      : 'steady';

    const state =
      stock === 0 ? 'stockout'
      : cover < 1.5 ? 'critical'
      : cover < plan.reorderCoverWeeks ? 'low'
      : 'healthy';

    const pRow = {
      id: productId, productId, product, plan,
      productName: product.name,
      category: product.category, subcategory: product.subcategory ?? product.category,
      onHand: stock, onOrder,
      nextArrivalWeeks: nextArrival ? nextArrival[0] - lastIndex : null,
      lastReceipt,
      weeklyDemand, coverWeeks: cover,
      targetStock, reorderPoint,
      unitsSold: periodUnits, stockoutWeeks,
      valueAtCost: stock * cost,
      valueAtRetail: stock * product.price,
      cogsInPeriod: periodUnits * cost,
      unitCost: cost,
      state, movement,
      // A true gap: nothing on hand or in transit covers the reorder point.
      needsReorder: stock + onOrder <= reorderPoint,
      reorderQty: Math.max(0, targetStock - stock - onOrder),
    };

    // The exception a buyer actually acts on is not "should I order" — the
    // system already ordered. It is "will the order land before I run out?".
    // Cover shorter than the wait means a stockout is already baked in, and
    // the fix is to expedite rather than to re-order.
    pRow.weeksToArrival = pRow.nextArrivalWeeks;
    pRow.willStockOut = pRow.weeksToArrival != null && cover < pRow.weeksToArrival;
    pRow.projectedShortfall = pRow.willStockOut
      ? Math.round((pRow.weeksToArrival - cover) * weeklyDemand)
      : 0;
    pRow.actionNeeded = pRow.needsReorder || pRow.willStockOut || state === 'stockout';

    productRows.push(pRow);

    for (const v of skusForProduct(product)) {
      const skuStock = Math.round(stock * v.ratio);
      skuRows.push({
        id: v.id, code: v.code, variant: v.label, ratio: v.ratio,
        productId, productName: product.name,
        company: product.company,
        category: product.category, subcategory: product.subcategory ?? product.category,
        onHand: skuStock,
        onOrder: Math.round(onOrder * v.ratio),
        unitsSold: Math.round(periodUnits * v.ratio),
        weeklyDemand: weeklyDemand * v.ratio,
        coverWeeks: cover,
        valueAtCost: skuStock * cost,
        valueAtRetail: skuStock * product.price,
        unitCost: cost, price: product.price,
        state, movement,
        needsReorder: pRow.needsReorder,
        nextArrivalWeeks: pRow.nextArrivalWeeks,
      });
    }
  }

  const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0);
  const totalCogs = sum(productRows, 'cogsInPeriod');
  const stockValue = sum(productRows, 'valueAtCost');
  const daysSpan = Math.max(1, Math.round((period.end - period.start) / 86400000) + 1);
  // Annualised: how many times the stock investment sells through in a year.
  const turns = stockValue > 0 ? (totalCogs * (365 / daysSpan)) / stockValue : 0;
  const daysOfCover = totalCogs > 0 ? stockValue / (totalCogs / daysSpan) : 0;

  return {
    skus: skuRows.sort((a, b) => b.valueAtCost - a.valueAtCost),
    products: productRows.sort((a, b) => b.valueAtCost - a.valueAtCost),
    // Everything a buyer needs to act on, worst cover first.
    actions: productRows.filter(p => p.actionNeeded)
      .sort((a, b) => a.coverWeeks - b.coverWeeks),
    reorders: productRows.filter(p => p.needsReorder && p.reorderQty > 0)
      .sort((a, b) => a.coverWeeks - b.coverWeeks),
    atRisk: productRows.filter(p => p.willStockOut)
      .sort((a, b) => b.projectedShortfall - a.projectedShortfall),
    inTransitCount: productRows.filter(p => p.onOrder > 0).length,
    skuCount: skuRows.length,
    productCount: productRows.length,
    unitsOnHand: sum(skuRows, 'onHand'),
    unitsOnOrder: sum(skuRows, 'onOrder'),
    valueAtCost: stockValue,
    valueAtRetail: sum(productRows, 'valueAtRetail'),
    stockouts: productRows.filter(p => p.state === 'stockout').length,
    lowCover: productRows.filter(p => p.state === 'low' || p.state === 'critical').length,
    deadValue: sum(productRows.filter(p => p.movement === 'dead'), 'valueAtCost'),
    slowValue: sum(productRows.filter(p => p.movement === 'slow'), 'valueAtCost'),
    turns, daysOfCover,
    weeksStockedOut: sum(productRows, 'stockoutWeeks'),
  };
}
