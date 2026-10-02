// The live data store.
//
// Every figure in Ardent is derived from one fact table. It used to be
// generated in the browser; it now arrives from the backend, built from orders
// synced out of your connected stores. This module holds it and nothing else,
// so the engine stays a pure filter-and-reduce over whatever is really here.
//
// It imports nothing, so the catalogue and the engine can both depend on it
// without a cycle.

const EMPTY_META = {
  currency: 'INR',
  timezone: null,
  presentmentCurrencies: [],
  range: { first: null, last: null },
  orderCount: 0,
  returnCount: 0,
  costCoverage: null,
  connections: [],
  lastSyncedAt: null,
  unavailable: [],
};

import { setCurrency } from '../lib/format.js';

export const live = {
  status: 'idle', // idle | loading | ready | error
  error: null,
  brandId: null,
  brands: [],
  rows: [],
  products: [],
  channels: [],
  meta: { ...EMPTY_META },
  version: 0,
};

const listeners = new Set();

/** Be told whenever the store changes. Returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  live.version += 1;
  for (const fn of listeners) fn(live.version);
}

const toTs = (day) => new Date(`${day}T00:00:00`).getTime();

/**
 * One API row, in the shape the engine reduces over.
 *
 * Costs Shopify does not report — gateway fees, courier charges, warehousing —
 * are held at zero for arithmetic but flagged, so nothing downstream can present
 * a margin built on a cost that was never measured.
 */
export function normaliseRow(r, brandId) {
  const grossSales = Number(r.grossSales) || 0;
  const cancelValue = Number(r.cancelValue) || 0;
  const discount = Number(r.discount) || 0;
  const returnsValue = Number(r.returnsValue) || 0;
  const gross = grossSales - cancelValue;
  const costKnown = r.cogs !== null && r.cogs !== undefined;
  const cogs = costKnown ? Number(r.cogs) || 0 : 0;
  const net = gross - discount - returnsValue;

  return {
    date: r.date,
    ts: toTs(r.date),
    company: brandId,
    channel: r.channel,
    category: r.category,
    subcategory: r.subcategory,
    product: r.product,
    variant: r.variant,
    units: Number(r.units) || 0,
    orders: Number(r.orders) || 0,
    // Which orders this row holds. Lets the engine count distinct orders at any
    // scope instead of adding up per-row counts, which counts an order once for
    // every product on it.
    orderIds: Array.isArray(r.orderIds) ? r.orderIds : null,
    gross,
    grossSales,
    cancelValue,
    discount,
    // Shopify does not say who funded a discount; on your own store it is you.
    discountPlatform: 0,
    discountBrand: discount,
    fees: 0,
    shipping: 0,
    returnsValue,
    returnValue: returnsValue,
    rtoValue: 0,
    logistics: 0,
    fulfilment: 0,
    warehousing: 0,
    paymentFees: 0,
    otherCost: 0,
    net,
    cogs,
    margin: net - cogs,
    returnUnits: Number(r.returnUnits) || 0,
    // Counted, not summed as money: any row without a unit cost makes the
    // cost of goods for its scope incomplete.
    costGaps: costKnown ? 0 : 1,
  };
}

/** Replace the store with a fresh payload from `/facts`. */
export function setLive(payload, brandId) {
  live.brandId = brandId;
  live.rows = (payload?.rows ?? []).map(r => normaliseRow(r, brandId)).sort((a, b) => a.ts - b.ts);
  live.products = (payload?.products ?? []).map(p => ({ ...p, company: brandId }));
  live.channels = (payload?.channels ?? []).map((c, i) => ({ ...c, slot: i }));
  live.meta = {
    ...EMPTY_META,
    // The store's own currency, so nothing is labelled in a currency it is not in.
    currency: payload?.currency ?? EMPTY_META.currency,
    timezone: payload?.timezone ?? null,
    presentmentCurrencies: payload?.presentmentCurrencies ?? [],
    range: payload?.range ?? EMPTY_META.range,
    orderCount: payload?.orderCount ?? 0,
    returnCount: payload?.returnCount ?? 0,
    costCoverage: payload?.costCoverage ?? null,
    connections: payload?.connections ?? [],
    lastSyncedAt: payload?.lastSyncedAt ?? null,
    unavailable: payload?.unavailable ?? [],
  };
  live.status = 'ready';
  live.error = null;
  // Point every money formatter at this store before anything renders.
  setCurrency(live.meta.currency);
  emit();
}

/** The brands this user can open, from `/api/brands`. */
export function setBrands(brands) {
  live.brands = brands ?? [];
  emit();
}

export function setLiveStatus(status, error = null) {
  live.status = status;
  live.error = error;
  emit();
}

/** Forget everything — on sign-out, or when switching to another brand. */
export function clearLive() {
  live.status = 'idle';
  live.error = null;
  live.brandId = null;
  live.rows = [];
  live.products = [];
  live.channels = [];
  live.meta = { ...EMPTY_META };
  emit();
}

export const hasData = () => live.rows.length > 0;

/**
 * What the connected sources can actually answer.
 *
 * Only order data is synced today. Everything else is false until a source for
 * it exists, and the pages that need it say so rather than inventing a figure.
 */
export function availability() {
  const connected = live.meta.connections.filter(c => c.status === 'connected');
  return {
    // Selling into more than one currency is a fact about the store, not a
    // source that has to be connected.
    multiCurrency: (live.meta.presentmentCurrencies?.length ?? 0) > 1,
    sales: live.rows.length > 0,
    shopify: connected.some(c => c.platform === 'shopify'),
    // Cost of goods is only trustworthy where every sold unit carried a cost.
    cogs: live.meta.costCoverage === 1,
    cogsPartial: live.meta.costCoverage != null && live.meta.costCoverage > 0,
    fees: false,
    logistics: false,
    ads: false,
    inventory: false,
    settlements: false,
    cash: false,
    opex: false,
    gst: false,
    marketplaces: false,
  };
}
