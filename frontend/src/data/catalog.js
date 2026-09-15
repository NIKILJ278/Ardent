// Static business catalogue. Everything downstream is derived from this,
// so revenue always rolls up: SKU → Product → Category → Channel → Company.

export const CHANNELS = [
  { id: 'amazon',   name: 'Amazon',   kind: 'marketplace', slot: 0 },
  { id: 'flipkart', name: 'Flipkart', kind: 'marketplace', slot: 1 },
  { id: 'myntra',   name: 'Myntra',   kind: 'marketplace', slot: 2 },
  { id: 'direct',   name: 'Shopify (D2C)', kind: 'owned',  slot: 3 },
  { id: 'nykaa',    name: 'Nykaa',    kind: 'marketplace', slot: 4 },
  { id: 'ajio',     name: 'AJIO',     kind: 'marketplace', slot: 5 },
];

export const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map(c => [c.id, c]));

// Marketplace commission + fulfilment take-rate, applied to gross.
export const CHANNEL_FEE_RATE = {
  amazon: 0.185, flipkart: 0.205, myntra: 0.225, nykaa: 0.215, ajio: 0.198, direct: 0.032,
};

// Share of orders that are COD (drives RTO / settlement lag).
export const CHANNEL_COD_RATE = {
  amazon: 0.28, flipkart: 0.44, myntra: 0.36, nykaa: 0.22, ajio: 0.39, direct: 0.18,
};

export const COMPANIES = [
  {
    id: 'kosha',
    name: 'Kosha Living',
    legalName: 'Kosha Living Retail Pvt Ltd',
    sector: 'Home & Living',
    ceo: 'Vismay Shah',
    gstin: '27AAJCK4021L1ZP',
    channels: ['amazon', 'flipkart', 'direct', 'myntra'],
    scale: 1.0,
  },
  {
    id: 'verve',
    name: 'Verve Apparel',
    legalName: 'Verve Lifestyle Brands Pvt Ltd',
    sector: 'Apparel & Fashion',
    ceo: 'Vismay Shah',
    gstin: '27AAFCV8823K1ZQ',
    channels: ['myntra', 'amazon', 'flipkart', 'direct', 'ajio'],
    scale: 0.72,
  },
  {
    id: 'nutreats',
    name: 'Nutreats',
    legalName: 'Nutreats Foods Pvt Ltd',
    sector: 'Food & Nutrition',
    ceo: 'Vismay Shah',
    gstin: '27AAGCN1194M1ZR',
    channels: ['amazon', 'direct', 'flipkart'],
    scale: 0.48,
  },
  {
    id: 'aurelia',
    name: 'Aurelia Jewels',
    legalName: 'Aurelia Jewels Pvt Ltd',
    sector: 'Jewellery',
    ceo: 'Vismay Shah',
    gstin: '27AALCA6672N1ZS',
    channels: ['nykaa', 'amazon', 'direct', 'myntra', 'ajio'],
    scale: 0.34,
  },
];

export const COMPANY_BY_ID = Object.fromEntries(COMPANIES.map(c => [c.id, c]));
export const ALL_BRANDS = { id: 'all', name: 'All Brands', sector: 'Group', ceo: 'Vismay Shah' };

/**
 * Products. `mix` = share of this product's volume per channel (normalised at
 * build time). `weight` = relative revenue share inside its company.
 * `launchedOn` marks a product as new so the UI can flag it.
 */
