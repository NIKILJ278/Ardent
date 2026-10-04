/* Render every route to a string in Node. Catches runtime errors a build can't.
 *
 * The app holds no sample data, so the harness seeds the live store itself with
 * a fixture in the backend's own payload shape — the same path a real sync
 * takes. Both states that matter are covered: a brand with data, and a brand
 * with none.
 */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

/* Providers read storage on mount; give them somewhere harmless to read. */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { seedLive, seedEmpty, BRAND_ID } = await import('./fixture.js');
const { SessionProvider } = await import('./src/state/Session.jsx');
const { AppStateProvider } = await import('./src/state/AppState.jsx');
const { DrilldownProvider } = await import('./src/state/Drilldown.jsx');
const { default: App } = await import('./src/App.jsx');

// The brand the session would have restored after a sign-in.
localStorage.setItem('ardent.brand', BRAND_ID);

const ROUTES = [
  '/overview', '/sales', '/ads', '/finance', '/goals', '/people',
  '/reconciliation', '/sources', '/reports', '/settings', '/help',
  '/inventory', '/customers', '/marketing', '/insights',
  '/watchlist', '/gst', '/sku-master',
];

let failed = 0;
const fail = (what, e) => {
  failed++;
  console.log(`  FAIL ${what}`);
  if (e) console.log(`       ${e.message.split('\n')[0]}`);
  if (e && process.env.VERBOSE) console.log(e.stack);
};

/* The drill stack is seeded directly — a state update during SSR would never
   re-render, so the panel has to be opened at mount. */
function page(path, drillNode) {
  return renderToString(
    <SessionProvider>
      <AppStateProvider>
        <DrilldownProvider initialStack={drillNode ? [drillNode] : []}>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </DrilldownProvider>
      </AppStateProvider>
    </SessionProvider>
  );
}

/* ── 1. Signed out, before anything else ───────────────────────────────── */

console.log('\n  — signed out —');
try {
  const html = page('/overview');
  if (!html.includes('Sign in')) throw new Error('the sign-in screen did not render');
  if (html.includes('Good morning') || html.includes('Good afternoon') || html.includes('Good evening')) {
    throw new Error('the dashboard rendered without a session');
  }
  console.log('  OK   signed out shows the sign-in screen, not the dashboard');
} catch (e) {
  fail('signed out', e);
}

/* Past the session gate for the rest of the run. Phase is internal to the
   provider, so the harness renders the pages themselves rather than faking a
   token; App's gate is what was just tested above. */
const { default: Shell } = await import('./src/components/shell/Shell.jsx');
const { default: DrilldownPanel } = await import('./src/components/drill/DrilldownPanel.jsx');

const PAGES = {
  '/overview': (await import('./src/pages/Overview.jsx')).default,
  '/sales': (await import('./src/pages/Sales.jsx')).default,
  '/ads': (await import('./src/pages/Ads.jsx')).default,
  '/goals': (await import('./src/pages/Goals.jsx')).default,
  '/sources': (await import('./src/pages/DataSources.jsx')).default,
  '/reports': (await import('./src/pages/Reports.jsx')).default,
  '/settings': (await import('./src/pages/Settings.jsx')).default,
  '/watchlist': (await import('./src/pages/Watchlist.jsx')).default,
  '/sku-master': (await import('./src/pages/Catalogue.jsx')).default,
};
const simple = await import('./src/pages/Simple.jsx');
Object.assign(PAGES, {
  '/finance': simple.Finance,
  '/reconciliation': simple.Reconciliation,
  '/gst': simple.Gst,
  '/inventory': simple.Inventory,
  '/people': simple.People,
  '/customers': simple.Customers,
  '/marketing': simple.Marketing,
  '/insights': simple.Insights,
  '/help': simple.Help,
});

function inApp(path, node, drillNode) {
  const Page = PAGES[path];
  return renderToString(
    <SessionProvider>
      <AppStateProvider>
        <DrilldownProvider initialStack={drillNode ? [drillNode] : []}>
          <MemoryRouter initialEntries={[path]}>
            <Shell>
              {node ?? <Page />}
              <DrilldownPanel />
            </Shell>
          </MemoryRouter>
        </DrilldownProvider>
      </AppStateProvider>
    </SessionProvider>
  );
}

/* ── 2. A brand with nothing synced ────────────────────────────────────── */

console.log('\n  — no data connected —');
seedEmpty();
try {
  const html = inApp('/overview');
  if (!html.includes('Connect your Shopify store')) throw new Error('the connect prompt did not render');
  console.log('  OK   the Overview asks you to connect a store');
} catch (e) {
  fail('empty overview', e);
}
try {
  const html = inApp('/sales');
  if (!html.includes('No sales data yet')) throw new Error('Sales did not show its empty state');
  console.log('  OK   Sales says there is no data yet');
} catch (e) {
  fail('empty sales', e);
}

/* ── 3. Every route, with data ─────────────────────────────────────────── */

console.log('\n  — every route, with data —');
const { rows } = seedLive();
console.log(`  seeded ${rows.length} fact rows`);

const BASELINE = inApp('/overview').length;

for (const path of ROUTES) {
  try {
    const html = inApp(path);
    if (html.length < 500) throw new Error(`suspiciously small output (${html.length} bytes)`);
    console.log(`  OK   ${path.padEnd(18)} ${String(html.length).padStart(7)} bytes`);
  } catch (e) {
    fail(path, e);
  }
}

/* ── 4. The drill chain, level by level ────────────────────────────────── */

const today = new Date();
const start = new Date(today); start.setMonth(start.getMonth() - 1); start.setHours(0, 0, 0, 0);
const end = new Date(today); end.setHours(23, 59, 59, 999);
const base = { start, end, company: BRAND_ID };

