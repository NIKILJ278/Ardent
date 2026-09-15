// Advertising purchase invoices — Meta, Google and Amazon Ads.
//
// Finance needs these for two things: booking the expense, and claiming input
// tax credit. The second is the harder one, because ITC may only be claimed
// once the invoice appears in GSTR-2B — a supplier who has not filed blocks the
// credit no matter what the invoice says.
//
// The taxable value of these invoices is generated from the same marketing cost
// the P&L carries, so the register can never total to a different number than
// the income statement.

import { series, financials } from './engine.js';
import { COMPANY_BY_ID } from './catalog.js';
import { rngFor } from '../lib/prng.js';
import { sellerStateCode, STATES } from './gst.js';

/** GST on advertising services is 18% and is not blocked under s.17(5). */
export const AD_GST_RATE = 18;

export const AD_PLATFORMS = {
  meta: {
    id: 'meta', name: 'Meta — Facebook & Instagram',
    entity: 'Facebook India Online Services Pvt Ltd',
    gstin: '29AACCF0553D1ZC', state: '29',
    share: 0.46,
    accounts: [
      { id: 'prospecting', name: 'Prospecting', weight: 0.62 },
      { id: 'retargeting', name: 'Retargeting', weight: 0.38 },
    ],
    prefix: 'FBIN',
  },
  google: {
    id: 'google', name: 'Google Ads',
    entity: 'Google India Pvt Ltd',
    gstin: '29AACCG0527D1Z8', state: '29',
    share: 0.38,
    accounts: [
      { id: 'search', name: 'Search — Brand', weight: 0.44 },
      { id: 'pmax',   name: 'Performance Max', weight: 0.56 },
    ],
    prefix: 'GIPL',
  },
  amazon_ads: {
    id: 'amazon_ads', name: 'Amazon Ads',
    entity: 'Amazon Advertising India Pvt Ltd',
    gstin: '29AAICA4872G1ZP', state: '29',
    share: 0.16,
    accounts: [
      { id: 'sponsored', name: 'Sponsored Products', weight: 1 },
    ],
    prefix: 'AAIPL',
  },
};

export const ITC_STATES = {
  matched:  { label: 'Matched in 2B', tone: 'good',     claimable: true },
  pending:  { label: 'Not in 2B',     tone: 'warning',  claimable: false },
  mismatch: { label: 'Value mismatch', tone: 'critical', claimable: false },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Indian financial year label for an invoice date: Apr–Mar. */
function fyLabel(d) {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/**
 * The purchase invoice register for a period.
 *
 * One invoice per ad account per month, which is how these platforms actually
 * bill. Taxable values are derived from the monthly marketing cost in the P&L,
 * so the register reconciles to the income statement exactly.
 */
export function adInvoices(scope, companyId) {
  const company = COMPANY_BY_ID[companyId];
  const buyerState = sellerStateCode(companyId);
  const months = series(scope, 'month');

  const rows = [];
  for (const bucket of months) {
    const d = new Date(bucket.ts);
    // Marketing cost for this month, on the same 10.5% basis as the P&L.
    const monthMarketing = bucket.net * 0.105;
    if (monthMarketing <= 0) continue;

    for (const p of Object.values(AD_PLATFORMS)) {
      const platformSpend = monthMarketing * p.share;

      for (const acct of p.accounts) {
        const taxable = platformSpend * acct.weight;
        if (taxable <= 0) continue;

        const rnd = rngFor(`adinv|${companyId}|${p.id}|${acct.id}|${bucket.date}`);
        // Supplier is in Karnataka, buyer in Maharashtra — inter-state, so the
        // whole tax is IGST. A same-state supplier would split CGST/SGST.
        const interState = p.state !== buyerState;
        const tax = taxable * (AD_GST_RATE / 100);

        const r = rnd();
        const itc = r < 0.85 ? 'matched' : r < 0.95 ? 'pending' : 'mismatch';

        // Invoices are raised on the last day of the billing month.
        const issued = new Date(d.getFullYear(), d.getMonth() + 1, 0);

        rows.push({
          id: `${p.id}-${acct.id}-${bucket.date}`,
          platform: p.id,
          platformName: p.name,
          supplier: p.entity,
          supplierGstin: p.gstin,
          supplierState: STATES[p.state] ?? p.state,
          account: acct.name,
          invoiceNo: `${p.prefix}/${fyLabel(issued)}/${String(issued.getMonth() + 1).padStart(2, '0')}/${String(100000 + Math.floor(rnd() * 899999))}`,
          invoiceDate: issued,
          period: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
          taxable,
          rate: AD_GST_RATE,
          cgst: interState ? 0 : tax / 2,
          sgst: interState ? 0 : tax / 2,
          igst: interState ? tax : 0,
          tax,
          total: taxable + tax,
          interState,
          placeOfSupply: STATES[buyerState] ?? buyerState,
          itcState: itc,
          itcClaimable: ITC_STATES[itc].claimable ? tax : 0,
        });
      }
    }
  }

  rows.sort((a, b) => b.invoiceDate - a.invoiceDate || a.platformName.localeCompare(b.platformName));

  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const byPlatform = Object.values(AD_PLATFORMS).map(p => {
    const own = rows.filter(r => r.platform === p.id);
    return {
      id: p.id, name: p.name, entity: p.entity, gstin: p.gstin,
      invoices: own.length,
      taxable: own.reduce((s, r) => s + r.taxable, 0),
      tax: own.reduce((s, r) => s + r.tax, 0),
      total: own.reduce((s, r) => s + r.total, 0),
      claimable: own.reduce((s, r) => s + r.itcClaimable, 0),
      blocked: own.reduce((s, r) => s + (r.tax - r.itcClaimable), 0),
    };
  }).filter(p => p.invoices > 0).sort((a, b) => b.taxable - a.taxable);

  const blockedRows = rows.filter(r => !ITC_STATES[r.itcState].claimable);

  return {
    rows, byPlatform, blockedRows,
    company, buyerState, buyerStateName: STATES[buyerState] ?? buyerState,
    buyerGstin: company?.gstin ?? '—',
    count: rows.length,
    taxable: sum('taxable'),
    tax: sum('tax'),
    total: sum('total'),
    cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'),
    itcClaimable: sum('itcClaimable'),
    itcBlocked: sum('tax') - sum('itcClaimable'),
  };
}

/** Cross-check: the register must total to the marketing cost in the P&L. */
export function adSpendReconciles(scope, companyId) {
  const reg = adInvoices(scope, companyId);
  const pnl = financials(scope).marketing;
  return { register: reg.taxable, pnl, delta: reg.taxable - pnl };
}
