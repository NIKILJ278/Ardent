/* A fact-table fixture for the test harnesses.
 *
 * The app ships with no sample data at all, which is the point — so the tests
 * have to supply their own. This builds a payload in exactly the shape the
 * backend's /facts endpoint returns, and pushes it through the same `setLive`
 * the real app uses. Nothing here is imported by the application itself.
 */
import { setLive, setBrands, clearLive } from './src/data/live.js';

export const BRAND_ID = 'brand-test';

const PRODUCTS = [
  {
    id: 'gid://shopify/Product/1', name: 'Malabar Cotton Bedsheet',
    category: 'Bedding', subcategory: 'Bedsheets',
    variants: [
      { id: 'gid://shopify/ProductVariant/11', title: 'King', sku: 'BED-MAL-K' },
      { id: 'gid://shopify/ProductVariant/12', title: 'Queen', sku: 'BED-MAL-Q' },
    ],
  },
  {
    id: 'gid://shopify/Product/2', name: 'Bamboo Fibre Bath Mat',
    category: 'Bath', subcategory: 'Bath Mats',
    variants: [
      { id: 'gid://shopify/ProductVariant/21', title: 'Default', sku: 'BATH-BAM-1' },
    ],
  },
];

const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * Rows for the last `days` days, ending today, so whatever period the app
 * defaults to has data in it. Values vary by day but are fully deterministic —
 * a test that fails must fail for a reason.
 */
function buildRows(days, { costed }) {
  const rows = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const date = iso(d);
    const wave = 1 + ((i % 7) / 10);

    rows.push({
      date, channel: 'shopify', category: 'Bedding', subcategory: 'Bedsheets',
      product: PRODUCTS[0].id, variant: PRODUCTS[0].variants[0].id,
      units: Math.round(6 * wave), orders: Math.round(5 * wave),
      grossSales: Math.round(14000 * wave), cancelValue: Math.round(400 * wave),
      discount: Math.round(900 * wave), returnsValue: Math.round(1300 * wave),
      returnUnits: 1, cogs: costed ? Math.round(5600 * wave) : null,
      fees: null, logistics: null,
    });
    rows.push({
      date, channel: 'shopify', category: 'Bedding', subcategory: 'Bedsheets',
      product: PRODUCTS[0].id, variant: PRODUCTS[0].variants[1].id,
      units: Math.round(4 * wave), orders: Math.round(3 * wave),
      grossSales: Math.round(8000 * wave), cancelValue: 0,
      discount: Math.round(500 * wave), returnsValue: Math.round(200 * wave),
      returnUnits: 0, cogs: costed ? Math.round(3200 * wave) : null,
      fees: null, logistics: null,
    });
    rows.push({
      date, channel: 'shopify', category: 'Bath', subcategory: 'Bath Mats',
      product: PRODUCTS[1].id, variant: PRODUCTS[1].variants[0].id,
      units: Math.round(3 * wave), orders: Math.round(3 * wave),
      grossSales: Math.round(2400 * wave), cancelValue: 0,
      discount: Math.round(120 * wave), returnsValue: Math.round(90 * wave),
      returnUnits: 0, cogs: costed ? Math.round(1000 * wave) : null,
      fees: null, logistics: null,
    });
  }
  return rows;
}

/** Load the fixture into the live store, as a real sync would. */
export function seedLive({ days = 120, costed = true, currency = 'INR', markets } = {}) {
  const rows = buildRows(days, { costed });
  setBrands([{ id: BRAND_ID, name: 'Test Brand', industry: 'Home', currency, role: 'owner' }]);
  setLive({
    rows,
    currency,
    timezone: currency === 'INR' ? 'Asia/Kolkata' : 'America/New_York',
    // What customers paid in, as /facts reports it. Defaults to a single
    // market so the ordinary case stays the ordinary case.
    presentmentCurrencies: markets ?? [
      { currency, orders: rows.reduce((s, r) => s + r.orders, 0), total: 0 },
    ],
    products: PRODUCTS,
    channels: [{ id: 'shopify', name: 'Shopify', kind: 'owned' }],
    range: { first: rows[0].date, last: rows[rows.length - 1].date },
    orderCount: rows.reduce((s, r) => s + r.orders, 0),
    returnCount: rows.reduce((s, r) => s + r.returnUnits, 0),
    costCoverage: costed ? 1 : 0,
    connections: [{
      id: 'conn-1', platform: 'shopify', status: 'connected',
      display_name: 'teststore.myshopify.com', external_account_id: 'teststore.myshopify.com',
      last_synced_at: new Date().toISOString(), last_error: null,
    }],
    lastSyncedAt: new Date().toISOString(),
    unavailable: ['fees', 'logistics', 'ads', 'inventory', 'cash'],
  }, BRAND_ID);
  return { rows, products: PRODUCTS };
}

/** An account with a brand but nothing synced into it. */
export function seedEmpty() {
  clearLive();
  setBrands([{ id: BRAND_ID, name: 'Test Brand', industry: 'Home', currency: 'INR', role: 'owner' }]);
  setLive({
    rows: [], products: [], channels: [],
    currency: 'INR', timezone: 'Asia/Kolkata', presentmentCurrencies: [],
    range: { first: null, last: null }, orderCount: 0, returnCount: 0,
    costCoverage: null, connections: [], lastSyncedAt: null, unavailable: [],
  }, BRAND_ID);
}
