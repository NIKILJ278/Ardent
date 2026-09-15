/* Render every route to a string in Node. Catches runtime errors a build can't. */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AppStateProvider } from './src/state/AppState.jsx';
import { DrilldownProvider } from './src/state/Drilldown.jsx';
import App from './src/App.jsx';

const ROUTES = [
  '/overview', '/sales', '/finance', '/goals', '/people',
  '/reconciliation', '/sources', '/reports', '/settings', '/help',
  '/inventory', '/customers', '/marketing', '/insights',
  '/watchlist', '/gst', '/sku-master',
];

/* The stack is seeded directly — a state update during SSR would never re-render. */
function run(path, drillNode) {
  return renderToString(
    <AppStateProvider>
      <DrilldownProvider initialStack={drillNode ? [drillNode] : []}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </DrilldownProvider>
    </AppStateProvider>
  );
}

const BASELINE = run('/overview').length;

let failed = 0;
for (const path of ROUTES) {
  try {
    const html = run(path);
    if (html.length < 500) throw new Error(`suspiciously small output (${html.length} bytes)`);
    console.log(`  OK   ${path.padEnd(18)} ${String(html.length).padStart(7)} bytes`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${path}`);
    console.log(`       ${e.message.split('\n')[0]}`);
    if (process.env.VERBOSE) console.log(e.stack);
  }
}

/* Exercise the full drill chain: metric → channel → category → product → sku. */
const start = new Date(2026, 8, 1);
const end = new Date(2026, 8, 30, 23, 59, 59);
const base = { start, end, company: 'kosha' };

const DRILLS = [
  ['metric',   { type: 'metric',   label: 'Revenue', metric: 'net', scope: base }],
  ['metric/ebitda', { type: 'metric', label: 'EBITDA', metric: 'ebitda', scope: base }],
  ['channel',  { type: 'channel',  label: 'Amazon',  scope: { ...base, channel: 'amazon' } }],
  ['category', { type: 'category', label: 'Bedding', scope: { ...base, channel: 'amazon', category: 'Bedding' } }],
  ['product',  { type: 'product',  label: 'Malabar', scope: { ...base, channel: 'amazon', product: 'ko-bed-01' } }],
];

console.log('\n  — drill-down levels —');
for (const [name, node] of DRILLS) {
  try {
    const html = run('/overview', node);
    // If the panel did not render, the output is just the page underneath it.
    if (html.length <= BASELINE) throw new Error(`drill panel did not render (${html.length} <= baseline ${BASELINE})`);
    if (!html.includes('drawer')) throw new Error('drawer markup missing from output');
    console.log(`  OK   ${name.padEnd(18)} ${String(html.length - BASELINE).padStart(7)} bytes of panel`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message.split('\n')[0]}`);
    if (process.env.VERBOSE) console.log(e.stack);
  }
}

/* The SKU level needs a real sku object from the breakdown. */
try {
  const { skuBreakdown } = await import('./src/data/engine.js');
  const skus = skuBreakdown({ ...base, channel: 'amazon', product: 'ko-bed-01' });
  const html = run('/overview', {
    type: 'sku', label: skus[0].code,
    scope: { ...base, channel: 'amazon', product: 'ko-bed-01' },
    sku: skus[0],
  });
  if (html.length <= BASELINE) throw new Error('drill panel did not render');
  if (!html.includes(skus[0].code)) throw new Error('SKU code missing from rendered transactions');
  console.log(`  OK   ${'sku/transactions'.padEnd(18)} ${String(html.length - BASELINE).padStart(7)} bytes of panel`);
} catch (e) {
  failed++;
  console.log(`  FAIL sku/transactions`);
  console.log(`       ${e.message.split('\n')[0]}`);
  if (process.env.VERBOSE) console.log(e.stack);
}

/* The watchlist has to render its readings and its meeting record, not just a
   page shell — a watch missing either half is useless three weeks on. */
console.log('\n  — watchlist —');
const strip = (h) => h.replace(/<!--\s*-->/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
const WANT = [
  ['seeded watch title', 'King-size bedsheet returns'],
  ['baseline figure',    'When marked'],
  ['discussion panel',   'What was discussed'],
  ['decision panel',     'What we decided to do'],
  // The most recent watch still awaiting review opens by default; for Kosha
  // that is the festive discount one.
  ['meeting name',       'Festive pricing call'],
  ['attendees',          'Arjun Nair'],
  ['review-due badge',   'Review due'],
  ['wrong-way counter',  'Going the wrong way'],
  ['close action',       'Close with a verdict'],
];
try {
  const html = strip(run('/watchlist'));
  for (const [what, needle] of WANT) {
    if (html.includes(needle)) console.log(`  OK   ${what}`);
    else { failed++; console.log(`  FAIL ${what} — "${needle}" not rendered`); }
  }
} catch (e) {
  failed++;
  console.log(`  FAIL watchlist render`);
  console.log(`       ${e.message.split('\n')[0]}`);
}

/* The watch action must be reachable from where the metric is actually read.
   The product matrix lives behind a tab, so it is rendered on its own rather
   than asserted against a page that does not open on that tab. */
try {
  const html = strip(run('/sku-master'));
  if (html.includes('Watch')) console.log('  OK   watch action on /sku-master');
  else { failed++; console.log('  FAIL watch action missing on /sku-master'); }
} catch (e) {
  failed++;
  console.log(`  FAIL /sku-master: ${e.message.split('\n')[0]}`);
}

try {
  const { MatrixTable } = await import('./src/components/sales/MatrixTable.jsx');
  const html = strip(renderToString(
    <AppStateProvider>
      <MemoryRouter>
        <MatrixTable scope={{ ...base, category: 'Bedding', subcategory: 'Bedsheets', product: 'ko-bed-01' }} />
      </MemoryRouter>
    </AppStateProvider>
  ));
  const checks = [
    ['blocks render', 'King'],
    ['returns line',  'Returns'],
    ['return % line', 'Return %'],
    ['watch action',  'Watch'],
  ];
  for (const [what, needle] of checks) {
    if (html.includes(needle)) console.log(`  OK   matrix ${what}`);
    else { failed++; console.log(`  FAIL matrix ${what}`); }
  }
} catch (e) {
  failed++;
  console.log(`  FAIL matrix render`);
  console.log(`       ${e.message.split('\n')[0]}`);
}

console.log(failed === 0 ? '\n  All routes and drill levels rendered.' : `\n  ${failed} failure(s).`);
process.exit(failed ? 1 : 0);
