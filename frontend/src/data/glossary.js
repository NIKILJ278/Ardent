/* What every named figure means, in one place.
 *
 * A number with no definition invites the wrong reading, so any label the
 * dashboard shows can be looked up here (see <Term/>). Definitions describe
 * what THIS dashboard computes, including what it leaves out — Shopify's
 * "Total sales", for instance, adds shipping and tax, which Net sales here
 * deliberately does not.
 */
const G = {
  gmv: {
    name: 'GMV — Gross Merchandise Value',
    text: 'The full value of every item ordered, at listed price, before discounts, cancellations and returns come off. Excludes shipping and tax.',
    formula: 'Σ (unit price × quantity)',
  },
  grossSales: {
    name: 'Gross sales',
    text: 'Same as GMV: value of items ordered at listed price, before any deductions. Excludes shipping and tax.',
    formula: 'Σ (unit price × quantity)',
  },
  netSales: {
    name: 'Net sales',
    text: 'What is left of gross sales after discounts, cancellations and returns. Excludes shipping and tax, so it will be lower than Shopify’s “Total sales”.',
    formula: 'Gross − Discounts − Cancellations − Returns',
  },
  totalSales: {
    name: 'Total sales',
    text: 'Shopify’s headline figure: net sales plus shipping charged and taxes. This dashboard reports Net sales instead, which leaves shipping and tax out.',
    formula: 'Net sales + Shipping + Taxes',
  },
  realizedSales: {
    name: 'Final realized sales',
    text: 'Net sales after payment-gateway, courier and fulfilment costs — what the business actually keeps. Shown only when those costs are connected; otherwise it is left blank, not guessed.',
    formula: 'Net sales − Gateway − Courier − Fulfilment costs',
  },
  discounts: {
    name: 'Discounts',
    text: 'Value given away through discount codes and price reductions on orders that were not cancelled.',
  },
  cancellations: {
    name: 'Cancellations',
    text: 'Full value of orders cancelled before delivery. A cancelled order is removed once, in full — its discount and refund are not deducted a second time.',
  },
  returns: {
    name: 'Returns',
    text: 'Value refunded to customers for items sent back, on orders that were not cancelled.',
  },
  cancelRate: {
    name: 'Cancellation rate',
    text: 'Cancelled value as a share of gross sales.',
    formula: 'Cancellations ÷ Gross sales',
  },
  returnRate: {
    name: 'Return rate',
    text: 'Returned value as a share of gross sales.',
    formula: 'Returns ÷ Gross sales',
  },
  discountRate: {
    name: 'Discount %',
    text: 'Discounts as a share of gross sales.',
    formula: 'Discounts ÷ Gross sales',
  },
  orders: {
    name: 'Orders',
    text: 'Distinct orders placed. An order with several products counts once, not once per product.',
  },
  units: {
    name: 'Units',
    text: 'Total quantity of items ordered. One order of three items is 3 units.',
  },
  aov: {
    name: 'AOV — Average order value',
    text: 'Average net sales per order.',
    formula: 'Net sales ÷ Orders',
  },
  asp: {
    name: 'ASP — Average selling price',
    text: 'Average net sales per unit sold.',
    formula: 'Net sales ÷ Units',
  },
  cogs: {
    name: 'COGS — Cost of goods sold',
    text: 'What the items sold cost you, from the unit costs on your products. Left blank when any sold item has no cost, so it is never understated.',
    formula: 'Σ (unit cost × quantity)',
  },
  grossMargin: {
    name: 'Gross margin',
    text: 'What is left of net sales after the cost of the goods sold, before marketing, shipping, salaries and overheads.',
    formula: 'Net sales − COGS',
  },
  gateway: {
    name: 'Payment gateway charges',
    text: 'Fees taken by Razorpay, PayU and similar for processing online payments. Needs a gateway connected.',
  },
  logistics: {
    name: 'Shipping & courier costs',
    text: 'What couriers charged you to ship orders (not what customers paid for shipping). Needs a shipping aggregator connected.',
  },
  fulfilment: {
    name: 'Warehousing, fulfilment & other',
    text: 'Storage, packing and other operating costs. No source is connected yet, so this is unknown rather than zero.',
  },
  inventoryValue: {
    name: 'Inventory value',
    text: 'Stock on hand valued at cost.',
    formula: 'Σ (units in stock × unit cost)',
  },
  share: {
    name: 'Share',
    text: 'This row’s portion of the total shown.',
  },
  growth: {
    name: 'Growth',
    text: 'Change in net sales compared with the previous period of the same length.',
    formula: '(This period − Previous) ÷ Previous',
  },
  taxableValue: {
    name: 'Taxable value',
    text: 'Sales value before GST, net of discounts and returns. Where your store’s prices include tax, the GST is backed out at the assumed rate.',
    formula: 'Net sales − GST (tax-inclusive prices)',
  },
  estGst: {
    name: 'Estimated GST',
    text: 'GST worked out from order values at the single rate you choose. An estimate for planning: the orders carry no rate per product, and no customer state, so it is not split into CGST/SGST/IGST and is not a filing.',
    formula: 'Tax-inclusive: value × r ÷ (1 + r) · Tax-exclusive: value × r',
  },
  invoiceValue: {
    name: 'Invoice value',
    text: 'Taxable value plus the estimated GST — what customers were charged for goods and shipping, after discounts and returns.',
  },
  recordedTax: {
    name: 'Tax recorded by Shopify',
    text: 'The tax amount Shopify itself put on the orders. Often far lower than the estimate when the store was not set up to charge GST.',
  },
  cgstSgst: {
    name: 'CGST + SGST',
    text: 'GST on sales to customers in your own state, split equally between the Centre (CGST) and the State (SGST). Needs your GSTIN and the customer’s ship-to state.',
  },
  igst: {
    name: 'IGST',
    text: 'GST on sales to customers in another state, charged as one tax to the Centre. Needs your GSTIN and the customer’s ship-to state.',
  },
  unallocated: {
    name: 'Unallocated GST',
    text: 'GST that cannot yet be put under CGST/SGST or IGST because your GSTIN or the customer’s state is not known. It is kept apart rather than guessed.',
  },
  avgPerDay: {
    name: 'Average per day',
    text: 'Orders in the period divided by the number of days shown, including days with no orders.',
  },
  busiestDay: {
    name: 'Busiest day',
    text: 'The day with the most distinct orders in the period.',
  },
};

