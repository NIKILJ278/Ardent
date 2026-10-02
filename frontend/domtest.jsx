/* Real DOM tests. Renders into jsdom and dispatches genuine events, so click
   behaviour is verified rather than assumed.

   The app ships with no sample data, so each block seeds the live store from
   the shared fixture — the same `setLive` path a real Shopify sync takes. */
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
// The providers read the bare `localStorage` global, not window's, and swallow
// failures — so without this the persistence assertions would silently pass on
// an empty store.
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { seedLive, seedEmpty, BRAND_ID } = await import('./fixture.js');
const { Modal } = await import('./src/components/ui/index.jsx');
const { SessionProvider } = await import('./src/state/Session.jsx');
const { AppStateProvider } = await import('./src/state/AppState.jsx');
const { DrilldownProvider } = await import('./src/state/Drilldown.jsx');
const { WatchButton } = await import('./src/components/watch/WatchButton.jsx');

// The brand a signed-in session would have restored.
localStorage.setItem('ardent.brand', BRAND_ID);

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

/** Every provider the pages expect, in the order the app nests them. */
function app(children, path = '/overview') {
  return (
    <SessionProvider>
      <AppStateProvider>
        <DrilldownProvider initialStack={[]}>
          <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
        </DrilldownProvider>
      </AppStateProvider>
    </SessionProvider>
  );
}

