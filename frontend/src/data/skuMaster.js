// SKU Master — the internal catalogue of record.
//
// Every marketplace issues its own identifier for the same physical item:
// Amazon an ASIN, Flipkart an FSN, Myntra a style ID. Without one internal SKU
// holding those together, sales and settlements arrive as unrelated rows and
// nothing can be attributed to a product. This module is that spine.

import { PRODUCTS, COMPANY_BY_ID, CHANNELS, skusForProduct, channelsFor } from './catalog.js';
import { rngFor } from './../lib/prng.js';

const BRAND_CODE = { kosha: 'KOS', verve: 'VRV', nutreats: 'NUT', aurelia: 'AUR' };

/** HSN codes drive GST rate, so they belong on the master, not on a listing. */
export const HSN = {
  Bedding: '6302', Bath: '6302', Kitchen: '7323', Decor: '9405',
  Menswear: '6205', Womenswear: '6204', Accessories: '4203',
  Supplements: '2106', Snacks: '2008', Beverages: '2101',
  Earrings: '7117', Necklaces: '7117', Rings: '7117',
};

export const GST_RATE = { '6302': 5, '7323': 12, '9405': 12, '6205': 5, '6204': 5, '4203': 18, '2106': 18, '2008': 12, '2101': 18, '7117': 3 };

/** Per-marketplace identifier shapes, as they actually look. */
export const LISTING_FORMATS = {
  amazon:   { label: 'ASIN',        hint: 'Amazon Standard Identification Number' },
  flipkart: { label: 'FSN',         hint: 'Flipkart Serial Number' },
  myntra:   { label: 'Style ID',    hint: 'Myntra style identifier' },
  nykaa:    { label: 'Product ID',  hint: 'Nykaa catalogue id' },
  ajio:     { label: 'Article No.', hint: 'AJIO article number' },
  direct:   { label: 'Variant ID',  hint: 'Storefront variant id' },
};

/**
 * Fulfilment programmes differ per marketplace and change the fee a listing
 * attracts, so they belong on the listing rather than the master.
 */
const FULFILMENT = {
  amazon:   ['FBA', 'Easy Ship', 'Seller Flex'],
  flipkart: ['Smart Fulfilment', 'Seller Ship'],
  myntra:   ['PPMP', 'SJIT'],
  nykaa:    ['Nykaa Fulfilled', 'Seller Fulfilled'],
  ajio:     ['AJIO Fulfilled', 'Drop Ship'],
  direct:   ['Self Ship', '3PL'],
};

/** Each platform files the same item under its own taxonomy root. */
const PLATFORM_ROOT = {
  amazon:   { 'Home & Living': 'Home & Kitchen', 'Apparel & Fashion': 'Clothing & Accessories', 'Food & Nutrition': 'Health & Personal Care', Jewellery: 'Jewellery' },
  flipkart: { 'Home & Living': 'Home Furnishing', 'Apparel & Fashion': 'Clothing', 'Food & Nutrition': 'Food & Nutrition', Jewellery: 'Jewellery' },
  myntra:   { 'Home & Living': 'Home & Living', 'Apparel & Fashion': 'Apparel', 'Food & Nutrition': 'Personal Care', Jewellery: 'Accessories' },
  nykaa:    { 'Home & Living': 'Home', 'Apparel & Fashion': 'Fashion', 'Food & Nutrition': 'Wellness', Jewellery: 'Jewellery' },
  ajio:     { 'Home & Living': 'Home', 'Apparel & Fashion': 'Fashion', 'Food & Nutrition': 'Wellness', Jewellery: 'Accessories' },
  direct:   { 'Home & Living': 'Shop', 'Apparel & Fashion': 'Shop', 'Food & Nutrition': 'Shop', Jewellery: 'Shop' },
};

export const LISTING_STATES = {
  active:   { label: 'Active',   tone: 'good' },
  inactive: { label: 'Inactive', tone: 'warning' },
  unmapped: { label: 'Unmapped', tone: 'critical' },
};

const AN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const pick = (rnd, s, n) => Array.from({ length: n }, () => s[Math.floor(rnd() * s.length)]).join('');
const digits = (rnd, n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');

function listingId(channel, rnd) {
  switch (channel) {
    case 'amazon':   return `B0${pick(rnd, AN, 8)}`;
    case 'flipkart': return pick(rnd, AN, 16);
    case 'myntra':   return digits(rnd, 8);
    case 'nykaa':    return `NYK${digits(rnd, 7)}`;
    case 'ajio':     return digits(rnd, 9);
    case 'direct':   return digits(rnd, 13);
    default:         return pick(rnd, AN, 10);
  }
}

/** EAN-13 with a valid check digit — a wrong one fails marketplace ingestion. */
function ean13(rnd) {
  const body = `890${digits(rnd, 9)}`;
  const sum = body.split('').reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body + ((10 - (sum % 10)) % 10);
}

const slug = (s) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);

/**
 * Variant slug that never drops the digits. Plain truncation collapses
 * "Set of 2" and "Set of 5" to the same code, which would give two different
 * items one primary key.
 */
function slugVariant(label) {
  const clean = label.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const nums = (label.match(/\d+/g) ?? []).join('');
  if (!nums) return clean.slice(0, 4);
  const letters = clean.replace(/\d/g, '').slice(0, Math.max(0, 4 - nums.length));
  return letters + nums;
}

let _master = null;