export const PRODUCTS = [
  // ── Kosha Living ───────────────────────────────────────────────────────
  { id: 'ko-bed-01', company: 'kosha', category: 'Bedding', subcategory: 'Bedsheets',  name: 'Malabar Cotton Bedsheet Set',   mrp: 3499, price: 2649, cogsRate: 0.46, weight: 1.00, trend:  0.18, mix: { amazon: 0.42, flipkart: 0.24, direct: 0.24, myntra: 0.10 } },
  { id: 'ko-bed-02', company: 'kosha', category: 'Bedding', subcategory: 'Comforters',  name: 'Anantara Quilted Comforter',    mrp: 5999, price: 4499, cogsRate: 0.49, weight: 0.74, trend:  0.26, mix: { amazon: 0.38, flipkart: 0.22, direct: 0.30, myntra: 0.10 } },
  { id: 'ko-bed-03', company: 'kosha', category: 'Bedding', subcategory: 'Pillows',  name: 'Riverstone Pillow Pair',        mrp: 1499, price: 1099, cogsRate: 0.41, weight: 0.38, trend: -0.09, mix: { amazon: 0.48, flipkart: 0.30, direct: 0.16, myntra: 0.06 } },
  { id: 'ko-bath-01',company: 'kosha', category: 'Bath', subcategory: 'Towels',     name: 'Terry Bath Towel Set of 4',     mrp: 2299, price: 1749, cogsRate: 0.44, weight: 0.61, trend:  0.07, mix: { amazon: 0.44, flipkart: 0.28, direct: 0.20, myntra: 0.08 } },
  { id: 'ko-bath-02',company: 'kosha', category: 'Bath', subcategory: 'Bath Mats',     name: 'Bamboo Fibre Bath Mat',         mrp:  999, price:  749, cogsRate: 0.38, weight: 0.24, trend: -0.22, mix: { amazon: 0.52, flipkart: 0.30, direct: 0.14, myntra: 0.04 } },
  { id: 'ko-kit-01', company: 'kosha', category: 'Kitchen', subcategory: 'Cookware',  name: 'Pre-Seasoned Cast Iron Kadai',  mrp: 2799, price: 2199, cogsRate: 0.52, weight: 0.52, trend:  0.33, mix: { amazon: 0.46, flipkart: 0.26, direct: 0.24, myntra: 0.04 } },
  { id: 'ko-kit-02', company: 'kosha', category: 'Kitchen', subcategory: 'Serveware',  name: 'Terracotta Serving Bowl Set',   mrp: 1899, price: 1449, cogsRate: 0.43, weight: 0.29, trend:  0.11, mix: { amazon: 0.40, flipkart: 0.22, direct: 0.32, myntra: 0.06 } },
  { id: 'ko-dec-01', company: 'kosha', category: 'Decor', subcategory: 'Cushions',    name: 'Jaipur Block Print Cushion Cover', mrp: 1299, price: 899, cogsRate: 0.36, weight: 0.44, trend:  0.15, mix: { amazon: 0.36, flipkart: 0.20, direct: 0.30, myntra: 0.14 } },
  { id: 'ko-dec-02', company: 'kosha', category: 'Decor', subcategory: 'Festive Decor',    name: 'Brass Diya Gift Set',           mrp: 2499, price: 1899, cogsRate: 0.47, weight: 0.33, trend:  0.58, launchedOn: '2026-08-14', mix: { amazon: 0.34, flipkart: 0.18, direct: 0.38, myntra: 0.10 } },

  // ── Verve Apparel ──────────────────────────────────────────────────────
  { id: 've-men-01', company: 'verve', category: 'Menswear', subcategory: 'Kurtas',   name: 'Linen Blend Kurta',        mrp: 2999, price: 2249, cogsRate: 0.42, weight: 1.00, trend:  0.21, mix: { ajio: 0.1, myntra: 0.44, amazon: 0.24, flipkart: 0.18, direct: 0.14 } },
  { id: 've-men-02', company: 'verve', category: 'Menswear', subcategory: 'Shirts',   name: 'Oxford Cotton Shirt',      mrp: 2499, price: 1799, cogsRate: 0.44, weight: 0.83, trend:  0.06, mix: { ajio: 0.12, myntra: 0.40, amazon: 0.26, flipkart: 0.22, direct: 0.12 } },
  { id: 've-men-03', company: 'verve', category: 'Menswear', subcategory: 'Trousers',   name: 'Slim Fit Chino Trousers',  mrp: 3199, price: 2399, cogsRate: 0.46, weight: 0.57, trend: -0.14, mix: { ajio: 0.14, myntra: 0.46, amazon: 0.22, flipkart: 0.20, direct: 0.12 } },
  { id: 've-wom-01', company: 'verve', category: 'Womenswear', subcategory: 'Dresses', name: 'Rayon Wrap Dress',         mrp: 2799, price: 2099, cogsRate: 0.41, weight: 0.79, trend:  0.29, mix: { ajio: 0.11, myntra: 0.50, amazon: 0.20, flipkart: 0.16, direct: 0.14 } },
  { id: 've-wom-02', company: 'verve', category: 'Womenswear', subcategory: 'Sarees', name: 'Handloom Cotton Saree',    mrp: 4999, price: 3799, cogsRate: 0.48, weight: 0.66, trend:  0.12, mix: { ajio: 0.09, myntra: 0.38, amazon: 0.24, flipkart: 0.18, direct: 0.20 } },
  { id: 've-acc-01', company: 'verve', category: 'Accessories', subcategory: 'Belts',name: 'Full Grain Leather Belt',  mrp: 1799, price: 1299, cogsRate: 0.39, weight: 0.31, trend: -0.05, mix: { ajio: 0.1, myntra: 0.36, amazon: 0.32, flipkart: 0.20, direct: 0.12 } },

  // ── Nutreats ───────────────────────────────────────────────────────────
  { id: 'nu-sup-01', company: 'nutreats', category: 'Supplements', subcategory: 'Protein', name: 'Whey Protein Isolate 1kg',    mrp: 4499, price: 3399, cogsRate: 0.55, weight: 1.00, trend:  0.24, mix: { amazon: 0.52, direct: 0.32, flipkart: 0.16 } },
  { id: 'nu-sup-02', company: 'nutreats', category: 'Supplements', subcategory: 'Vitamins', name: 'Daily Multivitamin Gummies', mrp: 1299, price:  949, cogsRate: 0.40, weight: 0.62, trend:  0.41, mix: { amazon: 0.48, direct: 0.38, flipkart: 0.14 } },
  { id: 'nu-sup-03', company: 'nutreats', category: 'Supplements', subcategory: 'Protein', name: 'Plant Protein Blend 500g',   mrp: 2199, price: 1699, cogsRate: 0.51, weight: 0.44, trend:  0.66, launchedOn: '2026-08-26', mix: { amazon: 0.44, direct: 0.44, flipkart: 0.12 } },
  { id: 'nu-snk-01', company: 'nutreats', category: 'Snacks', subcategory: 'Namkeen',      name: 'Roasted Makhana 6-Pack',     mrp:  699, price:  499, cogsRate: 0.37, weight: 0.48, trend:  0.09, mix: { amazon: 0.56, direct: 0.28, flipkart: 0.16 } },
  { id: 'nu-bev-01', company: 'nutreats', category: 'Beverages', subcategory: 'Coffee',   name: 'Cold Brew Coffee Concentrate', mrp: 899, price: 649, cogsRate: 0.42, weight: 0.35, trend: -0.17, mix: { amazon: 0.46, direct: 0.40, flipkart: 0.14 } },

  // ── Aurelia Jewels ─────────────────────────────────────────────────────
  { id: 'au-ear-01', company: 'aurelia', category: 'Earrings', subcategory: 'Jhumkas',  name: 'Kundan Jhumka',          mrp: 3999, price: 2999, cogsRate: 0.45, weight: 1.00, trend:  0.31, mix: { ajio: 0.08, nykaa: 0.40, amazon: 0.26, direct: 0.22, myntra: 0.12 } },
  { id: 'au-ear-02', company: 'aurelia', category: 'Earrings', subcategory: 'Studs',  name: 'Pearl Drop Earrings',    mrp: 2499, price: 1849, cogsRate: 0.41, weight: 0.68, trend:  0.14, mix: { ajio: 0.09, nykaa: 0.44, amazon: 0.24, direct: 0.20, myntra: 0.12 } },
  { id: 'au-nec-01', company: 'aurelia', category: 'Necklaces', subcategory: 'Necklace Sets', name: 'Temple Necklace Set',    mrp: 8999, price: 6999, cogsRate: 0.52, weight: 0.74, trend:  0.19, mix: { ajio: 0.07, nykaa: 0.34, amazon: 0.22, direct: 0.32, myntra: 0.12 } },
  { id: 'au-rin-01', company: 'aurelia', category: 'Rings', subcategory: 'Bands',     name: 'Solitaire Band Ring',    mrp: 5499, price: 4299, cogsRate: 0.49, weight: 0.42, trend: -0.08, mix: { ajio: 0.08, nykaa: 0.38, amazon: 0.26, direct: 0.24, myntra: 0.12 } },

  // ── Courses & digital ──────────────────────────────────────────────────
  // Digital goods, sold on the brand's own storefront only. No stock, almost
  // no cost of goods, and returns are refunds rather than reverse logistics —
  // `digital: true` is what the inventory and logistics models key off.
  { id: 'ko-crs-01', company: 'kosha', category: 'Courses', subcategory: 'Home Styling', name: 'Styling Your Home Masterclass', mrp: 2999, price: 1999, cogsRate: 0.06, weight: 0.16, trend: 0.62, digital: true, mix: { direct: 1 } },
  { id: 've-crs-01', company: 'verve', category: 'Courses', subcategory: 'Personal Style', name: 'Build Your Wardrobe Course', mrp: 3499, price: 2499, cogsRate: 0.05, weight: 0.14, trend: 0.48, digital: true, mix: { direct: 1 } },
  { id: 'nu-crs-01', company: 'nutreats', category: 'Courses', subcategory: 'Nutrition', name: '8-Week Nutrition Programme', mrp: 5999, price: 4499, cogsRate: 0.09, weight: 0.22, trend: 0.71, digital: true, mix: { direct: 1 } },
  { id: 'au-crs-01', company: 'aurelia', category: 'Courses', subcategory: 'Jewellery Care', name: 'Heirloom Jewellery Care Course', mrp: 1999, price: 1499, cogsRate: 0.05, weight: 0.11, trend: 0.35, digital: true, mix: { direct: 1 } },
];

