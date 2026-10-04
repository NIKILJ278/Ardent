import { useMemo, useState } from 'react';
import { ChevronRight, Home, Lock, Plug } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppState.jsx';
import { useDrill } from '../state/Drilldown.jsx';
import {
  salesModel, groupBy, series, skuBreakdown, forecastFor,
  comparisonExplainer, isHistoricalComparison,
} from '../data/engine.js';
import { salesFlags, worstFlag } from '../data/salesFlags.js';
import { PERM } from '../state/permissions.js';
import { CHANNEL_BY_ID, PRODUCT_BY_ID, COMPANY_BY_ID, channelsFor } from '../data/catalog.js';
import { live } from '../data/live.js';
import { money, num, pct, fmtDate, changePct } from '../lib/format.js';
import { Card, Delta, DataTable, Segmented, Pill, Empty } from '../components/ui/index.jsx';
import { NotConnected } from '../components/ui/NotConnected.jsx';
import { RevenueTrend } from '../components/charts/index.jsx';
import {
  Waterfall, Metric, UnitEconomics, FlagRow, MoneyPct, WeeklySales,
} from '../components/sales/Blocks.jsx';
import { MatrixTable } from '../components/sales/MatrixTable.jsx';
import { RevenueSplit } from '../components/sales/RevenueSplit.jsx';
import { DailyOrders } from '../components/sales/DailyOrders.jsx';
import { WatchButton } from '../components/watch/WatchButton.jsx';
import { subjectFromScope } from '../data/watchlist.js';
import { SalesToggleSection, MarketplaceEconomics } from '../components/sales/ChannelEconomics.jsx';
import { channelColor } from '../lib/channels.js';
import { buildEventMarkers } from '../lib/markers.js';

/** Company → Channel → Category → Subcategory → Product → Variant. */
const LEVELS = [
  { dim: 'channel',     label: 'Channel' },
  { dim: 'category',    label: 'Category' },
  { dim: 'subcategory', label: 'Subcategory' },
  { dim: 'product',     label: 'Product' },
];

const SECTIONS = [
  { id: 'performance', label: 'Sales Performance', perm: PERM.SALES_PERFORMANCE },
  { id: 'daily',       label: 'Daily Orders',      perm: PERM.SALES_PERFORMANCE },
  { id: 'channels',    label: 'Channel Performance', perm: PERM.CHANNEL_PERFORMANCE },
  { id: 'economics',   label: 'Channel Economics', perm: PERM.CHANNEL_ECONOMICS },
  { id: 'unit',        label: 'Unit Economics',    perm: PERM.UNIT_ECONOMICS },
  { id: 'products',    label: 'Product Performance', perm: PERM.SALES_PERFORMANCE },
  { id: 'diagnostics', label: 'Diagnostics',       perm: PERM.DIAGNOSTICS },
];

const nameFor = (dim, key) =>
  dim === 'channel'  ? (CHANNEL_BY_ID[key]?.name ?? key)
  : dim === 'product' ? (PRODUCT_BY_ID[key]?.name ?? key)
  : key;

function NoSalesYet() {
  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Sales</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          From gross sales to what the company keeps.
        </p>
      </div>
      <Card>
        <Empty icon={Plug} title="No sales data yet">
          Connect your store and run a sync — every figure on this page is summed from your own
          orders.
          <div style={{ marginTop: 14 }}>
            <Link to="/sources" className="btn btn-primary">Connect a store</Link>
          </div>
        </Empty>
      </Card>
    </div>
  );
}

