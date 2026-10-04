/* Orders are distinct: an order with several products is one order.
 * Run with `npm run ordertest`.
 */
import { setLive, setBrands } from './src/data/live.js';
import { totals, series, groupBy } from './src/data/engine.js';
import { BRAND_ID } from './fixture.js';
import { define } from './src/data/glossary.js';
import { computeGst, gstOn } from './src/data/gst.js';
import { comparisonWindow } from './src/data/engine.js';
import { daysInclusive } from './src/lib/format.js';

const row = (date, product, variant, orderIds) => ({
  date, channel: 'shopify', category: 'Bedding', subcategory: 'Bedsheets',
  product, variant, units: orderIds.length, orders: orderIds.length, orderIds,
  grossSales: 1000 * orderIds.length, cancelValue: 0, discount: 0, returnsValue: 0,
  returnUnits: 0, cogs: null, fees: null, logistics: null,
});

// Day 1: orders 0,1,2 — order 0 holds two products, so 3 orders but 4 lines.
const rows = [
  row('2026-09-01', 'p1', 'v1', [0, 1]),
  row('2026-09-01', 'p2', 'v2', [0, 2]),
  row('2026-09-03', 'p1', 'v1', [3]),
];
setBrands([{ id: BRAND_ID, name: 'T', industry: 'Home', currency: 'INR', role: 'owner' }]);
setLive({
  rows, currency: 'INR', timezone: 'Asia/Kolkata', presentmentCurrencies: [],
  products: [], channels: [{ id: 'shopify', name: 'Shopify', kind: 'owned' }],
  range: { first: '2026-09-01', last: '2026-09-03' }, orderCount: 4, returnCount: 0,
  costCoverage: null, connections: [], lastSyncedAt: null, unavailable: [],
}, BRAND_ID);

let failed = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

const days = series({}, 'day');
check('1 Sep is 3 distinct orders, not 4 product lines', days.find(d => d.date === '2026-09-01')?.orders === 3);
check('the period total is 4 orders', totals({}).orders === 4);
check('a product still counts every order it appears on', groupBy({}, 'product').find(g => g.key === 'p1')?.orders === 3);
check('a day with no orders is simply absent from the series', !days.some(d => d.date === '2026-09-02'));

// Every figure the dashboard names carries a definition, incl. the ones asked for by name.
check('GMV is defined', /Gross Merchandise Value/.test(define('GMV')?.name));
check('Total sales is defined and says it adds shipping and tax', /shipping/i.test(define('Total sales')?.text ?? ''));
check('table headings find their definition', ['Net sales', 'Return %', 'Cancel %', 'AOV', 'ASP', 'Gross margin', 'Units', 'Orders'].every(l => define(l)));
check('an unknown label has none rather than a wrong one', define('Colour') === null);

// GST: one assumed rate, backed out of tax-inclusive prices and added to tax-exclusive ones.
const inc = gstOn(1050, 5, true), exc = gstOn(1000, 5, false);
check('tax-inclusive: 1050 at 5% is 1000 taxable + 50 GST', Math.abs(inc.taxable - 1000) < 1e-9 && Math.abs(inc.gst - 50) < 1e-9);
check('tax-exclusive: 1000 at 5% adds 50 GST', Math.abs(exc.gst - 50) < 1e-9 && Math.abs(exc.invoice - 1050) < 1e-9);
const gRows = [
  { day: '2026-08-31', category: 'Bedding', hsn: '6302', rate: 5,    inclusive: true,  supply: 'intra', net: 1050 },
  { day: '2026-09-01', category: 'Bedding', hsn: '6302', rate: 5,    inclusive: true,  supply: 'intra', net: 2100 },
  { day: '2026-09-02', category: 'Bath',    hsn: null,   rate: null, inclusive: false, supply: 'inter', net: 1000 },
  { day: '2026-09-03', category: 'Bath',    hsn: null,   rate: null, inclusive: false, supply: 'unknown', net: 1000 },
  { day: '2026-09-03', category: 'Shipping charged', hsn: null, rate: null, inclusive: false, supply: 'unknown', net: 100 },
];
const win = { start: '2026-09-01', end: '2026-09-30' };
const g = computeGst(gRows, [{ day: '2026-09-01', tax: 7 }, { day: '2026-08-31', tax: 3 }], 18, win);
check('the period window excludes days outside it', g.months.length === 1 && g.months[0].key === '2026-09');
check('own rate used where given (2100 incl. at 5% → 100), default elsewhere (180+180+18)', Math.abs(g.total.gst - 478) < 0.01);
check('same-state GST is half CGST, half SGST', Math.abs(g.total.cgst - 50) < 0.01 && Math.abs(g.total.sgst - 50) < 0.01);
check('other-state GST is IGST', Math.abs(g.total.igst - 180) < 0.01);
check('GST with an unknown state stays unallocated, never guessed', Math.abs(g.total.unallocated - 198) < 0.01);
check('the split adds back to the total', Math.abs(g.total.cgst + g.total.sgst + g.total.igst + g.total.unallocated - g.total.gst) < 0.02);
check('coverage counts value on own rate vs default (shipping excluded)', g.coverage.ownRate === 2100 && g.coverage.defaulted === 2000);
check('HSN summary is one line per code and rate, marking estimates', g.hsn.length === 2 && g.hsn.find(h => h.hsn === '6302').estimated === false && g.hsn.find(h => h.hsn == null).estimated === true);
check('recorded tax follows the same window', g.recordedTax === 7);
const none = computeGst(gRows, [], null, win);
check('with no default, unrated SKUs are counted but carry no tax', none.coverage.unrated === 2000 && Math.abs(none.total.gst - 100) < 0.01);
check('a 0% default gives no GST on those SKUs', computeGst(gRows, [], 0, win).total.gst === 100);

// Previous Period must be the same number of calendar days as the period
// itself — This Month 1–4 Oct (4 days) must compare against a 4-day window,
// not 5 (the bug: start at midnight vs end at 23:59:59.999 rounded up).
const thisMonth = {
  start: new Date(2026, 9, 1, 0, 0, 0, 0),
  end: new Date(2026, 9, 4, 23, 59, 59, 999),
};
check('daysInclusive counts calendar days, not a fuzzy 23:59:59.999 diff', daysInclusive(thisMonth.start, thisMonth.end) === 4);
const prev = comparisonWindow(thisMonth, 'previous');
check('the previous period is the same length (4 days: 27–30 Sep)', daysInclusive(prev.start, prev.end) === 4);
check('the previous period ends the day before the period starts', prev.end.getDate() === 30 && prev.end.getMonth() === 8);
check('the previous period starts 27 Sep, not 26 Sep', prev.start.getDate() === 27 && prev.start.getMonth() === 8);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\n  Order counting tests passed.');