export const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));

/** Digital goods carry no stock, no shipping and no reverse logistics. */
export const isDigital = (product) => !!product?.digital;
export const PHYSICAL_PRODUCTS = PRODUCTS.filter(p => !p.digital);

/** SKU variants per product. Ratios sum to 1 so SKU revenue sums to product revenue. */
/**
 * Variants as [label, share of volume, return bias].
 *
 * The bias matters: a size or fit at the edge of the range is returned far
 * more often than the middle of it. Without it every variant would show the
 * same return rate, and a size-level view would have nothing to say — which is
 * exactly the question a buyer is asking when they open one.
 * Biases are relative and normalised, so the product's own return rate is
 * unchanged; only its distribution across variants moves.
 */
const VARIANT_SETS = {
  Bedding:     [['King',   0.46, 1.15], ['Queen',  0.34, 0.95], ['Single', 0.20, 0.80]],
  Bath:        [['Ivory',  0.38, 1.25], ['Charcoal', 0.34, 0.85], ['Sage', 0.28, 0.90]],
  Kitchen:     [['26 cm',  0.55, 0.90], ['30 cm',  0.45, 1.15]],
  Decor:       [['Set of 2', 0.58, 0.90], ['Set of 5', 0.42, 1.20]],
  Menswear:    [['M', 0.30, 0.85], ['L', 0.34, 0.90], ['XL', 0.22, 1.35], ['XXL', 0.14, 1.60]],
  Womenswear:  [['S', 0.26, 1.40], ['M', 0.34, 0.85], ['L', 0.26, 1.00], ['XL', 0.14, 1.45]],
  Accessories: [['32', 0.34, 1.20], ['34', 0.38, 0.85], ['36', 0.28, 1.10]],
  Supplements: [['Chocolate', 0.44, 0.85], ['Vanilla', 0.33, 1.00], ['Unflavoured', 0.23, 1.30]],
  Snacks:      [['Peri Peri', 0.40, 1.15], ['Himalayan Salt', 0.35, 0.85], ['Cheese', 0.25, 1.05]],
  Beverages:   [['Original', 0.62, 0.90], ['Hazelnut', 0.38, 1.20]],
  Earrings:    [['Gold Tone', 0.58, 0.95], ['Silver Tone', 0.42, 1.10]],
  Necklaces:   [['Gold Tone', 0.64, 0.95], ['Rose Gold', 0.36, 1.10]],
  Rings:       [['14', 0.31, 1.30], ['16', 0.40, 0.85], ['18', 0.29, 1.20]],
  Courses:     [['Self-paced', 0.68, 1.00], ['With mentoring', 0.32, 1.00]],
};

