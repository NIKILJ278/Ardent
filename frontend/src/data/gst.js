// GST computation for filing and reporting.
//
// Two rules drive everything here and are easy to get wrong:
//
//  1. Indian retail prices are GST-INCLUSIVE. The taxable value is therefore
//     invoice ÷ (1 + rate), never invoice × rate.
//  2. Place of supply decides the tax head. Same state as the seller means
//     CGST + SGST at half the rate each; a different state means IGST at the
//     full rate. The total tax is identical either way — only the split moves.
//
// Marketplace sales remain the seller's own outward supply and are reported in
// GSTR-1 by the seller. The operator separately collects 1% TCS under s.52,
// which the seller claims back in the electronic cash ledger.

import { groupBy } from './engine.js';
import { PRODUCT_BY_ID, COMPANY_BY_ID, CHANNEL_BY_ID, CHANNELS } from './catalog.js';
import { HSN, GST_RATE } from './skuMaster.js';

/** State code → name, for the states that carry meaningful volume. */
export const STATES = {
  '27': 'Maharashtra', '29': 'Karnataka', '07': 'Delhi', '09': 'Uttar Pradesh',
  '33': 'Tamil Nadu', '24': 'Gujarat', '36': 'Telangana', '19': 'West Bengal',
  '08': 'Rajasthan', '06': 'Haryana', '23': 'Madhya Pradesh', '32': 'Kerala',
  '37': 'Andhra Pradesh', '03': 'Punjab', '10': 'Bihar',
};

/** Share of destination volume by state. Sums to 1. */
export const STATE_MIX = {
  '27': 0.142, '29': 0.113, '07': 0.092, '09': 0.088, '33': 0.079,
  '24': 0.071, '36': 0.058, '19': 0.052, '08': 0.047, '06': 0.044,
  '23': 0.038, '32': 0.033, '37': 0.031, '03': 0.028, '10': 0.024,
};
// The remainder falls to smaller states, reported together.
const MIX_TOTAL = Object.values(STATE_MIX).reduce((s, v) => s + v, 0);
const OTHER_SHARE = Math.max(0, 1 - MIX_TOTAL);

/** Unit Quantity Code — GSTR-1 requires one per HSN line. */
const UQC = {
  Bedding: 'SET', Bath: 'SET', Kitchen: 'PCS', Decor: 'SET',
  Menswear: 'PCS', Womenswear: 'PCS', Accessories: 'PCS',
  Supplements: 'NOS', Snacks: 'PAC', Beverages: 'NOS',
  Earrings: 'PRS', Necklaces: 'NOS', Rings: 'NOS',
};

const HSN_DESC = {
  '6302': 'Bed linen, table linen, toilet and kitchen linen',
  '7323': 'Table, kitchen or other household articles of iron or steel',
  '9405': 'Lamps and lighting fittings, decorative articles',
  '6205': "Men's shirts and similar garments",
  '6204': "Women's suits, dresses and similar garments",
  '4203': 'Articles of apparel and clothing accessories, of leather',
  '2106': 'Food preparations not elsewhere specified',
  '2008': 'Fruit, nuts and other edible parts of plants, prepared',
  '2101': 'Extracts, essences and concentrates of coffee or tea',
  '7117': 'Imitation jewellery',
};

export function sellerStateCode(companyId) {
  return (COMPANY_BY_ID[companyId]?.gstin ?? '27').slice(0, 2);
}

/** Split a GST-inclusive amount into taxable value and tax at a given rate. */
export function splitInclusive(inclusive, ratePct) {
  const taxable = inclusive / (1 + ratePct / 100);
  return { taxable, tax: inclusive - taxable };
}

const hsnFor = (product) => HSN[product?.category] ?? '9999';
const rateFor = (product) => GST_RATE[hsnFor(product)] ?? 18;

/**
 * The full return workbook for a period.
 *
 * `scope` is the same scope object every other module uses, so the GST figures
 * are computed from exactly the same transactions as the Sales and Finance
 * pages — there is no separate tax ledger to drift out of line.
 */