const click = (el) => act(() => {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
});
const typeInto = (el, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
const typeArea = (el, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
const keyIn = (el, key) => act(() => {
  el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
});

seedLive();

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
    company: BRAND_ID, category: 'Bath', subcategory: 'Bath Mats',
    product: 'gid://shopify/Product/2', title: 'Bamboo Fibre Bath Mat',
  };
  function Harness() {
    return app(
      <table>
        <tbody>
          <tr className="clickable" onClick={() => { rowClicks += 1; }}>
            <td><WatchButton subject={subject} iconOnly /></td>
          </tr>
        </tbody>
      </table>
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
  const m = mount(app(
    <WatchButton subject={{ company: BRAND_ID, category: 'Bath', title: 'Bath returns' }} />
  ));
  click(document.querySelector('button'));

  const inputs = [...document.querySelectorAll('.modal-wrap input.input')];
  typeInto(inputs[0], 'Bath mat returns after the packaging change');
  const areas = [...document.querySelectorAll('.modal-wrap textarea')];
  typeArea(areas[1], 'Switch to a boxed mailer and review in three weeks.');

  const save = [...document.querySelectorAll('.modal-wrap button')]
    .find(b => b.textContent.trim() === 'Start watching');
  check(!!save && !save.disabled, 'the save button enables once title and decision are filled');
  click(save);
  check(!document.querySelector('.modal-wrap'), 'the form closed on save');

  const stored = JSON.parse(dom.window.localStorage.getItem('ardent.state.v2') ?? '{}');
  const saved = (stored.watches ?? []).find(w => w.title.startsWith('Bath mat returns'));
  check(!!saved, 'the watch was persisted');
  check(saved?.decision?.length > 0, 'the decision was stored with it');
  check(!!saved?.reviewOn, `a review date was set (${saved?.reviewOn})`);
  check(saved?.company === BRAND_ID, 'it was filed against the active brand');

  m.unmount();
}

/* ── 4. Nothing renders before a store is connected ────────────────────── */

console.log('\n  — the empty state ─');
{
  const { default: Overview } = await import('./src/pages/Overview.jsx');
  seedEmpty();
  const m = mount(app(<Overview />));
  const text = document.body.textContent;
  check(text.includes('Connect your Shopify store'), 'the Overview asks for a store');
  check(!document.querySelector('.rev-ladder'), 'no revenue ladder is drawn without data');
  check(!/₹\s?\d/.test(text), 'no currency figure is shown at all');
  m.unmount();
  seedLive();
}

/* ── 5. Configurable Company Health ────────────────────────────────────── */

console.log('\n  — company health indicators —');
{
  const { default: Overview } = await import('./src/pages/Overview.jsx');
  dom.window.localStorage.clear();
  localStorage.setItem('ardent.brand', BRAND_ID);

  const m = mount(app(<Overview />));

  const card = document.querySelector('.health-card');
  check(!!card, 'the Company Health card rendered');
  check(card.textContent.includes('Based on your 5 key business indicators'),
    'the subtitle reads "Based on your 5 key business indicators"');

  const rows = [...document.querySelectorAll('.health-row .nm')].map(n => n.textContent.trim());
  const want = ['Sales & Growth', 'Profitability', 'Cash & Liquidity', 'Inventory', 'Channel Economics'];
  check(JSON.stringify(rows) === JSON.stringify(want), `the default set is right: ${rows.join(', ')}`);
  check(!rows.includes('Customers & Demand'), 'Customers & Demand is not shown by default');

  // Four of the five defaults need sources nothing has connected — they must
  // say so rather than carry a number.
  const na = [...document.querySelectorAll('.health-row .health-na')];
  check(na.length === 4, `the four unconnected indicators say so (${na.length})`);
  check(na.every(n => n.textContent.includes('Not connected — needs')),
    'each one names the source it needs');
  const scored = [...document.querySelectorAll('.health-row .sc')]
    .map(n => n.textContent.trim()).filter(t => t !== '—');
  check(scored.length === 1, `only the measurable indicator carries a score (${scored.join(', ')})`);

  // Open the breakdown.
  const link = [...document.querySelectorAll('.health-card button')]
    .find(b => b.textContent.includes('View health breakdown'));
  check(!!link, 'the breakdown link is present');
  click(link);
  const modal = document.querySelector('.modal-wrap');
  check(!!modal, 'the breakdown opened');
  check(modal.textContent.includes('not connected'),
    'the breakdown marks the figures it cannot read');

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

  const stored = JSON.parse(dom.window.localStorage.getItem('ardent.state.v2') ?? '{}');
  check(stored.healthConfig?.dimensions?.includes('operations'), 'the choice was persisted');

  m.unmount();
}

/* ── 6. The Overview reads as a command centre, top to bottom ──────────── */

console.log('\n  — overview command centre —');
{
  const { default: Overview } = await import('./src/pages/Overview.jsx');
  dom.window.localStorage.clear();
  localStorage.setItem('ardent.brand', BRAND_ID);

  const m = mount(app(<Overview />));
  const text = document.body.textContent;

  // The five questions, in the order the CEO should meet them.
  const order = ['Revenue', 'Product intelligence', 'GMV performance', 'Financial position', 'Company Health'];
  const at = order.map(t => text.indexOf(t));
  check(at.every(i => i >= 0), `every section is present: ${order.filter((_, i) => at[i] < 0).join(', ') || 'all'}`);
  check(at.every((v, i) => i === 0 || v > at[i - 1]), `sections appear in order: ${order.join(' → ')}`);

  // Section 1 — the ladder runs GMV to Final Realized Sales.
  check(text.includes('From GMV to final realized sales'), 'the revenue subtitle is right');
  const ladderLabels = [...document.querySelectorAll('.rev-ladder .ladder-label')]
    .map(n => n.textContent.replace('−', '').trim());
  check(ladderLabels[0] === 'GMV', `the ladder starts at GMV (${ladderLabels[0]})`);
  check(ladderLabels[ladderLabels.length - 1] === 'Final Realized Sales',
    `the ladder ends at Final Realized Sales (${ladderLabels[ladderLabels.length - 1]})`);
  check(ladderLabels.includes('Net Sales'), 'Net Sales is a subtotal in the middle');

  // The rows it cannot fill must be visibly unfilled, not quietly absent.
  const missing = [...document.querySelectorAll('.rev-ladder .ladder-row.missing')];
  check(missing.length >= 3, `the unmeasurable deductions are listed as missing (${missing.length})`);
  check(missing.every(r => r.textContent.includes('not connected')), 'each one is tagged "not connected"');
  check(!!document.querySelector('.rev-anchor-value.unknown'), 'final realized sales is marked unknown');

  // Section 2 — three product cards, none of them a table.
  check(text.includes('Top products') && text.includes('Major return products'),
    'the product cards render');
  check(document.querySelectorAll('.pi-row').length > 0, 'product rows render');

  // Section 4 — the financial strip carries only what orders can answer.
  const finLabels = [...document.querySelectorAll('.fin-fig-label')].map(n => n.textContent.trim());
  for (const label of ['Gross Sales', 'Net Sales', 'Cost of Goods', 'Gross Margin']) {
    check(finLabels.includes(label), `financial position carries ${label}`);
  }
  for (const label of ['Cash', 'Runway', 'Receivables', 'Payables']) {
    check(!finLabels.includes(label), `${label} is not presented as a figure`);
  }
  check(text.includes('Cash, runway, receivables, payables and net margin'),
    'the missing financial position is stated instead');

  // Freshness is present but quiet.
  const fresh = document.querySelector('.freshness');
  check(!!fresh && fresh.textContent.includes('Last synced'), `freshness shown: "${fresh?.textContent.trim()}"`);

  m.unmount();
}

/* ── 7. Revenue split states its attribution gap ───────────────────────── */

console.log('\n  — revenue split —');
{
  const { default: Sales } = await import('./src/pages/Sales.jsx');
  dom.window.localStorage.clear();
  localStorage.setItem('ardent.brand', BRAND_ID);

  const m = mount(app(<Sales />, '/sales'));
  const text = document.body.textContent;

  check(text.includes('Revenue split'), 'the revenue split card renders on Sales');
  const segs = [...document.querySelectorAll('.rs-seg')];
  check(segs.length === 1, `one honest bucket until attribution exists (${segs.length})`);
  check(Math.abs(parseFloat(segs[0].style.width) - 100) < 0.01, 'it spans the whole bar');
  check(text.includes('Organic, ad-driven and course revenue'),
    'the split it cannot make is named');
  check(!text.includes('ROAS'), 'no ROAS is claimed anywhere on the page');

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

/* ── 8. Currency follows the store, in a real DOM ──────────────────────── */

console.log('\n  — currency —');
{
  const { default: Overview } = await import('./src/pages/Overview.jsx');
  dom.window.localStorage.clear();
  localStorage.setItem('ardent.brand', BRAND_ID);

  seedLive({
    currency: 'USD',
    markets: [
      { currency: 'USD', orders: 120, total: 48000 },
      { currency: 'GBP', orders: 40, total: 12000 },
    ],
  });
  const m = mount(app(<Overview />, '/overview'));
  const text = document.body.textContent;

  check(text.includes('$'), 'a USD store renders dollar amounts');
  check(!text.includes('₹'), 'no rupee sign survives on a USD store');
  check(!/\d\s(Cr|L)\b/.test(text), 'the lakh/crore scale is not used for dollars');
  check(text.includes('Markets'), 'the markets card renders for a multi-currency store');
  check(text.includes('GBP'), 'each market currency is named');
  check(text.includes('rather than added'), 'the card states currencies are not summed');

  m.unmount();
  seedLive();
}

/* ── Date range picker ─────────────────────────────────────────────────── */
{
  console.log('\n  — date range picker —');
  const { DatePanel } = await import('./src/components/shell/DateRangePicker.jsx');
  const { resolvePeriod, PERIOD_PRESETS } = await import('./src/data/engine.js');
  const { TODAY } = await import('./src/lib/clock.js');
  const { iso } = await import('./src/lib/format.js');

  const calls = { range: null, preset: null, cancelled: false };
  const period = resolvePeriod('month');
  const m = mount(
    <DatePanel
      presets={PERIOD_PRESETS.filter(p => p.id !== 'custom')}
      periodId="month" period={period} minDate="2020-01-01"
      onPreset={(id) => { calls.preset = id; }}
      onRange={(a, b) => { calls.range = [a, b]; }}
      onCancel={() => { calls.cancelled = true; }}
    />,
  );
  const q = (sel) => [...m.host.querySelectorAll(sel)];
  const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const btn = (label) => q('button').find(b => b.textContent.trim() === label);
  const dayBtn = (d) => q('.drp-day').find(b => b.getAttribute('aria-label') === d && !b.classList.contains('outside'));
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const monthDay = (n) => fmt(new Date(TODAY.getFullYear(), TODAY.getMonth(), n));
  const apply = () => btn('Apply');

  check(q('.drp-grid').length === 1, 'exactly one calendar is shown, not two');
  check(q('.drp-input').length === 2, 'the start and end dates are typeable inputs');
  check(!!btn('Cancel') && !!apply(), 'Cancel and Apply are there');
  check(dayBtn(monthDay(1))?.classList.contains('edge'), 'the current period starts on the 1st, marked as the start');
  check(q('.drp-day.today').length === 1, 'today is marked');

  // A preset applies straight away; "Last 30 days" applies a range ending today.
  click(btn('This Quarter'));
  check(calls.preset === 'quarter', 'a preset in the rail applies that preset');
  click(btn('Last 30 days'));
  const span = (new Date(`${calls.range[1]}T00:00:00`) - new Date(`${calls.range[0]}T00:00:00`)) / 86400000;
  check(calls.range[1] === iso(TODAY) && span === 29, '"Last 30 days" is 30 days ending today');

  // Between: the first click starts a range, the second completes it.
  calls.range = null;
  click(btn('Between'));
  click(dayBtn(monthDay(1)));
  check(apply().disabled, 'Apply waits while only one end of the range is picked');
  const lastDay = TODAY.getDate() > 1 ? TODAY.getDate() : 1;
  click(dayBtn(monthDay(lastDay)));
  check(!apply().disabled, 'the second click completes the range');
  click(apply());
  check(
    calls.range?.[0] === iso(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)) &&
    calls.range?.[1] === iso(new Date(TODAY.getFullYear(), TODAY.getMonth(), lastDay)),
    'Apply hands back exactly the picked range',
  );

  // Typing: a real date moves the range, nonsense is put back.
  const setValue = (el, v) => act(() => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const blur = (el) => act(() => { el.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })); });
  const startInput = () => q('.drp-input')[0];
  setValue(startInput(), 'not a date'); blur(startInput());
  check(startInput().value !== 'not a date', 'a typed non-date is put back');
  setValue(startInput(), '2026-09-03'); blur(startInput());
  check(startInput().value === fmt(new Date(2026, 8, 3)), 'a typed date is accepted and shown in the same style');

  check(q('.drp-day').every(b => b.disabled === (new Date(b.getAttribute('aria-label')) > TODAY || new Date(b.getAttribute('aria-label')) < new Date(2020, 0, 1))),
    'days after today cannot be picked');

  click(btn('Cancel'));
  check(calls.cancelled, 'Cancel dismisses without applying');
  m.unmount();
}

console.log(failed === 0 ? '\n  DOM tests passed.\n' : `\n  ${failed} DOM failure(s).\n`);
process.exit(failed ? 1 : 0);
