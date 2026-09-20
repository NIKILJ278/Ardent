// The catalogue: brands, sales channels and products.
//
// None of it is written here. Brands come from your account; channels and
// products come from the orders synced out of your connected stores. The
// exports keep their names and stay the same objects — they are refilled in
// place whenever the live store changes — so every importer sees current data
// without being rewired.

import { live, subscribe } from './live.js';

export const CHANNELS = [];
export const CHANNEL_BY_ID = {};
export const COMPANIES = [];
export const COMPANY_BY_ID = {};
export const PRODUCTS = [];
export const PRODUCT_BY_ID = {};

/** Variant ID to its product, so a variant-level row can be named. */
const PRODUCT_BY_VARIANT = {};

function refill(list, items) {
  list.length = 0;
  list.push(...items);
}

function refillIndex(index, items, key = 'id') {
  for (const k of Object.keys(index)) delete index[k];
  for (const item of items) index[item[key]] = item;
}

function rebuild() {
  refill(CHANNELS, live.channels.map((c, i) => ({
    id: c.id, name: c.name, kind: c.kind, slot: c.slot ?? i,
  })));
  refillIndex(CHANNEL_BY_ID, CHANNELS);

  refill(COMPANIES, live.brands.map(b => ({
    id: b.id,
    name: b.name,
    sector: b.industry || '',
    currency: b.currency || 'INR',
    role: b.role,
    channels: b.id === live.brandId ? CHANNELS.map(c => c.id) : [],
  })));
  refillIndex(COMPANY_BY_ID, COMPANIES);

  refill(PRODUCTS, live.products.map(p => ({
    id: p.id,
    company: p.company,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    variants: p.variants ?? [],
  })));
  refillIndex(PRODUCT_BY_ID, PRODUCTS);

  for (const k of Object.keys(PRODUCT_BY_VARIANT)) delete PRODUCT_BY_VARIANT[k];
  for (const p of PRODUCTS) for (const v of p.variants) PRODUCT_BY_VARIANT[v.id] = p;
}

subscribe(rebuild);
rebuild();

/** A product's real variants, as synced from the store. */
export function skusForProduct(product) {
  if (!product) return [];
  return (product.variants ?? []).map(v => ({
    id: v.id,
    code: v.sku || v.id,
    label: v.title || 'Default',
    productId: product.id,
  }));
}

/** The product a variant belongs to, or null. */
export function productForVariant(variantId) {
  return PRODUCT_BY_VARIANT[variantId] ?? null;
}

/** One variant's own record, for naming a variant-level row. */
export function variantById(variantId) {
  return productForVariant(variantId)?.variants.find(v => v.id === variantId) ?? null;
}

/** Categories present for a brand, in stable order. */
export function categoriesFor(companyId) {
  const seen = [];
  for (const p of productsFor(companyId)) {
    if (!seen.includes(p.category)) seen.push(p.category);
  }
  return seen;
}

export function productsFor(companyId) {
  return companyId === 'all' ? PRODUCTS : PRODUCTS.filter(p => p.company === companyId);
}

/** Channels a brand sells on — only those its connected stores report. */
export function channelsFor(companyId) {
  if (companyId === 'all' || companyId === live.brandId) return CHANNELS.map(c => c.id);
  return COMPANY_BY_ID[companyId]?.channels ?? [];
}