export function gstReturn(scope, companyId) {
  const sellerState = sellerStateCode(companyId);
  const company = COMPANY_BY_ID[companyId];

  // ── Outward supplies, per product so the rate is right ────────────────
  const byProduct = groupBy(scope, 'product');

  const hsnMap = new Map();
  let invoiceValue = 0, taxableValue = 0, totalTax = 0;
  let creditInvoice = 0, creditTaxable = 0, creditTax = 0;
  const rateSlabs = new Map();

  for (const row of byProduct) {
    const product = PRODUCT_BY_ID[row.key];
    if (!product) continue;
    const hsn = hsnFor(product);
    const rate = rateFor(product);

    // Net of cancellations: a cancelled order is never supplied, so it never
    // enters the return at all. Returns DO enter, as credit notes.
    const supplied = row.grossSales - row.cancelValue - row.discount;
    const { taxable, tax } = splitInclusive(supplied, rate);

    // Returns and RTO are credit notes against supplies already reported.
    const credited = row.returnsValue;
    const cn = splitInclusive(credited, rate);

    invoiceValue += supplied; taxableValue += taxable; totalTax += tax;
    creditInvoice += credited; creditTaxable += cn.taxable; creditTax += cn.tax;

    if (!hsnMap.has(hsn)) {
      hsnMap.set(hsn, {
        hsn, description: HSN_DESC[hsn] ?? 'Other goods', uqc: UQC[product.category] ?? 'PCS',
        rate, quantity: 0, taxable: 0, tax: 0,
      });
    }
    const h = hsnMap.get(hsn);
    h.quantity += row.units; h.taxable += taxable; h.tax += tax;

    if (!rateSlabs.has(rate)) rateSlabs.set(rate, { rate, taxable: 0, tax: 0, creditTaxable: 0, creditTax: 0 });
    const sl = rateSlabs.get(rate);
    sl.taxable += taxable; sl.tax += tax;
    sl.creditTaxable += cn.taxable; sl.creditTax += cn.tax;
  }

  // ── Place of supply: only the split changes, never the total ──────────
  const intraShare = STATE_MIX[sellerState] ?? 0;
  const netTaxable = taxableValue - creditTaxable;
  const netTax = totalTax - creditTax;

  const intraTax = netTax * intraShare;
  const cgst = intraTax / 2;
  const sgst = intraTax / 2;
  const igst = netTax - intraTax;

  // ── B2C supplies by place of supply, as GSTR-1 expects ────────────────
  const stateRows = Object.entries(STATE_MIX).map(([code, share]) => {
    const t = netTaxable * share;
    const x = netTax * share;
    return {
      code, state: STATES[code] ?? code, share: share * 100,
      taxable: t,
      cgst: code === sellerState ? x / 2 : 0,
      sgst: code === sellerState ? x / 2 : 0,
      igst: code === sellerState ? 0 : x,
      tax: x,
      intra: code === sellerState,
    };
  }).sort((a, b) => b.taxable - a.taxable);

  if (OTHER_SHARE > 0.0001) {
    stateRows.push({
      code: '—', state: 'Other states', share: OTHER_SHARE * 100,
      taxable: netTaxable * OTHER_SHARE, cgst: 0, sgst: 0,
      igst: netTax * OTHER_SHARE, tax: netTax * OTHER_SHARE, intra: false,
    });
  }

  // ── TCS under s.52, collected by each marketplace operator ────────────
  const marketplaces = CHANNELS.filter(c => c.kind === 'marketplace').map(c => c.id);
  const tcsRows = groupBy(scope, 'channel')
    .filter(r => marketplaces.includes(r.key))
    .map(r => {
      // Operators collect 1% of the net value of taxable supplies made
      // through them, excluding returns.
      const netSupply = r.grossSales - r.cancelValue - r.discount - r.returnsValue;
      const blendedRate = 5; // TCS is on net supply value, not the GST slab
      const { taxable } = splitInclusive(netSupply, blendedRate);
      const tcs = taxable * 0.01;
      return {
        channel: r.key,
        channelName: CHANNEL_BY_ID[r.key]?.name ?? r.key,
        netSupply, taxable, tcs,
        cgst: r.key && sellerState ? 0 : 0,
        gstin: `${sellerState}${(CHANNEL_BY_ID[r.key]?.name ?? 'OP').slice(0, 3).toUpperCase()}0000O1Z${r.key.length}`,
      };
    })
    .sort((a, b) => b.tcs - a.tcs);

  const tcsTotal = tcsRows.reduce((s, r) => s + r.tcs, 0);

  return {
    company, companyId, sellerState, sellerStateName: STATES[sellerState] ?? sellerState,
    gstin: company?.gstin ?? '—',

    invoiceValue, taxableValue, totalTax,
    creditInvoice, creditTaxable, creditTax,
    netTaxable, netTax,
    cgst, sgst, igst,
    intraShare: intraShare * 100,

    rateSlabs: [...rateSlabs.values()].sort((a, b) => a.rate - b.rate),
    hsnSummary: [...hsnMap.values()].sort((a, b) => b.taxable - a.taxable),
    stateRows,
    tcsRows, tcsTotal,

    // GSTR-3B table 3.1(a): outward taxable supplies other than zero-rated.
    gstr3b: {
      outwardTaxable: netTaxable,
      integratedTax: igst, centralTax: cgst, stateTax: sgst,
      totalTax: netTax,
      netPayable: Math.max(0, netTax - tcsTotal),
      tcsCredit: tcsTotal,
    },
  };
}

/**
 * Retired: this took the month of `period.start`, so a quarterly or annual
 * return was labelled with a single month. Use `periodLabel` / `periodRange`
 * from lib/format.js, which handle every period shape.
 */

export const RETURN_TYPES = [
  { id: 'gstr1',  label: 'GSTR-1',  blurb: 'Outward supplies — B2C, HSN summary and credit notes' },
  { id: 'gstr3b', label: 'GSTR-3B', blurb: 'Monthly summary of liability and input credit' },
  { id: 'tcs',    label: 'TCS (s.52)', blurb: 'Tax collected by marketplace operators, claimable' },
  { id: 'itc',    label: 'Ad Invoices & ITC', blurb: 'Meta, Google and Amazon Ads invoices, and the input credit they carry' },
];