function build() {
  const rows = [];

  for (const product of PRODUCTS) {
    const company = COMPANY_BY_ID[product.company];
    if (!company) continue;
    const sellable = channelsFor(product.company);

    for (const variant of skusForProduct(product)) {
      const rnd = rngFor(`master|${variant.id}`);
      const hsn = HSN[product.category] ?? '9999';

      const listings = {};
      for (const ch of sellable) {
        const r = rnd();
        // Most listings are live; a few are paused, a few were never created.
        const state = r < 0.87 ? 'active' : r < 0.94 ? 'inactive' : 'unmapped';
        if (state === 'unmapped') {
          listings[ch] = { channel: ch, id: null, sellerSku: null, state };
          continue;
        }
        const modes = FULFILMENT[ch] ?? ['Seller Ship'];
        const root = PLATFORM_ROOT[ch]?.[company.sector] ?? 'General';
        // Platforms rarely hold the exact same price — MOP and platform-funded
        // promotions pull it around, which is why it lives on the listing.
        const listPrice = Math.round((product.price * (0.97 + rnd() * 0.09)) / 10) * 10;
        listings[ch] = {
          channel: ch,
          id: listingId(ch, rnd),
          sellerSku: variant.code,
          state,
          title: `${company.name} ${product.name} — ${variant.label}`,
          price: listPrice,
          fulfilment: modes[Math.floor(rnd() * modes.length)],
          platformCategory: `${root} > ${product.category} > ${product.subcategory ?? product.category}`,
          liveSince: `2026-0${1 + Math.floor(rnd() * 8)}-${String(1 + Math.floor(rnd() * 27)).padStart(2, '0')}`,
        };
      }

      rows.push({
        // Product sequence is carried through so two products sharing a name
        // prefix inside one category cannot collide.
        sku: `${BRAND_CODE[product.company] ?? 'GEN'}-${slug(product.category)}-${slug(product.name)}${product.id.match(/(\d+)$/)?.[1] ?? ''}-${slugVariant(variant.label)}`,
        variantId: variant.id,
        productId: product.id,
        productName: product.name,
        company: product.company,
        companyName: company.name,
        category: product.category,
        subcategory: product.subcategory ?? product.category,
        variant: variant.label,
        ean: ean13(rnd),
        hsn,
        gstPct: GST_RATE[hsn] ?? 18,
        mrp: product.mrp,
        price: product.price,
        weightGm: Math.round(180 + rnd() * 1500),
        status: product.launchedOn && rnd() < 0.5 ? 'new' : rnd() < 0.06 ? 'discontinued' : 'active',
        launchedOn: product.launchedOn ?? null,
        listings,
      });
    }
  }
  // The internal SKU is the primary key of the whole system — a duplicate
  // would silently merge two products, so fail loudly rather than ship it.
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.sku)) throw new Error(`SKU Master: duplicate internal SKU "${r.sku}"`);
    seen.add(r.sku);
  }
  return rows;
}

export function skuMaster() {
  if (!_master) _master = build();
  return _master;
}

export function masterFor(companyId) {
  const all = skuMaster();
  return companyId === 'all' ? all : all.filter(r => r.company === companyId);
}

export const MASTER_STATUS = {
  active:       { label: 'Active',       tone: 'good' },
  new:          { label: 'New',          tone: 'info' },
  discontinued: { label: 'Discontinued', tone: 'neutral' },
};

/**
 * Mapping health. An unmapped listing is not a cosmetic gap — sales arriving
 * under an unknown marketplace id cannot be attributed to a product, so the
 * count is a direct measure of how much of the catalogue is trustworthy.
 */
export function mappingHealth(companyId) {
  const rows = masterFor(companyId);
  const channels = CHANNELS.filter(c => channelsFor(companyId).includes(c.id));

  const byChannel = channels.map(c => {
    let active = 0, inactive = 0, unmapped = 0;
    for (const r of rows) {
      const l = r.listings[c.id];
      if (!l) continue;
      if (l.state === 'active') active++;
      else if (l.state === 'inactive') inactive++;
      else unmapped++;
    }
    const total = active + inactive + unmapped;
    return {
      channel: c.id, channelName: c.name, kind: c.kind,
      active, inactive, unmapped, total,
      coverage: total ? (active / total) * 100 : 0,
    };
  });

  // The same marketplace id appearing on two internal SKUs means settlements
  // will be attributed to the wrong product.
  const seen = new Map();
  const conflicts = [];
  for (const r of rows) {
    for (const l of Object.values(r.listings)) {
      if (!l.id) continue;
      const key = `${l.channel}:${l.id}`;
      if (seen.has(key)) conflicts.push({ channel: l.channel, id: l.id, skus: [seen.get(key), r.sku] });
      else seen.set(key, r.sku);
    }
  }

  const totalListings = byChannel.reduce((s, c) => s + c.total, 0);
  const totalUnmapped = byChannel.reduce((s, c) => s + c.unmapped, 0);
  const fullyMapped = rows.filter(r => Object.values(r.listings).every(l => l.state !== 'unmapped')).length;

  return {
    rows, byChannel, conflicts,
    skuCount: rows.length,
    totalListings, totalUnmapped,
    fullyMapped,
    coverage: totalListings ? ((totalListings - totalUnmapped) / totalListings) * 100 : 0,
    gaps: rows
      .filter(r => Object.values(r.listings).some(l => l.state === 'unmapped'))
      .map(r => ({
        sku: r.sku, productName: r.productName, variant: r.variant,
        missing: Object.values(r.listings).filter(l => l.state === 'unmapped').map(l => l.channel),
      })),
  };
}

/** Look a master row up by any of its identifiers — internal SKU, EAN or listing id. */
export function findBySku(code) {
  const needle = String(code).trim().toLowerCase();
  return skuMaster().find(r =>
    r.sku.toLowerCase() === needle ||
    r.ean === needle ||
    Object.values(r.listings).some(l => l.id && l.id.toLowerCase() === needle)
  ) ?? null;
}

/** The master rows belonging to one product, for the Sales SKU drill. */
export function masterForProduct(productId) {
  return skuMaster().filter(r => r.productId === productId);
}