const DRILLS = [
  ['metric/netSales', { type: 'metric', label: 'Net Sales', metric: 'netSales', scope: base }],
  ['channel',  { type: 'channel',  label: 'Shopify', scope: { ...base, channel: 'shopify' } }],
  ['category', { type: 'category', label: 'Bedding', scope: { ...base, channel: 'shopify', category: 'Bedding' } }],
  ['product',  { type: 'product',  label: 'Malabar', scope: { ...base, product: 'gid://shopify/Product/1' } }],
];

console.log('\n  — drill-down levels —');
for (const [name, node] of DRILLS) {
  try {
    const html = inApp('/overview', null, node);
    if (html.length <= BASELINE) throw new Error(`drill panel did not render (${html.length} <= baseline ${BASELINE})`);
    if (!html.includes('drawer')) throw new Error('drawer markup missing from output');
    console.log(`  OK   ${name.padEnd(18)} ${String(html.length - BASELINE).padStart(7)} bytes of panel`);
  } catch (e) {
    fail(name, e);
  }
}

/* The variant level needs a real variant from the breakdown. */
try {
  const { skuBreakdown } = await import('./src/data/engine.js');
  const skus = skuBreakdown({ ...base, product: 'gid://shopify/Product/1' });
  if (!skus.length) throw new Error('the fixture produced no variants');
  const html = inApp('/overview', null, {
    type: 'sku', label: skus[0].code,
    scope: { ...base, product: 'gid://shopify/Product/1' },
    sku: skus[0],
  });
  if (!html.includes(skus[0].code)) throw new Error('the SKU code is missing from the panel');
  if (!html.includes('Individual order lines')) throw new Error('the panel does not say order lines are unavailable');
  console.log(`  OK   ${'sku/variant'.padEnd(18)} ${String(html.length - BASELINE).padStart(7)} bytes of panel`);
} catch (e) {
  fail('sku/variant', e);
}

/* ── 5. Honesty: nothing is invented where a source is missing ─────────── */

console.log('\n  — unconnected sources are stated, not filled —');
const strip = (h) => h.replace(/<!--\s*-->/g, '').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&');
const HONESTY = [
  ['/overview', 'Not connected', 'the realized-sales anchor is marked unknown'],
  ['/overview', 'needs gateway and courier costs', 'the ladder names what it is missing'],
  ['/ads', 'No ad platform is connected', 'Ads states it has no source'],
  ['/inventory', 'Stock on hand', 'Inventory states it has no source'],
  ['/gst', 'GST returns and input credit', 'GST states it has no source'],
  ['/reconciliation', 'Settlement reconciliation', 'Reconciliation states it has no source'],
];
for (const [path, needle, what] of HONESTY) {
  try {
    const html = strip(inApp(path));
    if (!html.includes(needle)) throw new Error(`"${needle}" not found`);
    console.log(`  OK   ${what}`);
  } catch (e) {
    fail(what, e);
  }
}

/* With costs missing, margin must disappear rather than read as zero.
   Checked on /finance now — the Overview's own Financial Position panel was
   removed for repeating Finance's numbers without adding a connected source
   of its own, so the honesty guarantee is tested where the figure still lives. */
try {
  seedLive({ costed: false });
  const html = strip(inApp('/finance'));
  if (!html.includes('Needs a cost per item on every product sold')) {
    throw new Error('the uncosted case does not explain the missing margin');
  }
  if (html.includes('Gross margin')) {
    throw new Error('the gross margin row rendered despite no unit costs existing');
  }
  console.log('  OK   uncosted sales withhold margin instead of reporting zero');
} catch (e) {
  fail('uncosted margin', e);
}

/* ── 6. Going global: every figure follows the store's own currency ────── */

console.log('\n  — currency follows the store —');
try {
  seedLive({ currency: 'INR' });
  const rupees = strip(inApp('/overview'));
  if (!rupees.includes('₹')) throw new Error('an Indian store did not render rupees');
  console.log('  OK   an INR store renders ₹');

  seedLive({ currency: 'USD' });
  const dollars = strip(inApp('/overview'));
  if (!dollars.includes('$')) throw new Error('a US store did not render dollars');
  if (dollars.includes('₹')) throw new Error('a US store still rendered rupees');
  // Lakhs and crores are an Indian convention, not a translation of the number.
  if (/\d\s(Cr|L)\b/.test(dollars)) throw new Error('a US store used the lakh/crore scale');
  console.log('  OK   a USD store renders $ and drops the lakh/crore scale');
} catch (e) {
  fail('currency', e);
}

console.log('\n  — markets the store sold into —');
try {
  seedLive({
    currency: 'USD',
    markets: [
      { currency: 'USD', orders: 120, total: 48000 },
      { currency: 'GBP', orders: 40, total: 12000 },
    ],
  });
  const html = strip(inApp('/overview'));
  if (!html.includes('Markets')) throw new Error('the markets card did not render');
  if (!html.includes('GBP')) throw new Error('the markets card did not name the second currency');
  console.log('  OK   a multi-currency store shows the markets it sold into');

  seedLive({ currency: 'USD' });
  if (strip(inApp('/overview')).includes('What your customers paid in')) {
    throw new Error('the markets card rendered for a single-currency store');
  }
  console.log('  OK   a single-currency store is not shown a markets card');
} catch (e) {
  fail('markets', e);
}

// Leave the store as the summary below expects to find it.
seedLive();

console.log(failed === 0 ? '\n  All routes and drill levels rendered.\n' : `\n  ${failed} failure(s).\n`);
process.exit(failed ? 1 : 0);