export default function Sales() {
  const { scope, prevScope, companyScope, companyId, channelId, setChannelId,
          comparison, period, periodId, can, events, notes, goals, dataVersion } = useApp();
  const { open } = useDrill();
  const [tab, setTab] = useState('performance');
  const [grain, setGrain] = useState('day');
  const [path, setPath] = useState([]);

  const drillScope     = useMemo(() => path.reduce((a, s) => ({ ...a, [s.dim]: s.key }), scope), [scope, path]);
  const drillPrevScope = useMemo(() => path.reduce((a, s) => ({ ...a, [s.dim]: s.key }), prevScope), [prevScope, path]);

  const m  = useMemo(() => salesModel(drillScope),     [drillScope]);
  const pm = useMemo(() => salesModel(drillPrevScope), [drillPrevScope]);

  const growth = changePct(m.netSales, pm.netSales);

  // A target is something you set on the Goals page, not a multiple of what you
  // already sold. Without one there is nothing honest to measure against.
  const netGoal = useMemo(
    () => goals.find(g => g.company === companyId && g.metric === 'net' && g.targetValue),
    [goals, companyId]
  );
  const target = netGoal ? Number(netGoal.targetValue) : null;
  const achievement = target ? (m.netSales / target) * 100 : null;

  const flags = useMemo(
    () => salesFlags(m, { growthPct: growth, achievementPct: achievement, can }),
    [m, growth, achievement, can]
  );

  const usedDims = new Set(path.map(s => s.dim));
  if (channelId !== 'all') usedDims.add('channel');
  const level = LEVELS.find(l => !usedDims.has(l.dim));
  const atVariant = !level;

  /** Rows for the current breakout level, each with the full model. */
  const rows = useMemo(() => {
    if (!level) return [];
    return groupBy(drillScope, level.dim).map(r => {
      const rm = salesModel({ ...drillScope, [level.dim]: r.key });
      const rp = salesModel({ ...drillPrevScope, [level.dim]: r.key });
      const g = rp.netSales ? changePct(rm.netSales, rp.netSales) : null;
      return {
        id: r.key, key: r.key, dim: level.dim,
        name: nameFor(level.dim, r.key),
        color: level.dim === 'channel' ? channelColor(r.key) : 'var(--series-1)',
        ...rm, growth: g,
        flag: worstFlag(salesFlags(rm, { growthPct: g, can })),
      };
    });
  }, [drillScope, drillPrevScope, level, can]);

  /** Every channel, always company-wide, for the comparison views. */
  const channelRows = useMemo(() => {
    const base = { ...companyScope, ...Object.fromEntries(path.filter(s => s.dim !== 'channel').map(s => [s.dim, s.key])) };
    return groupBy(base, 'channel').map(r => {
      const rm = salesModel({ ...base, channel: r.key });
      const rp = salesModel({ ...prevScope, channel: r.key });
      const g = rp.netSales ? changePct(rm.netSales, rp.netSales) : null;
      return {
        id: r.key, key: r.key, dim: 'channel',
        name: CHANNEL_BY_ID[r.key]?.name ?? r.key,
        color: channelColor(r.key), ...rm, growth: g,
        flag: worstFlag(salesFlags(rm, { growthPct: g, can })),
      };
    });
  }, [companyScope, prevScope, path, can]);

  // Real variants, each summed from its own order lines.
  const variantRows = useMemo(
    () => (atVariant ? skuBreakdown(drillScope) : []),
    [atVariant, drillScope]
  );

  const trend = useMemo(() => {
    // Plot Net Sales — the same measure as the headline KPI. Each component is
    // summed linearly, so the per-bucket figure is exact.
    const netSalesOf = (d) => d.grossSales - d.cancelValue - d.returnsValue - d.discount;
    const cur = series(drillScope, grain);
    const prev = series(drillPrevScope, grain);

    // A forecast is a flat line at the projected run-rate, not last period's
    // actuals — showing history while the control says "Forecast" would lie.
    const planTotal = comparison === 'forecast' ? forecastFor(period, m.netSales) : null;
    const perBucket = planTotal != null && cur.length ? planTotal / cur.length : null;

    return cur.map((d, i) => ({
      label: grain === 'month' ? fmtDate(d.ts, 'month') : fmtDate(d.ts),
      value: netSalesOf(d),
      compare: isHistoricalComparison(comparison)
        ? (prev[i] ? netSalesOf(prev[i]) : null)
        : perBucket,
      ts: d.ts,
    }));
  }, [drillScope, drillPrevScope, grain, comparison, period, m.netSales]);

  const markers = useMemo(
    () => buildEventMarkers({ events, notes, companyId, channelId, trend, grain }),
    [events, notes, companyId, channelId, trend, grain]
  );

  const company = COMPANY_BY_ID[companyId];
  const crumbs = [
    { label: company?.name ?? 'Company', at: 0 },
    ...path.map((s, i) => ({ label: nameFor(s.dim, s.key), at: i + 1 })),
  ];

  /**
   * Push a drill step. The channel table always lists every channel, so
   * re-selecting a dimension already on the path must REPLACE it rather than
   * stack a second copy — otherwise the breadcrumb reads "Shopify → Shopify".
   * Deeper steps are dropped because they belong to the previous selection.
   */
  const drillTo = (r) => setPath(prev => {
    const i = prev.findIndex(s => s.dim === r.dim);
    return i === -1
      ? [...prev, { dim: r.dim, key: r.key }]
      : [...prev.slice(0, i), { dim: r.dim, key: r.key }];
  });
  const sections = SECTIONS.filter(s => can(s.perm));

  void dataVersion;
  if (!live.rows.length) return <NoSalesYet />;

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Sales</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            {can.profit
              ? 'From gross sales to what the company keeps.'
              : 'Demand and channel performance.'}
          </p>
        </div>
        <div className="hstack" style={{ gap: 8 }}>
          {!can.profit && (
            <span title="Cost of goods and profitability are restricted for your role">
              <Pill tone="neutral" icon={false}><Lock size={10} /> Profitability restricted</Pill>
            </span>
          )}
          {path.length > 0 && (
            <button className="btn btn-sm" onClick={() => setPath([])}><Home size={13} /> Whole company</button>
          )}
        </div>
      </div>

      {crumbs.length > 1 && (
        <div className="crumbs" style={{ marginBottom: -8 }}>
          {crumbs.map((c, i) => (
            <span key={i} className="hstack" style={{ gap: 4 }}>
              {i > 0 && <ChevronRight size={11} className="muted" />}
              <button className={`crumb${i === crumbs.length - 1 ? ' last' : ''}`}
                onClick={i === crumbs.length - 1 ? undefined : () => setPath(path.slice(0, c.at))}>
                {c.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Where the revenue came from, before how much of it there was. */}
      <RevenueSplit
        scope={drillScope}
        prevScope={drillPrevScope}
        channels={channelsFor(companyId)}
        channelId={channelId}
        onChannel={setChannelId}
      />

      {/* Headline: what, and is it good */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(162px,1fr))' }}>
        <Metric label="Gross Sales" value={money(m.grossSales)} delta={changePct(m.grossSales, pm.grossSales)} />
        <Metric label="Net Sales"   value={money(m.netSales)}   delta={growth}
                sub={achievement ? `${pct(achievement, 0)} of your goal` : null} />
        <Metric label="Orders"      value={num(m.orders)}     delta={changePct(m.orders, pm.orders)} />
        <Metric label="AOV"         value={money(m.revenuePerOrder)} delta={changePct(m.revenuePerOrder, pm.revenuePerOrder)} />
        <Metric label="Returns"     value={money(m.returns)} sub={`${pct(m.returnPct)} of gross`}
                delta={m.returnPct - pm.returnPct} deltaUnit="pp" invert />
        <Metric label="Cancellations" value={money(m.cancellations)} sub={`${pct(m.cancelPct)} of gross`}
                delta={m.cancelPct - pm.cancelPct} deltaUnit="pp" invert />
      </div>

      {flags.length > 0 && <FlagRow flags={flags} max={4} />}

      <Card title="Sales trend" actions={
        <Segmented options={[{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]}
          value={grain} onChange={setGrain} size="sm" />
      }>
        <RevenueTrend data={trend} height={230} markers={markers}
          compareLabel={comparisonExplainer(period, comparison, periodId).label} watchSubject={subjectFromScope(drillScope)} />
      </Card>

      {/* Sections */}
      <div className="segmented" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {sections.map(s => (
          <button key={s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>{s.label}</button>
        ))}
      </div>

      {tab === 'performance' && (
        <PerformanceTab m={m} pm={pm} can={can} crumbs={crumbs} target={target}
                        achievement={achievement} goalName={netGoal?.name} />
      )}
      {tab === 'daily' && <DailyOrders scope={drillScope} />}
      {tab === 'channels' && <ChannelsTab rows={channelRows} onDrill={drillTo} />}
      {tab === 'economics' && (
        <div className="vstack" style={{ gap: 18 }}>
          <SalesToggleSection scope={drillScope} prevScope={drillPrevScope} />
          <MarketplaceEconomics />
        </div>
      )}
      {tab === 'unit' && <UnitTab m={m} can={can} />}
      {tab === 'products' && (
        <div className="vstack" style={{ gap: 14 }}>
          {/* Attribute down the side, periods across — reads far better than a
              single-period list when comparing sizes or lengths. */}
          <MatrixTable scope={drillScope} />

          {drillScope.product && (
            <Card
              title="Weekly performance"
              subtitle={`${PRODUCT_BY_ID[drillScope.product]?.name ?? 'Product'} — units, price and returns by week`}
              flush
              actions={
                <WatchButton
                  subject={{
                    company: drillScope.company, channel: drillScope.channel,
                    category: drillScope.category, subcategory: drillScope.subcategory,
                    product: drillScope.product,
                    title: PRODUCT_BY_ID[drillScope.product]?.name ?? 'Product',
                  }}
                  label="Watch"
                />
              }
            >
              <WeeklySales scope={drillScope} />
            </Card>
          )}

          {atVariant
            ? <VariantTable rows={variantRows} onOpen={open} scope={drillScope} />
            : <BreakoutTable level={level} rows={rows} can={can} onDrill={drillTo} />}
        </div>
      )}
      {tab === 'diagnostics' && <DiagnosticsTab m={m} pm={pm} rows={channelRows} scope={drillScope} />}
    </div>
  );
}

/* ── Sales Performance ──────────────────────────────────────────────────── */

function PerformanceTab({ m, pm, can, crumbs, target, achievement, goalName }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)' }}>
      <Card title="Sales waterfall" subtitle={crumbs.map(c => c.label).join(' → ')}>
        <Waterfall model={m} can={can} />
      </Card>
      <div className="vstack" style={{ gap: 14 }}>
        <Card title="Against your goal" subtitle={goalName ?? 'Set on the Goals page'}>
          {target == null ? (
            <NotConnected
              title="No net sales goal for this brand"
              needs="a target on the Goals page"
              showLink={false}
              compact
            >
              A target has to be something you decided, not a multiple of what you already sold.
            </NotConnected>
          ) : (
            <div className="vstack" style={{ gap: 9 }}>
              {[
                { l: 'Target', v: money(target) },
                { l: 'Actual', v: money(m.netSales) },
                {
                  l: 'Variance', v: money(m.netSales - target),
                  tone: m.netSales >= target ? 'good' : 'critical',
                },
              ].map(r => (
                <div className="spread" key={r.l}>
                  <span className="small muted">{r.l}</span>
                  <span className="tnum" style={{
                    fontWeight: 600,
                    color: r.tone === 'critical' ? 'var(--critical-ink)' : r.tone === 'good' ? 'var(--good-ink)' : 'var(--ink)',
                  }}>{r.v}</span>
                </div>
              ))}
              <div className="spread" style={{ paddingTop: 9, borderTop: '1px solid var(--border)' }}>
                <span className="small" style={{ fontWeight: 600 }}>Achievement</span>
                <span className="tnum" style={{ fontWeight: 700 }}>{pct(achievement ?? 0, 1)}</span>
              </div>
            </div>
          )}
        </Card>
        <Card title="Sales quality" subtitle="Per-order shape of demand">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 10 }}>
            {[
              { l: 'ASP', v: money(m.asp), d: changePct(m.asp, pm.asp) },
              { l: 'Units / Order', v: m.unitsPerOrder.toFixed(2), d: changePct(m.unitsPerOrder, pm.unitsPerOrder) },
              { l: 'Units', v: num(m.units), d: changePct(m.units, pm.units) },
              { l: 'Discount %', v: pct(m.discountPct), d: m.discountPct - pm.discountPct },
            ].map(x => (
              <div key={x.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
                <div className="tiny muted">{x.l}</div>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{x.v}</div>
                {x.d != null && !Number.isNaN(x.d) && <Delta value={x.d} />}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ── Channel Performance ────────────────────────────────────────────────── */

function ChannelsTab({ rows, onDrill }) {
  return (
    <div className="vstack" style={{ gap: 14 }}>
      <Card title="Channel performance" subtitle="How much sells through each connected channel" flush>
        <DataTable
          pageSize={10} searchKeys={['name']}
          columns={[
            {
              key: 'name', label: 'Channel',
              render: r => (
                <span className="hstack" style={{ gap: 8 }}>
                  <span className="swatch" style={{ background: r.color }} />
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                  {r.flag && r.flag.tone !== 'good' && <span title={r.flag.detail}><span className={`dot ${r.flag.tone}`} /></span>}
                </span>
              ),
            },
            { key: 'grossSales', label: 'Gross Sales', align: 'right', render: r => money(r.grossSales) },
            { key: 'netSales',   label: 'Net Sales',   align: 'right', render: r => <strong>{money(r.netSales)}</strong> },
            { key: 'orders',     label: 'Orders',      align: 'right', render: r => num(r.orders) },
            { key: 'units',      label: 'Units',       align: 'right', render: r => num(r.units) },
            { key: 'revenuePerOrder', label: 'AOV',    align: 'right', render: r => money(r.revenuePerOrder) },
            { key: 'asp',        label: 'ASP',         align: 'right', render: r => money(r.asp) },
            { key: 'cancelPct',  label: 'Cancel %',    align: 'right', render: r => <span style={r.cancelPct > 6 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>{pct(r.cancelPct)}</span> },
            { key: 'returnPct',  label: 'Return %',    align: 'right', render: r => <span style={r.returnPct > 12 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>{pct(r.returnPct)}</span> },
            { key: 'growth',     label: 'Growth',      align: 'right', render: r => <Delta value={r.growth} /> },
            { key: 'go', label: '', sortable: false, align: 'right', render: () => <ChevronRight size={14} className="muted" /> },
          ]}
          rows={rows}
          initialSort={{ key: 'netSales', dir: 'desc' }}
          onRowClick={onDrill}
          emptyText="No channel activity in this period"
        />
      </Card>
      <NotConnected
        title="Channel fees, logistics and realized sales per channel"
        needs="marketplace, gateway and courier connections"
      >
        What each channel costs to sell through cannot be derived from your own store's orders.
      </NotConnected>
    </div>
  );
}

/* ── Unit Economics ─────────────────────────────────────────────────────── */

function UnitTab({ m, can }) {
  return (
    <Card title="Unit economics" subtitle="What one order looks like at this level">
      <UnitEconomics model={m} can={can} />
    </Card>
  );
}

/* ── Product performance — breakout at the current level ────────────────── */

function BreakoutTable({ level, rows, can, onDrill }) {
  const showCogs = can(PERM.COGS);
  const marginCols = showCogs ? [
    {
      key: 'grossMargin', label: 'Gross Margin', align: 'right',
      render: r => <MoneyPct v={r.grossMargin} p={r.grossMarginPct} />,
    },
  ] : [];

  return (
    <Card title={`${level.label} performance`} subtitle="Identical measures at every level — select a row to go deeper" flush>
      <DataTable
        pageSize={12} searchKeys={['name']}
        columns={[
          {
            key: 'name', label: level.label,
            render: r => (
              <span className="hstack" style={{ gap: 8 }}>
                <span className="swatch" style={{ background: r.color }} />
                <span style={{ fontWeight: 500 }}>{r.name}</span>
                {r.flag && r.flag.tone !== 'good' && <span title={`${r.flag.label} · ${r.flag.detail}`}><span className={`dot ${r.flag.tone}`} /></span>}
              </span>
            ),
          },
          { key: 'grossSales', label: 'Gross',    align: 'right', render: r => money(r.grossSales) },
          { key: 'orders',     label: 'Orders',   align: 'right', render: r => num(r.orders) },
          { key: 'revenuePerOrder', label: 'AOV', align: 'right', render: r => money(r.revenuePerOrder) },
          { key: 'discountPct', label: 'Disc %',  align: 'right', render: r => pct(r.discountPct) },
          { key: 'cancelPct',  label: 'Cancel %', align: 'right', render: r => pct(r.cancelPct) },
          { key: 'returnPct',  label: 'Return %', align: 'right', render: r => pct(r.returnPct) },
          { key: 'netSales',   label: 'Net Sales', align: 'right', render: r => <strong>{money(r.netSales)}</strong> },
          { key: 'growth',     label: 'Growth',   align: 'right', render: r => <Delta value={r.growth} /> },
          ...marginCols,
          { key: 'go', label: '', sortable: false, align: 'right', render: () => <ChevronRight size={14} className="muted" /> },
        ]}
        rows={rows}
        initialSort={{ key: 'netSales', dir: 'desc' }}
        onRowClick={onDrill}
        emptyText="No sales at this level for the selected period"
      />
    </Card>
  );
}

/** The bottom of the hierarchy: real variants, each with its own figures. */
function VariantTable({ rows, onOpen, scope }) {
  const data = rows.map(v => ({
    ...v,
    netSales: v.net,
    asp: v.units ? (v.grossSales - v.discount) / v.units : 0,
    returnPct: v.grossSales ? (v.returnsValue / v.grossSales) * 100 : 0,
  }));

  return (
    <Card title="Variant performance" subtitle="Summed from each variant's own order lines" flush>
      <DataTable
        searchable={false} pageSize={12}
        columns={[
          { key: 'code', label: 'SKU', render: r => <span className="mono" style={{ fontWeight: 600 }}>{r.code}</span> },
          { key: 'label', label: 'Variant' },
          { key: 'units', label: 'Units', align: 'right', render: r => num(r.units) },
          { key: 'orders', label: 'Orders', align: 'right', render: r => num(r.orders) },
          { key: 'grossSales', label: 'Gross', align: 'right', render: r => money(r.grossSales) },
          { key: 'asp',   label: 'ASP',   align: 'right', render: r => money(r.asp) },
          { key: 'returnPct', label: 'Return %', align: 'right', render: r => pct(r.returnPct) },
          { key: 'netSales',  label: 'Net Sales', align: 'right', render: r => <strong>{money(r.netSales)}</strong> },
          {
            key: 'cogs', label: 'Cost of Goods', align: 'right',
            render: r => (r.cogs == null
              ? <span className="tiny muted">no unit cost</span>
              : <span className="tnum">{money(r.cogs)}</span>),
          },
          { key: 'go', label: '', sortable: false, align: 'right', render: () => <ChevronRight size={14} className="muted" /> },
        ]}
        rows={data}
        initialSort={{ key: 'netSales', dir: 'desc' }}
        onRowClick={(r) => onOpen({
          type: 'sku', label: `${r.code} · ${r.label}`, scope,
          sku: { id: r.id, code: r.code, label: r.label },
        })}
        emptyText="No variants sold for this product"
      />
    </Card>
  );
}

/* ── Diagnostics — why, not just what ───────────────────────────────────── */

function DiagnosticsTab({ m, pm, rows, scope }) {
  // Where returns and cancellations actually concentrate, by product.
  const products = useMemo(() => groupBy(scope, 'product').map(r => ({
    id: r.key,
    name: PRODUCT_BY_ID[r.key]?.name ?? r.key,
    grossSales: r.grossSales,
    returns: r.returnsValue,
    returnPct: r.grossSales ? (r.returnsValue / r.grossSales) * 100 : 0,
    cancellations: r.cancelValue,
    cancelPct: r.grossSales ? (r.cancelValue / r.grossSales) * 100 : 0,
    discountPct: r.grossSales ? (r.discount / r.grossSales) * 100 : 0,
  })), [scope]);

  return (
    <div className="vstack" style={{ gap: 14 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <Card title="Returns" subtitle={`${pct(m.returnPct)} of gross sales · ${pct(m.returnPct - pm.returnPct, 1)}pp vs previous`}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { l: 'Return value', v: money(m.returns) },
              { l: 'Return %',     v: pct(m.returnPct) },
              { l: 'Units returned', v: num(m.returnUnits) },
            ].map(x => (
              <div key={x.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
                <div className="tiny muted">{x.l}</div>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{x.v}</div>
              </div>
            ))}
          </div>
          <NotConnected
            title="Why things come back"
            needs="return reasons from your store's returns app"
            compact
          >
            Shopify's order data records the refund, not the reason. A reason mix would have to be
            invented.
          </NotConnected>
        </Card>

        <Card title="Cancellations" subtitle={`${pct(m.cancelPct)} of gross sales · ${pct(m.cancelPct - pm.cancelPct, 1)}pp vs previous`}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { l: 'Cancelled value', v: money(m.cancellations) },
              { l: 'Cancel %',        v: pct(m.cancelPct) },
            ].map(x => (
              <div key={x.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
                <div className="tiny muted">{x.l}</div>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{x.v}</div>
              </div>
            ))}
          </div>
          <NotConnected
            title="Cancellation reasons and RTO"
            needs="courier data and cancellation reasons"
            compact
          />
        </Card>
      </div>

      <Card title="Discounting" subtitle="Every discount on your own store is funded by you">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(132px,1fr))', gap: 10 }}>
          {[
            { l: 'Total discounts',  v: money(m.discounts) },
            { l: 'Discount %',       v: pct(m.discountPct) },
            { l: 'Discount / Order', v: money(m.discountPerOrder) },
          ].map(x => (
            <div key={x.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
              <div className="tiny muted">{x.l}</div>
              <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{x.v}</div>
            </div>
          ))}
        </div>
        <div className="ladder-foot">
          Platform-funded discounting only exists on marketplaces, which are not connected.
        </div>
      </Card>

      <Card title="Where returns and cancellations concentrate" subtitle="By product — the fastest route to a root cause" flush>
        <DataTable
          pageSize={10} searchKeys={['name']}
          columns={[
            { key: 'name', label: 'Product', render: r => <span style={{ fontWeight: 500 }}>{r.name}</span> },
            { key: 'grossSales', label: 'Gross', align: 'right', render: r => money(r.grossSales) },
            { key: 'returnPct', label: 'Return %', align: 'right', render: r => <span style={r.returnPct > 12 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>{pct(r.returnPct)}</span> },
            { key: 'returns',   label: 'Return value', align: 'right', render: r => money(r.returns) },
            { key: 'cancelPct', label: 'Cancel %', align: 'right', render: r => <span style={r.cancelPct > 6 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>{pct(r.cancelPct)}</span> },
            { key: 'cancellations', label: 'Cancelled value', align: 'right', render: r => money(r.cancellations) },
            { key: 'discountPct', label: 'Discount %', align: 'right', render: r => pct(r.discountPct) },
          ]}
          rows={products}
          initialSort={{ key: 'returnPct', dir: 'desc' }}
          emptyText="No products sold in this period"
        />
      </Card>

      {rows.length > 1 && (
        <Card title="By channel" subtitle="The same measures per channel" flush>
          <DataTable
            searchable={false} pageSize={8}
            columns={[
              {
                key: 'name', label: 'Channel',
                render: r => (
                  <span className="hstack" style={{ gap: 8 }}>
                    <span className="swatch" style={{ background: r.color }} />
                    <span style={{ fontWeight: 500 }}>{r.name}</span>
                  </span>
                ),
              },
              { key: 'returnPct', label: 'Return %', align: 'right', render: r => pct(r.returnPct) },
              { key: 'cancelPct', label: 'Cancel %', align: 'right', render: r => pct(r.cancelPct) },
              { key: 'discountPct', label: 'Discount %', align: 'right', render: r => pct(r.discountPct) },
              { key: 'returns',   label: 'Return value', align: 'right', render: r => money(r.returns) },
              { key: 'cancellations', label: 'Cancelled value', align: 'right', render: r => money(r.cancellations) },
            ]}
            rows={rows}
            initialSort={{ key: 'returnPct', dir: 'desc' }}
            emptyText="No channel activity in this period"
          />
        </Card>
      )}
    </div>
  );
}
