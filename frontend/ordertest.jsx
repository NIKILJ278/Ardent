/* Orders are distinct: an order with several products is one order.
 * Run with `npm run ordertest`.
 */
import { setLive, setBrands } from './src/data/live.js';
import { totals, series, groupBy } from './src/data/engine.js';
import { BRAND_ID } from './fixture.js';
import { define } from './src/data/glossary.js';
import { computeGst, gstOn } from './src/data/gst.js';
import { comparisonWindow, comparisonExplainer } from './src/data/engine.js';
import { daysInclusive } from './src/lib/format.js';
import { subjectFromScope } from './src/data/watchlist.js';
import {
  normaliseOverviewLayout, normaliseOverviewKpis, overviewKpiValue,
  DEFAULT_OVERVIEW_LAYOUT, DEFAULT_OVERVIEW_KPIS, OVERVIEW_KPI_SLOTS, freshnessTone,
} from './src/data/overview.js';

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

// comparisonExplainer: "Previous Year" on 4 days of October reads as "all of
// last October" unless the label says otherwise.
const partialMonth = { start: new Date(2026, 9, 1), end: new Date(2026, 9, 4, 23, 59, 59, 999) };
const wholeMonth = { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30, 23, 59, 59, 999) };
const yearInfo = comparisonExplainer(partialMonth, 'year', 'month');
check('a partial month vs Previous Year is flagged', yearInfo.partial === true);
check('and spelled out with the real day count', yearInfo.label === 'Same 4 Days Last Year');
check('with the actual dates being compared, not just a word', /2025/.test(yearInfo.detail));
const prevInfo = comparisonExplainer(partialMonth, 'previous', 'month');
check('the same applies to "Previous Period"', prevInfo.partial === true && prevInfo.label === 'Same 4 Days Last Month');
check('a whole month is not flagged — the label already means what it says', comparisonExplainer(wholeMonth, 'year', 'month').partial === false);
check('a non-month preset is left alone — "Previous Period" against a week or a custom range names no calendar unit to contradict',
  comparisonExplainer(partialMonth, 'year', 'week').partial === false);
check('a forecast is never flagged as partial', comparisonExplainer(partialMonth, 'forecast', 'month').partial === false);
check('singular day count reads as "Day", not "Days"',
  comparisonExplainer({ start: new Date(2026, 9, 1), end: new Date(2026, 9, 1, 23, 59, 59, 999) }, 'year', 'month').label === 'Same 1 Day Last Year');

// subjectFromScope: a query scope (…variant) read back as a WatchButton
// subject (…sku) — a chart or table already filtered to some scope can offer
// "watch this" without restating the scope by hand.
const fullScope = { start: 0, end: 0, company: 'b1', channel: 'shopify', category: 'Bedding', subcategory: 'Bedsheets', product: 'p1', variant: 'v1' };
check('every scope field carries across, variant renamed to sku', JSON.stringify(subjectFromScope(fullScope)) ===
  JSON.stringify({ company: 'b1', channel: 'shopify', category: 'Bedding', subcategory: 'Bedsheets', product: 'p1', sku: 'v1' }));
check('extra fields (title, markedOn) are layered on top', subjectFromScope({ company: 'b1' }, { title: 'X', markedOn: '2026-09-12' }).title === 'X');
check('a company-only scope leaves the rest undefined, not null or missing keys dropped oddly',
  subjectFromScope({ company: 'b1' }).channel === undefined && subjectFromScope({ company: 'b1' }).sku === undefined);

// A customizable Overview: a saved layout/KPI list is made safe, and a
// removed section must stay removed — the bug this guards against is a
// normaliser that "helpfully" re-adds anything it doesn't recognise as
// already-saved, making a deliberate removal indistinguishable from a
// section the app has simply never asked this browser about before.
check('an unknown id is dropped from a saved layout', !normaliseOverviewLayout(['ladder', 'not-a-real-section']).includes('not-a-real-section'));
check('a saved layout with one section removed keeps it removed', !normaliseOverviewLayout(DEFAULT_OVERVIEW_LAYOUT.filter(id => id !== 'health')).includes('health'));
check('a saved order is kept exactly, not re-sorted back to default', JSON.stringify(normaliseOverviewLayout(['health', 'ladder'])) === JSON.stringify(['health', 'ladder']));
check('garbage input falls back to the default layout, not a blank page', normaliseOverviewLayout(null).length === DEFAULT_OVERVIEW_LAYOUT.length);
check('an empty layout (every section somehow dropped) also falls back, rather than rendering nothing', normaliseOverviewLayout([]).length > 0);

check('an unknown KPI id is dropped', !normaliseOverviewKpis(['growth', 'not-a-real-metric']).includes('not-a-real-metric'));
check(`more than ${OVERVIEW_KPI_SLOTS} chosen metrics is capped, not silently kept`, normaliseOverviewKpis(['growth', 'netSales', 'grossSales', 'grossMargin', 'orders']).length === OVERVIEW_KPI_SLOTS);
check('an empty KPI list falls back to the three defaults', JSON.stringify(normaliseOverviewKpis([])) === JSON.stringify(DEFAULT_OVERVIEW_KPIS));
check('a removed (but still known) KPI stays removed, same as a section', !normaliseOverviewKpis(['netSales']).includes('growth'));

const model = { netSales: 500, grossSales: 700, orders: 4, aov: 125, units: 9, returnPct: 3, cancelPct: 1, discountPct: 8, costComplete: true, grossMarginPct: 40 };
check('each KPI id reads its own field off the sales model', overviewKpiValue('netSales', model) === 500 && overviewKpiValue('orders', model) === 4 && overviewKpiValue('returnPct', model) === 3);
check('gross margin is withheld, not shown as a partial figure, when cost is incomplete', overviewKpiValue('grossMargin', { ...model, costComplete: false }) === null);
check('an unrecognised id reads as null rather than throwing', overviewKpiValue('not-a-real-metric', model) === null);

// The freshness badge escalates on the sync's own age, not a fixed look.
const now = new Date('2026-10-10T12:00:00Z');
check('a sync a few minutes old reads as good', freshnessTone(new Date('2026-10-10T11:50:00Z'), now) === 'good');
check('a sync just under 24h old still reads as good', freshnessTone(new Date('2026-10-09T13:00:00Z'), now) === 'good');
check('a sync 2 days old reads as a warning', freshnessTone(new Date('2026-10-08T12:00:00Z'), now) === 'warning');
check('a sync past 72h old reads as critical', freshnessTone(new Date('2026-10-06T11:00:00Z'), now) === 'critical');
check('no sync at all is neutral, not falsely "good"', freshnessTone(null, now) === 'neutral');

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log('\n  Order counting tests passed.');