export function skusForProduct(product) {
  const variants = VARIANT_SETS[product.category] || [['Standard', 1, 1]];
  const base = product.id.toUpperCase().replace(/-/g, '');

  // Normalise the return bias against the volume-weighted mean, so the product's
  // own return rate is preserved exactly while variants differ from each other.
  const meanBias = variants.reduce((s, [, ratio, bias = 1]) => s + ratio * bias, 0)
    / (variants.reduce((s, [, ratio]) => s + ratio, 0) || 1);

  return variants.map(([label, ratio, bias = 1], i) => ({
    id: `${product.id}-v${i + 1}`,
    code: `${base}-${label.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6)}`,
    label,
    ratio,
    /** Multiplier on the product's return rate for this variant. */
    returnFactor: meanBias > 0 ? bias / meanBias : 1,
    productId: product.id,
  }));
}

/** Categories present for a company, in stable order. */
export function categoriesFor(companyId) {
  const seen = [];
  for (const p of PRODUCTS) {
    if (companyId !== 'all' && p.company !== companyId) continue;
    if (!seen.includes(p.category)) seen.push(p.category);
  }
  return seen;
}

export function productsFor(companyId) {
  return companyId === 'all' ? PRODUCTS : PRODUCTS.filter(p => p.company === companyId);
}

export function channelsFor(companyId) {
  if (companyId === 'all') return CHANNELS.map(c => c.id);
  return COMPANY_BY_ID[companyId]?.channels ?? [];
}
