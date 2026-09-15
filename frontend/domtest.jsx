/* Real DOM tests. Renders into jsdom and dispatches genuine events, so click
   behaviour is verified rather than assumed. */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node 24 defines navigator as a getter-only global.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator, configurable: true, writable: true,
});
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.Event = dom.window.Event;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
// AppState reads the bare `localStorage` global, not window's, and swallows
// failures — so without this the persistence assertions would silently pass on
// an empty store.
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { Modal } = await import('./src/components/ui/index.jsx');
const { AppStateProvider } = await import('./src/state/AppState.jsx');
const { WatchButton } = await import('./src/components/watch/WatchButton.jsx');

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

function mount(node) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root, unmount: () => act(() => root.unmount()) };
}

const click = (el) => act(() => {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
});
const typeInto = (el, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
const keyIn = (el, key) => act(() => {
  el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
});

/* ── 1. A modal must not leak events to whatever opened it ─────────────── */

console.log('\n  — modal is a boundary —');
{
  let rowClicks = 0;
  function Harness() {
    return (
      <table>
        <tbody>
          <tr onClick={() => { rowClicks += 1; }}>
            <td>
              <Modal title="Test modal" onClose={() => {}}>
                <input id="field" />
                <button id="inner">Inner button</button>
              </Modal>
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
  const m = mount(<Harness />);

  click(document.getElementById('inner'));
  check(rowClicks === 0, `clicking inside the modal does not reach the row (${rowClicks} row clicks)`);

  typeInto(document.getElementById('field'), 'hello');
  keyIn(document.getElementById('field'), 'a');
  check(rowClicks === 0, `typing inside the modal does not reach the row (${rowClicks} row clicks)`);

  click(document.querySelector('.modal2-head'));
  check(rowClicks === 0, `clicking the modal header does not reach the row (${rowClicks} row clicks)`);

  // The row itself must still work.
  click(document.querySelector('td'));
  check(rowClicks === 1, 'the row still responds to its own clicks');

  // And the modal must actually be out of the table, in the document body.
  const wrap = document.querySelector('.modal-wrap');
  check(wrap?.parentElement === document.body, 'the modal is attached to the document body');

  m.unmount();
}

/* ── 2. The real thing: the eye icon inside a clickable row ────────────── */

console.log('\n  — watch button inside a clickable row —');
{
  let rowClicks = 0;
  const subject = {
    company: 'kosha', category: 'Bath', subcategory: 'Bath Mats',
    product: 'ko-bath-02', title: 'Bamboo Fibre Bath Mat',
  };
  function Harness() {
    return (
      <AppStateProvider>
        <table>
          <tbody>
            <tr className="clickable" onClick={() => { rowClicks += 1; }}>
              <td><WatchButton subject={subject} iconOnly /></td>
            </tr>
          </tbody>
        </table>
      </AppStateProvider>
    );
  }
  const m = mount(<Harness />);

  const eye = document.querySelector('tr button');
  check(!!eye, 'the eye button rendered');

  click(eye);
  check(rowClicks === 0, `clicking the eye does not open the row panel (${rowClicks} row clicks)`);
  check(!!document.querySelector('.modal-wrap'), 'the watch form opened');

  const title = document.querySelector('.modal-wrap input.input');
  check(!!title, 'the form has its first field');
  typeInto(title, 'Bath mat returns after the fix');
  check(rowClicks === 0, `typing in the form does not open the row panel (${rowClicks} row clicks)`);

  const select = document.querySelector('.modal-wrap select');
  click(select);
  check(rowClicks === 0, `clicking a dropdown does not open the row panel (${rowClicks} row clicks)`);

  const cancel = [...document.querySelectorAll('.modal-wrap button')]
    .find(b => b.textContent.trim() === 'Cancel');
  click(cancel);
  check(rowClicks === 0, `pressing Cancel does not open the row panel (${rowClicks} row clicks)`);
  check(!document.querySelector('.modal-wrap'), 'the form closed');

  m.unmount();
}

/* ── 3. Saving a watch actually records it ─────────────────────────────── */

console.log('\n  — the form saves —');
{
  function Harness() {
    return (
      <AppStateProvider>
        <WatchButton
          subject={{ company: 'kosha', category: 'Bath', title: 'Bath returns' }}
        />
      </AppStateProvider>
    );
  }
  const m = mount(<Harness />);
  click(document.querySelector('button'));

  const inputs = [...document.querySelectorAll('.modal-wrap input.input')];
  typeInto(inputs[0], 'Bath mat returns after the packaging change');
  const areas = [...document.querySelectorAll('.modal-wrap textarea')];
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(areas[1], 'Switch to a boxed mailer and review in three weeks.');
    areas[1].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  const save = [...document.querySelectorAll('.modal-wrap button')]
    .find(b => b.textContent.trim() === 'Start watching');
  check(!!save && !save.disabled, 'the save button enables once title and decision are filled');
  click(save);
  check(!document.querySelector('.modal-wrap'), 'the form closed on save');

  const stored = JSON.parse(dom.window.localStorage.getItem('ardent.state.v1') ?? '{}');
  const saved = (stored.watches ?? []).find(w => w.title.startsWith('Bath mat returns'));
  check(!!saved, 'the watch was persisted');
  check(saved?.decision?.length > 0, 'the decision was stored with it');
  check(!!saved?.reviewOn, `a review date was set (${saved?.reviewOn})`);

  m.unmount();
}

/* ── 4. Configurable Company Health ────────────────────────────────────── */

console.log('\n  — company health indicators —');
{
  const { default: Overview } = await import('./src/pages/Overview.jsx');
  const { DrilldownProvider } = await import('./src/state/Drilldown.jsx');
  const { MemoryRouter } = await import('react-router-dom');

  dom.window.localStorage.clear();
  const m = mount(
    <AppStateProvider>
      <DrilldownProvider initialStack={[]}>
        <MemoryRouter initialEntries={['/overview']}>
          <Overview />
        </MemoryRouter>
      </DrilldownProvider>
    </AppStateProvider>
  );

  const card = document.querySelector('.health-card');
  check(!!card, 'the Company Health card rendered');
  check(card.textContent.includes('Based on your 5 key business indicators'),
    'the subtitle reads "Based on your 5 key business indicators"');

  const rows = [...document.querySelectorAll('.health-row .nm')].map(n => n.textContent.trim());
  check(rows.length === 5, `the card shows 5 indicators (${rows.length})`);
  const want = ['Sales & Growth', 'Profitability', 'Cash & Liquidity', 'Inventory', 'Channel Economics'];
  check(JSON.stringify(rows) === JSON.stringify(want), `the default set is right: ${rows.join(', ')}`);
  check(!rows.includes('Customers & Demand'), 'Customers & Demand is not shown by default');

  // Scores are rendered next to each bar.
  const scores = [...document.querySelectorAll('.health-row .sc')].map(n => Number(n.textContent));
  check(scores.length === 5 && scores.every(n => n > 0 && n <= 100),
    `each indicator carries a score (${scores.join(', ')})`);

  // Open the breakdown.
  const link = [...document.querySelectorAll('.health-card button')]
    .find(b => b.textContent.includes('View health breakdown'));
  check(!!link, 'the breakdown link is present');
  click(link);
  const modal = document.querySelector('.modal-wrap');
  check(!!modal, 'the breakdown opened');
  check(modal.textContent.includes('Inventory turnover') || modal.textContent.includes('Turnover'),
    'the breakdown shows the metrics behind a dimension');

  // Switch to the chooser and confirm all ten are offered.
  const chooseTab = [...modal.querySelectorAll('.segmented button')]
    .find(b => b.textContent.trim() === 'Choose indicators');
  check(!!chooseTab, 'the chooser tab is present');
  click(chooseTab);
  const cards = [...document.querySelectorAll('.hd-card')];
  check(cards.length === 10, `all ten dimensions are offered (${cards.length})`);
  check(document.querySelector('.modal-wrap').textContent.includes('Are we growing?'),
    'each dimension shows its CEO question');
  check(cards.filter(c => c.className.includes('on')).length === 5, 'five are marked as chosen');
  check(cards.filter(c => c.disabled).length === 5, 'the unchosen five are locked until one is removed');

  // Swap Inventory out for Operations, then save.
  const remove = [...document.querySelectorAll('.hd-chosen')]
    .find(r => r.textContent.includes('Inventory'))
    ?.querySelector('button[title="Remove"]');
  check(!!remove, 'a chosen indicator can be removed');
  click(remove);
  check([...document.querySelectorAll('.hd-chosen')].length === 4, 'four remain after removing one');

  const ops = [...document.querySelectorAll('.hd-card')].find(c => c.textContent.includes('Operations'));
  click(ops);
  check([...document.querySelectorAll('.hd-chosen')].length === 5, 'a replacement can be added');

  const save = [...document.querySelectorAll('.modal-wrap button')]
    .find(b => b.textContent.trim() === 'Save indicators');
  check(!!save && !save.disabled, 'the save button is enabled once five are chosen');
  click(save);
  check(!document.querySelector('.modal-wrap'), 'the modal closed on save');

  const after = [...document.querySelectorAll('.health-row .nm')].map(n => n.textContent.trim());
  check(after.includes('Operations') && !after.includes('Inventory'),
    `the card now reads: ${after.join(', ')}`);

  const stored = JSON.parse(dom.window.localStorage.getItem('ardent.state.v1') ?? '{}');
  check(stored.healthConfig?.dimensions?.includes('operations'), 'the choice was persisted');

  m.unmount();
}

/* ── 5. The Overview reads as a command centre, top to bottom ──────────── */

console.log('\n  — overview command centre —');
{
  const { default: Overview } = await import('./src/pages/Overview.jsx');
  const { DrilldownProvider } = await import('./src/state/Drilldown.jsx');
  const { MemoryRouter } = await import('react-router-dom');

  dom.window.localStorage.clear();
  const m = mount(
    <AppStateProvider>
      <DrilldownProvider initialStack={[]}>
        <MemoryRouter initialEntries={['/overview']}>
          <Overview />
        </MemoryRouter>
      </DrilldownProvider>
    </AppStateProvider>
  );

  const text = document.body.textContent;

  // The five questions, in the order the CEO should meet them.
  const order = ['Revenue', 'Product intelligence', 'GMV performance', 'Financial position', 'Company Health'];
  const at = order.map(t => text.indexOf(t));
  check(at.every(i => i >= 0), `every section is present: ${order.filter((_, i) => at[i] < 0).join(', ') || 'all'}`);
  check(at.every((v, i) => i === 0 || v > at[i - 1]),
    `sections appear in order: ${order.join(' → ')}`);

  // Section 1 — the ladder runs GMV to Final Realized Sales.
  check(text.includes('From GMV to final realized sales'), 'the revenue subtitle is right');
  const ladderLabels = [...document.querySelectorAll('.rev-ladder .ladder-label')].map(n => n.textContent.replace('−', '').trim());
  check(ladderLabels[0] === 'GMV', `the ladder starts at GMV (${ladderLabels[0]})`);
  check(ladderLabels[ladderLabels.length - 1] === 'Final Realized Sales',
    `the ladder ends at Final Realized Sales (${ladderLabels[ladderLabels.length - 1]})`);
  check(ladderLabels.includes('Net Sales'), 'Net Sales is a subtotal in the middle');
  const anchors = [...document.querySelectorAll('.rev-anchor-label')].map(n => n.textContent.trim());
  check(anchors.length === 3, `three anchor figures are lifted out (${anchors.join(', ')})`);

  // The hierarchy has to be visible, not just present.
  const lead = document.querySelector('.rev-anchor.lead .rev-anchor-value');
  const final = document.querySelector('.rev-anchor-value.final');
  check(!!lead && !!final, 'GMV and Final Realized carry their own emphasis classes');

  // Section 2 — three product cards, none of them a table.
  check(text.includes('Top products') && text.includes('Least-selling products')
    && text.includes('Major return products'), 'all three product cards render');
  check(document.querySelectorAll('.pi-row').length > 0, 'product rows render');
  const piCards = [...document.querySelectorAll('.card2')].filter(c => c.textContent.includes('Top products'));
  check(piCards.length > 0 && !piCards[0].querySelector('table'), 'the product card is a list, not a table');

  // Section 3 — event pointers explain the movements.
  const pointers = [...document.querySelectorAll('.ev-item')];
  check(pointers.length > 0, `${pointers.length} event pointer(s) under the GMV chart`);
  check(pointers.some(p => p.textContent.includes('%')), 'each pointer quotes a movement');

  // The readings interpret rather than restate.
  const reads = [...document.querySelectorAll('.reading')];
  check(reads.length > 0, `${reads.length} reading(s) rendered`);
  check(reads.some(r => r.querySelector('.reading-impact')), 'at least one reading quantifies its impact');

  // Section 4 — the compact financial strip, with the metrics asked for.
  for (const label of ['Cash', 'Runway', 'Receivables', 'Payables', 'Net Margin', 'Contribution Margin']) {
    const found = [...document.querySelectorAll('.fin-fig-label')].some(n => n.textContent.trim() === label);
    check(found, `financial position carries ${label}`);
  }

  // Freshness is present but quiet.
  const fresh = document.querySelector('.freshness');
  check(!!fresh && fresh.textContent.includes('Last updated'), `freshness shown: "${fresh?.textContent.trim()}"`);

  // Section 5 — health is last, and shows only the chosen five.
  check(document.querySelectorAll('.health-row').length === 5, 'company health still shows exactly five');
  check(text.indexOf('Company Health') > text.indexOf('Financial position'),
    'company health closes the page');

  m.unmount();
}

/* ── 6. Revenue split and the ads system ───────────────────────────────── */

console.log('\n  — revenue split —');
{
  const { default: Sales } = await import('./src/pages/Sales.jsx');
  const { DrilldownProvider } = await import('./src/state/Drilldown.jsx');
  const { MemoryRouter } = await import('react-router-dom');

  dom.window.localStorage.clear();
  const m = mount(
    <AppStateProvider>
      <DrilldownProvider initialStack={[]}>
        <MemoryRouter initialEntries={['/sales']}><Sales /></MemoryRouter>
      </DrilldownProvider>
    </AppStateProvider>
  );

  const text = document.body.textContent;
  check(text.includes('Revenue split'), 'the revenue split card renders on Sales');
  for (const label of ['Organic Revenue', 'Ad-Driven Revenue', 'Course Revenue']) {
    check(text.includes(label), `the split names ${label}`);
  }
  // The three shares must add to the whole width of the bar.
  const segs = [...document.querySelectorAll('.rs-seg')];
  check(segs.length === 3, `three segments in the bar (${segs.length})`);
  const widths = segs.map(sg => parseFloat(sg.style.width));
  const total = widths.reduce((a, b) => a + b, 0);
  check(Math.abs(total - 100) < 0.01, `segments span exactly 100% (${total.toFixed(2)}%)`);

  // The channel selector is present and switches the global filter.
  const chips = [...document.querySelectorAll('.rs-channels .chip')];
  check(chips.length > 2, `${chips.length} channel choices offered`);
  const amazon = chips.find(c => c.textContent.trim() === 'Amazon');
  check(!!amazon, 'Amazon is selectable');
  click(amazon);
  check(document.querySelector('.rs-channels .chip.active')?.textContent.trim() === 'Amazon',
    'selecting a channel marks it active');

  // The value/percent toggle changes the reading, not the bar.
  const before = document.querySelector('.rs-value')?.textContent;
  const pctBtn = [...document.querySelectorAll('.segmented button')].find(b => b.textContent.trim() === '%');
  check(!!pctBtn, 'a % toggle is present');
  click(pctBtn);
  const after = document.querySelector('.rs-value')?.textContent;
  check(before !== after, `the toggle switches the reading (${before} → ${after})`);
  check(after?.includes('%'), 'percent mode shows a percentage');

  m.unmount();
}

console.log('\n  — ads —');
{
  const { default: Ads } = await import('./src/pages/Ads.jsx');
  const { DrilldownProvider } = await import('./src/state/Drilldown.jsx');
  const { MemoryRouter } = await import('react-router-dom');

  dom.window.localStorage.clear();
  const m = mount(
    <AppStateProvider>
      <DrilldownProvider initialStack={[]}>
        <MemoryRouter initialEntries={['/ads']}><Ads /></MemoryRouter>
      </DrilldownProvider>
    </AppStateProvider>
  );

  // All eight subsections are reachable.
  const tabs = [...document.querySelectorAll('.segmented button')].map(b => b.textContent.trim());
  for (const want of ['General', 'Ad Spend', 'Analytics', 'Channels', 'Products', 'Returns', 'Category', 'New Products']) {
    check(tabs.includes(want), `the ${want} section is reachable`);
  }

  // The headline four.
  const kpis = [...document.querySelectorAll('.ad-kpi-label')].map(n => n.textContent.trim());
  check(kpis.includes('ROAS') && kpis.includes('Ad Spend') && kpis.includes('Ad Revenue'),
    `headline metrics present: ${kpis.join(', ')}`);

  const visit = (label) => {
    const btn = [...document.querySelectorAll('.segmented button')].find(b => b.textContent.trim() === label);
    click(btn);
    return document.body.textContent;
  };

  let t = document.body.textContent;
  for (const metric of ['TACOS', 'ACOS', 'CPC', 'CTR', 'Impressions', 'Clicks', 'Conversion Rate']) {
    check(t.includes(metric), `General carries ${metric}`);
  }

  t = visit('Ad Spend');
  check(t.includes('Spend by marketplace') && t.includes('Spend by category') && t.includes('Spend by campaign'),
    'Ad Spend breaks down by marketplace, category and campaign');
  check(t.includes('Efficiency'), 'Ad Spend contrasts share of spend against share of revenue');

  t = visit('Analytics');
  check(t.includes('Add to cart') && t.includes('The funnel'), 'Analytics shows the funnel including add-to-cart');

  t = visit('Channels');
  check(t.includes('Marketplace comparison'), 'Channels compares marketplaces');

  t = visit('Products');
  check(t.includes('High spend, low return') && t.includes('Low spend, high return'),
    'Products flags both problem quadrants');
  check(t.includes('Net Realized'), 'Products shows net realized after returns');

  t = visit('Returns');
  check(t.includes('ROAS after returns'), 'Returns restates ROAS after returns');
  check(t.includes('Returns by marketplace') && t.includes('Returns by category') && t.includes('Returns by product'),
    'Returns splits by marketplace, category and product');

  visit('Category');
  const rows = [...document.querySelectorAll('.tbl tbody tr')];
  check(rows.length > 0, `category table has ${rows.length} rows`);
  click(rows[0]);
  check(!!document.querySelector('.crumbs'), 'drilling a category shows a breadcrumb');
  const crumbText = document.querySelector('.crumbs')?.textContent ?? '';
  check(crumbText.includes('All categories'), `breadcrumb reads: ${crumbText.trim()}`);

  t = visit('New Products');
  check(t.includes('First 30 days') && t.includes('Days 31 to 60'),
    'New Products splits the two cohorts');

  m.unmount();
}

console.log(failed === 0 ? '\n  DOM tests passed.\n' : `\n  ${failed} DOM failure(s).\n`);
process.exit(failed ? 1 : 0);