// Every wording the dashboard uses for a figure, mapped to its entry.
const ALIASES = {
  gmv: 'gmv', grossmerchandisevalue: 'gmv',
  grosssales: 'grossSales', gross: 'grossSales',
  netsales: 'netSales', net: 'netSales', sales: 'netSales',
  totalsales: 'totalSales',
  finalrealizedsales: 'realizedSales', realizedsales: 'realizedSales',
  discounts: 'discounts', discount: 'discounts',
  cancellations: 'cancellations', cancelledvalue: 'cancellations', cancelled: 'cancellations',
  returns: 'returns', returnvalue: 'returns',
  cancelrate: 'cancelRate', cancellationrate: 'cancelRate',
  returnrate: 'returnRate',
  discountrate: 'discountRate',
  orders: 'orders', ordersinperiod: 'orders',
  units: 'units', unitssold: 'units',
  aov: 'aov', averageordervalue: 'aov', revenueperorder: 'aov',
  asp: 'asp', averagesellingprice: 'asp',
  cogs: 'cogs', costofgoodssold: 'cogs', costofgoods: 'cogs',
  grossmargin: 'grossMargin',
  paymentgatewaycharges: 'gateway',
  shippingcouriercosts: 'logistics',
  warehousingfulfilmentother: 'fulfilment',
  inventoryvalue: 'inventoryValue',
  share: 'share', growth: 'growth',
  averageperday: 'avgPerDay', busiestday: 'busiestDay',
};

// "%" reads as "rate" so "Cancel %" and "Cancellation rate" meet in the middle.
const norm = (s) => String(s).toLowerCase().replace(/%/g, 'rate').replace(/&/g, '').replace(/[^a-z0-9]/g, '');

/** The definition for a label (or an explicit key), or null if there is none. */
export function define(labelOrKey) {
  if (labelOrKey == null) return null;
  if (G[labelOrKey]) return G[labelOrKey];
  const n = norm(labelOrKey);
  // "Cancel %" / "Return %" are rates; a bare "Cancel" / "Return" are not asked about.
  const key = ALIASES[n] ?? (n === 'cancelrate' ? 'cancelRate' : n === 'returnrate' ? 'returnRate' : null);
  return key ? G[key] : null;
}

export const GLOSSARY = G;
