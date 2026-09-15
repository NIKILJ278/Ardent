import { useMemo, useState } from 'react';
import { ChevronRight, Home, Lock } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useDrill } from '../state/Drilldown.jsx';
import {
  salesModel, groupBy, series, targetFor, budgetFor, forecastFor,
  comparisonLabel, isHistoricalComparison,
} from '../data/engine.js';
import { salesFlags, worstFlag } from '../data/salesFlags.js';
import { PERM } from '../state/permissions.js';
import { CHANNEL_BY_ID, PRODUCT_BY_ID, COMPANY_BY_ID, skusForProduct, channelsFor } from '../data/catalog.js';
import { inr, num, pct, fmtDate, changePct } from '../lib/format.js';
import { Card, Delta, DataTable, Segmented, Pill } from '../components/ui/index.jsx';
import { RevenueTrend } from '../components/charts/index.jsx';
import { Waterfall, Metric, UnitEconomics, FlagRow, MoneyPct, WeeklyProduct } from '../components/sales/Blocks.jsx';
import { productWeekly } from '../data/inventory.js';
import { MatrixTable } from '../components/sales/MatrixTable.jsx';
import { RevenueSplit } from '../components/sales/RevenueSplit.jsx';
import { WatchButton } from '../components/watch/WatchButton.jsx';
import { SalesToggleSection, MarketplaceEconomics } from '../components/sales/ChannelEconomics.jsx';
import { channelColor } from '../lib/channels.js';
import { masterForProduct, LISTING_FORMATS } from '../data/skuMaster.js';
import { buildEventMarkers } from '../lib/markers.js';

/** Company → Channel → Category → Subcategory → Product → SKU → Transaction. */
const LEVELS = [
  { dim: 'channel',     label: 'Channel' },
  { dim: 'category',    label: 'Category' },
  { dim: 'subcategory', label: 'Subcategory' },
  { dim: 'product',     label: 'Product' },
];

const SECTIONS = [
  { id: 'performance', label: 'Sales Performance', perm: PERM.SALES_PERFORMANCE },
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

export default function Sales() {
  const { scope, prevScope, companyScope, companyId, channelId, setChannelId,
          comparison, period, can, events, notes } = useApp();
  const { open } = useDrill();
  const [tab, setTab] = useState('performance');
  const [grain, setGrain] = useState('day');
  const [path, setPath] = useState([]);

  const drillScope     = useMemo(() => path.reduce((a, s) => ({ ...a, [s.dim]: s.key }), scope), [scope, path]);
  const drillPrevScope = useMemo(() => path.reduce((a, s) => ({ ...a, [s.dim]: s.key }), prevScope), [prevScope, path]);

  const m  = useMemo(() => salesModel(drillScope),     [drillScope]);
  const pm = useMemo(() => salesModel(drillPrevScope), [drillPrevScope]);

  const growth = changePct(m.netSales, pm.netSales);
  const target = useMemo(() => targetFor(companyId, m.netSales), [companyId, m.netSales]);
  const achievement = target ? (m.netSales / target) * 100 : null;
  const flags = useMemo(
    () => salesFlags(m, { growthPct: growth, achievementPct: achievement, can }),
    [m, growth, achievement, can]
  );

  const usedDims = new Set(path.map(s => s.dim));
  if (channelId !== 'all') usedDims.add('channel');
  const level = LEVELS.find(l => !usedDims.has(l.dim));
  const atSku = !level;

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
        target: targetFor(companyId, rm.netSales),
        flag: worstFlag(salesFlags(rm, { growthPct: g, can })),
      };
    });
  }, [companyScope, prevScope, path, companyId, can]);

  const skuRows = useMemo(() => {
    const product = PRODUCT_BY_ID[drillScope.product];
    if (!atSku || !product) return [];
    // Join to the SKU Master so the row carries its internal code and, when a
    // single channel is in scope, that channel's own identifier.
    const master = new Map(masterForProduct(product.id).map(r => [r.variantId, r]));
    return skusForProduct(product).map(v => ({
      master: master.get(v.id) ?? null,
      id: v.id, code: v.code, label: v.label, ratio: v.ratio,
      units: Math.round(m.units * v.ratio),
      orders: Math.round(m.orders * v.ratio),
      grossSales: m.grossSales * v.ratio,
      netSales: m.netSales * v.ratio,
      discounts: m.discounts * v.ratio,
      channelCost: m.channelCost * v.ratio,
      channelFees: m.channelFees * v.ratio,
      logistics: m.logistics * v.ratio,
      cogs: m.cogs * v.ratio,
      cm1: m.cm1 * v.ratio, cm2: m.cm2 * v.ratio, netMargin: m.netMargin * v.ratio,
      asp: m.asp, cancelPct: m.cancelPct, returnPct: m.returnPct, rtoPct: m.rtoPct,
      channelCostPct: m.channelCostPct, cm1Pct: m.cm1Pct, cm2Pct: m.cm2Pct,
      netMarginPct: m.netMarginPct, channelFeesPct: m.channelFeesPct, logisticsPct: m.logisticsPct,
    }));
  }, [atSku, drillScope.product, m]);

  // Weekly detail once the drill has reached a single product.
  const weekly = useMemo(
    () => (drillScope.product
      ? productWeekly({ period, companyId, productId: drillScope.product, channel: drillScope.channel })
      : null),
    [period, companyId, drillScope.product, drillScope.channel]
  );

  const trend = useMemo(() => {
    // Plot Net Sales — the same measure as the headline KPI. Each component is
    // summed linearly, so the per-bucket figure is exact.
    const netSalesOf = (d) => d.grossSales - d.cancelValue - d.returnsValue - d.discount;
    const cur = series(drillScope, grain);
    const prev = series(drillPrevScope, grain);

    // A plan comparison is a flat line, not a historical window — showing last
    // period's actuals while the control says "Target" would be a lie.
    const planTotal =
      comparison === 'target'   ? targetFor(companyId, m.netSales)
    : comparison === 'budget'   ? budgetFor(companyId, m.netSales)
    : comparison === 'forecast' ? forecastFor(period, m.netSales)
    : null;
    const perBucket = planTotal != null && cur.length ? planTotal / cur.length : null;

    return cur.map((d, i) => ({
      label: grain === 'month' ? fmtDate(d.ts, 'month') : fmtDate(d.ts),
      value: netSalesOf(d),
      compare: isHistoricalComparison(comparison)
        ? (prev[i] ? netSalesOf(prev[i]) : null)
        : perBucket,
      ts: d.ts,
    }));
  }, [drillScope, drillPrevScope, grain, comparison, companyId, period, m.netSales]);

  const markers = useMemo(
    () => buildEventMarkers({ events, notes, companyId, channelId, trend, grain }),
    [events, notes, companyId, channelId, trend, grain]
  );

  const company = COMPANY_BY_ID[companyId];
  const crumbs = [
    { label: companyId === 'all' ? 'All Brands' : company?.name ?? 'Company', at: 0 },
    ...path.map((s, i) => ({ label: nameFor(s.dim, s.key), at: i + 1 })),
  ];
  /**
   * Push a drill step. The channel table always lists every channel, so
   * re-selecting a dimension already on the path must REPLACE it rather than
   * stack a second copy — otherwise the breadcrumb reads "Amazon → Amazon".
   * Deeper steps are dropped because they belong to the previous selection.
   */
  const drillTo = (r) => setPath(prev => {
    const i = prev.findIndex(s => s.dim === r.dim);
    return i === -1
      ? [...prev, { dim: r.dim, key: r.key }]
      : [...prev.slice(0, i), { dim: r.dim, key: r.key }];
  });
  const sections = SECTIONS.filter(s => can(s.perm));

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Sales</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            {can.profit
              ? 'From gross sales to what the company keeps.'
              : 'Demand, channel performance and what each channel costs to sell through.'}
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
        channels={companyId === 'all' ? [] : channelsFor(companyId)}
        channelId={channelId}
        onChannel={setChannelId}
      />

      {/* Headline: what, and is it good */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(162px,1fr))' }}>
        <Metric label="Gross Sales" value={inr(m.grossSales)} delta={changePct(m.grossSales, pm.grossSales)} />
        <Metric label="Net Sales"   value={inr(m.netSales)}   delta={growth} sub={achievement ? `${pct(achievement, 0)} of target` : null} />
        <Metric label="Orders"      value={num(m.orders)}     delta={changePct(m.orders, pm.orders)} />
        <Metric label="AOV"         value={inr(m.revenuePerOrder)} delta={changePct(m.revenuePerOrder, pm.revenuePerOrder)} />
        <Metric label="Returns"     value={inr(m.returns)} sub={`${pct(m.returnPct)} of gross`} delta={m.returnPct - pm.returnPct} deltaUnit="pp" invert />
        <Metric label="Cancellations" value={inr(m.cancellations)} sub={`${pct(m.cancelPct)} of gross`} delta={m.cancelPct - pm.cancelPct} deltaUnit="pp" invert />
      </div>

      {flags.length > 0 && <FlagRow flags={flags} max={4} />}

      <Card title="Sales trend" actions={
        <Segmented options={[{ id: 'day', label: 'Daily' }, { id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]}
          value={grain} onChange={setGrain} size="sm" />
      }>
        <RevenueTrend data={trend} height={230} markers={markers}
          compareLabel={comparisonLabel(comparison)} />
      </Card>

      {/* Sections */}
      <div className="segmented" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {sections.map(s => (
          <button key={s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>{s.label}</button>
        ))}
      </div>

      {tab === 'performance' && (
        <PerformanceTab m={m} pm={pm} can={can} crumbs={crumbs} target={target} achievement={achievement} />
      )}
      {tab === 'channels' && (
        <ChannelsTab rows={channelRows} onDrill={drillTo} />
      )}
      {tab === 'economics' && (
        <div className="vstack" style={{ gap: 18 }}>
          <SalesToggleSection scope={drillScope} prevScope={drillPrevScope} />
          <MarketplaceEconomics scope={drillScope} companyChannels={channelsFor(companyId)} />
        </div>
      )}
      {tab === 'unit' && (
        <UnitTab m={m} rows={channelRows} can={can} />
      )}
      {tab === 'products' && (
        <div className="vstack" style={{ gap: 14 }}>
          {/* Attribute down the side, periods across — reads far better than a
              single-period list when comparing sizes or lengths. */}
          <MatrixTable scope={drillScope} />

          {weekly && weekly.weeks.length > 0 && (
            <Card
              title="Weekly performance"
              subtitle={`${weekly.product.name} — sales, ASP, returns and stock in hand by week`}
              flush
              actions={
                <span className="hstack" style={{ gap: 10 }}>
                  <span className="tiny muted">Closing stock {num(weekly.closingStock)} units</span>
                  {weekly.weeksStockedOut > 0 && (
                    <Pill tone="critical">{weekly.weeksStockedOut} week(s) stocked out</Pill>
                  )}
                  <WatchButton
                    subject={{
                      company: drillScope.company, channel: drillScope.channel,
                      category: drillScope.category, subcategory: drillScope.subcategory,
                      product: weekly.product.id, title: weekly.product.name,
                    }}
                    label="Watch"
                  />
                </span>
              }
            >
              <WeeklyProduct data={weekly} />
            </Card>
          )}
          {atSku
            ? <SkuTable rows={skuRows} can={can} onOpen={open} scope={drillScope} />
            : <BreakoutTable level={level} rows={rows} can={can} onDrill={drillTo} />}
        </div>
      )}
      {tab === 'diagnostics' && (
        <DiagnosticsTab m={m} pm={pm} rows={channelRows} />
      )}
    </div>
  );
}

/* ── Sales Performance ──────────────────────────────────────────────────── */

function PerformanceTab({ m, pm, can, crumbs, target, achievement }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr)' }}>
      <Card title="Sales & profitability waterfall" subtitle={crumbs.map(c => c.label).join(' → ')}>
        <Waterfall model={m} can={can} />
      </Card>
      <div className="vstack" style={{ gap: 14 }}>
        <Card title="Target vs actual" subtitle="Against the period target">
          <div className="vstack" style={{ gap: 9 }}>
            {[
              { l: 'Target', v: inr(target) },
              { l: 'Actual', v: inr(m.netSales) },
              { l: 'Variance', v: inr(m.netSales - target), tone: m.netSales >= target ? 'good' : 'critical' },
            ].map(r => (
              <div className="spread" key={r.l}>
                <span className="small muted">{r.l}</span>
                <span className="tnum" style={{ fontWeight: 600, color: r.tone === 'critical' ? 'var(--critical-ink)' : r.tone === 'good' ? 'var(--good-ink)' : 'var(--ink)' }}>{r.v}</span>
              </div>
            ))}
            <div className="spread" style={{ paddingTop: 9, borderTop: '1px solid var(--border)' }}>
              <span className="small" style={{ fontWeight: 600 }}>Achievement</span>
              <span className="tnum" style={{ fontWeight: 700 }}>{pct(achievement ?? 0, 1)}</span>
            </div>
          </div>
        </Card>
        <Card title="Sales quality" subtitle="Per-order shape of demand">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(104px,1fr))', gap: 10 }}>
            {[
              { l: 'ASP', v: inr(m.asp), d: changePct(m.asp, pm.asp) },
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

/* ── Channel Performance — how much, where ──────────────────────────────── */

function ChannelsTab({ rows, onDrill }) {
  return (
    <Card title="Channel performance" subtitle="How much we sell through each channel — select a channel to drill in" flush>
      <DataTable
        pageSize={10} searchKeys={['name']}
        columns={[
          { key: 'name', label: 'Channel', render: r => (
            <span className="hstack" style={{ gap: 8 }}>
              <span className="swatch" style={{ background: r.color }} />
              <span style={{ fontWeight: 500 }}>{r.name}</span>
              {r.flag && r.flag.tone !== 'good' && <span title={r.flag.detail}><span className={`dot ${r.flag.tone}`} /></span>}
            </span>
          )},
          { key: 'grossSales', label: 'Gross Sales', align: 'right', render: r => inr(r.grossSales) },
          { key: 'netSales',   label: 'Net Sales',   align: 'right', render: r => <strong>{inr(r.netSales)}</strong> },
          { key: 'orders',     label: 'Orders',      align: 'right', render: r => num(r.orders) },
          { key: 'units',      label: 'Units',       align: 'right', render: r => num(r.units) },
          { key: 'revenuePerOrder', label: 'AOV',    align: 'right', render: r => inr(r.revenuePerOrder) },
          { key: 'asp',        label: 'ASP',         align: 'right', render: r => inr(r.asp) },
          { key: 'cancelPct',  label: 'Cancel %',    align: 'right', render: r => <span style={r.cancelPct > 6 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>{pct(r.cancelPct)}</span> },
          { key: 'returnPct',  label: 'Return %',    align: 'right', render: r => <span style={r.returnPct > 12 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>{pct(r.returnPct)}</span> },
          { key: 'rtoPct',     label: 'RTO %',       align: 'right', render: r => pct(r.rtoPct) },
          { key: 'growth',     label: 'Growth',      align: 'right', render: r => <Delta value={r.growth} /> },
          { key: 'ach', label: 'vs Target', align: 'right', sortValue: r => (r.target ? (r.netSales / r.target) * 100 : 0),
            render: r => <span className="tnum">{pct(r.target ? (r.netSales / r.target) * 100 : 0, 0)}</span> },
          { key: 'go', label: '', sortable: false, align: 'right', render: () => <ChevronRight size={14} className="muted" /> },
        ]}
        rows={rows}
        initialSort={{ key: 'netSales', dir: 'desc' }}
        onRowClick={onDrill}
        emptyText="No channel activity in this period"
      />
    </Card>
  );
}

/* ── Unit Economics — overall and per channel, same shape ───────────────── */

function UnitTab({ m, rows, can }) {
  return (
    <div className="vstack" style={{ gap: 14 }}>
      <Card title="Unit economics — overall" subtitle="What one order looks like at this level">
        <UnitEconomics model={m} can={can} />
      </Card>
      <Card title="Unit economics by channel" subtitle="The same measures per channel, so they compare directly" flush>
        <DataTable
          searchable={false} pageSize={8}
          columns={[
            { key: 'name', label: 'Channel', render: r => (
              <span className="hstack" style={{ gap: 8 }}>
                <span className="swatch" style={{ background: r.color }} />
                <span style={{ fontWeight: 500 }}>{r.name}</span>
              </span>
            )},
            { key: 'revenuePerOrder', label: 'Revenue / Order', align: 'right', render: r => inr(r.revenuePerOrder) },
            { key: 'asp',             label: 'ASP',             align: 'right', render: r => inr(r.asp) },
            { key: 'unitsPerOrder',   label: 'Units / Order',   align: 'right', render: r => r.unitsPerOrder.toFixed(2) },
            { key: 'discountPerOrder',label: 'Discount / Order',align: 'right', render: r => inr(r.discountPerOrder) },
            { key: 'feesPerOrder',    label: 'Fee / Order',     align: 'right', render: r => inr(r.feesPerOrder) },
            { key: 'logisticsPerOrder', label: 'Logistics / Order', align: 'right', render: r => inr(r.logisticsPerOrder) },
            { key: 'otherCostPerOrder', label: 'Other / Order', align: 'right', render: r => inr(r.otherCostPerOrder) },
            { key: 'channelCostPerOrder', label: 'Channel Cost / Order', align: 'right',
              render: r => <strong className="tnum">{inr(r.channelCostPerOrder)}</strong> },
            ...(can.profit ? [{
              key: 'contributionPerOrder', label: 'Contribution / Order', align: 'right',
              render: r => (
                <span className="tnum" style={{ fontWeight: 600, color: r.contributionPerOrder >= 0 ? 'var(--good-ink)' : 'var(--critical-ink)' }}>
                  {inr(r.contributionPerOrder)}
                </span>
              ),
            }] : []),
          ]}
          rows={rows}
          initialSort={{ key: 'channelCostPerOrder', dir: 'desc' }}
          emptyText="No channels in this period"
        />
      </Card>
    </div>
  );
}

/* ── Product performance — breakout at the current level ────────────────── */

function BreakoutTable({ level, rows, can, onDrill }) {
  const profitCols = can.profit ? [
    { key: 'cm1', label: 'CM1', align: 'right', render: r => <MoneyPct v={r.cm1} p={r.cm1Pct} /> },
    { key: 'cm2', label: 'CM2', align: 'right', render: r => <MoneyPct v={r.cm2} p={r.cm2Pct} /> },
    { key: 'netMargin', label: 'Net Margin', align: 'right', render: r => (
      <span className="tnum" style={{ fontWeight: 600, color: r.netMargin >= 0 ? 'var(--good-ink)' : 'var(--critical-ink)' }}>
        {inr(r.netMargin)} <span className="tiny" style={{ opacity: 0.85 }}>{pct(r.netMarginPct)}</span>
      </span>
    )},
  ] : [];

  return (
    <Card title={`${level.label} performance`} subtitle="Identical measures at every level — select a row to go deeper" flush>
      <DataTable
        pageSize={12} searchKeys={['name']}
        columns={[
          { key: 'name', label: level.label, render: r => (
            <span className="hstack" style={{ gap: 8 }}>
              <span className="swatch" style={{ background: r.color }} />
              <span style={{ fontWeight: 500 }}>{r.name}</span>
              {r.flag && r.flag.tone !== 'good' && <span title={`${r.flag.label} · ${r.flag.detail}`}><span className={`dot ${r.flag.tone}`} /></span>}
            </span>
          )},
          { key: 'grossSales', label: 'Gross',    align: 'right', render: r => inr(r.grossSales) },
          { key: 'orders',     label: 'Orders',   align: 'right', render: r => num(r.orders) },
          { key: 'revenuePerOrder', label: 'AOV', align: 'right', render: r => inr(r.revenuePerOrder) },
          { key: 'discountPct',label: 'Disc %',   align: 'right', render: r => pct(r.discountPct) },
          { key: 'cancelPct',  label: 'Cancel %', align: 'right', render: r => pct(r.cancelPct) },
          { key: 'returnPct',  label: 'Return %', align: 'right', render: r => pct(r.returnPct) },
          { key: 'netSales',   label: 'Net Sales',align: 'right', render: r => <strong>{inr(r.netSales)}</strong> },
          { key: 'channelCost',label: 'Channel Cost', align: 'right', render: r => <MoneyPct v={r.channelCost} p={r.channelCostPct} /> },
          { key: 'growth',     label: 'Growth',   align: 'right', render: r => <Delta value={r.growth} /> },
          ...profitCols,
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

function SkuTable({ rows, can, onOpen, scope }) {
  const scopeChannel = scope.channel ?? null;
  const profitCols = can.profit ? [
    { key: 'cm1', label: 'CM1', align: 'right', render: r => <MoneyPct v={r.cm1} p={r.cm1Pct} /> },
    { key: 'netMargin', label: 'Net Margin', align: 'right', render: r => (
      <span className="tnum" style={{ fontWeight: 600, color: r.netMargin >= 0 ? 'var(--good-ink)' : 'var(--critical-ink)' }}>
        {inr(r.netMargin)} <span className="tiny" style={{ opacity: 0.85 }}>{pct(r.netMarginPct)}</span>
      </span>
    )},
  ] : [];

  return (
    <Card title="SKU performance" subtitle="The lowest level Ardent holds — select a SKU for its transactions" flush>
      <DataTable
        searchable={false} pageSize={12}
        columns={[
          { key: 'code', label: 'Internal SKU', render: r => (
            <span>
              <span className="mono" style={{ fontWeight: 600 }}>{r.master?.sku ?? r.code}</span>
              {r.master && <span className="tiny muted" style={{ display: 'block' }}>EAN {r.master.ean}</span>}
            </span>
          )},
          { key: 'label', label: 'Variant' },
          { key: 'listing', label: 'Platform ID', sortable: false, render: r => {
            const ls = r.master ? Object.values(r.master.listings) : [];
            const one = scopeChannel ? ls.find(l => l.channel === scopeChannel) : null;
            if (scopeChannel) {
              return one?.id
                ? <span className="mono tiny">{one.id}<span className="muted" style={{ marginLeft: 5 }}>{LISTING_FORMATS[one.channel]?.label}</span></span>
                : <span className="muted tiny">unmapped</span>;
            }
            const live = ls.filter(l => l.state !== 'unmapped').length;
            return <span className="tiny muted">{live}/{ls.length} platforms</span>;
          }},
          { key: 'units', label: 'Units', align: 'right', render: r => num(r.units) },
          { key: 'grossSales', label: 'Gross', align: 'right', render: r => inr(r.grossSales) },
          { key: 'asp',   label: 'ASP',   align: 'right', render: r => inr(r.asp) },
          { key: 'returnPct', label: 'Return %', align: 'right', render: r => pct(r.returnPct) },
          { key: 'rtoPct',    label: 'RTO %',    align: 'right', render: r => pct(r.rtoPct) },
          { key: 'netSales',  label: 'Net Sales', align: 'right', render: r => <strong>{inr(r.netSales)}</strong> },
          { key: 'channelCost', label: 'Channel Cost', align: 'right', render: r => <MoneyPct v={r.channelCost} p={r.channelCostPct} /> },
          ...profitCols,
          { key: 'go', label: '', sortable: false, align: 'right', render: () => <ChevronRight size={14} className="muted" /> },
        ]}
        rows={rows}
        initialSort={{ key: 'netSales', dir: 'desc' }}
        onRowClick={(r) => onOpen({
          type: 'sku', label: `${r.code} · ${r.label}`, scope,
          sku: { id: r.id, code: r.code, label: r.label, ratio: r.ratio },
        })}
        emptyText="No SKUs for this product"
      />
    </Card>
  );
}

/* ── Diagnostics — why, not just what ───────────────────────────────────── */

function DiagnosticsTab({ m, pm, rows }) {
  const returnReasons = [
    { label: 'Size or fit',        share: 0.34 },
    { label: 'Damaged in transit', share: 0.19 },
    { label: 'Not as described',   share: 0.17 },
    { label: 'Changed mind',       share: 0.16 },
    { label: 'Wrong item sent',    share: 0.09 },
    { label: 'Other',              share: 0.05 },
  ];
  const cancelReasons = [
    { label: 'Customer cancelled',   share: 0.41 },
    { label: 'Payment failed',       share: 0.22 },
    { label: 'Out of stock',         share: 0.18 },
    { label: 'Address unserviceable',share: 0.12 },
    { label: 'Other',                share: 0.07 },
  ];

  return (
    <div className="vstack" style={{ gap: 14 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <Card title="Returns" subtitle={`${pct(m.returnPct)} of gross sales · ${pct(m.returnPct - pm.returnPct, 1)}pp vs previous`}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { l: 'Return value', v: inr(m.customerReturns) },
              { l: 'RTO value',    v: inr(m.rto) },
              { l: 'Return %',     v: pct(m.customerReturnPct) },
              { l: 'RTO %',        v: pct(m.rtoPct) },
            ].map(x => (
              <div key={x.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
                <div className="tiny muted">{x.l}</div>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{x.v}</div>
              </div>
            ))}
          </div>
          <div className="section-title">Reason mix</div>
          <div className="vstack" style={{ gap: 8 }}>
            {returnReasons.map(r => (
              <div className="bar-row" key={r.label}>
                <span className="bl">{r.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${r.share * 100}%`, background: 'var(--series-2)' }} />
                </div>
                <span className="bv">{inr(m.returns * r.share)} <span className="muted" style={{ fontWeight: 500 }}>{pct(r.share * 100, 0)}</span></span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Cancellations" subtitle={`${pct(m.cancelPct)} of gross sales · ${pct(m.cancelPct - pm.cancelPct, 1)}pp vs previous`}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { l: 'Cancelled value', v: inr(m.cancellations) },
              { l: 'Cancel %',        v: pct(m.cancelPct) },
            ].map(x => (
              <div key={x.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
                <div className="tiny muted">{x.l}</div>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{x.v}</div>
              </div>
            ))}
          </div>
          <div className="section-title">Reason mix</div>
          <div className="vstack" style={{ gap: 8 }}>
            {cancelReasons.map(r => (
              <div className="bar-row" key={r.label}>
                <span className="bl">{r.label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${r.share * 100}%`, background: 'var(--series-4)' }} />
                </div>
                <span className="bv">{inr(m.cancellations * r.share)} <span className="muted" style={{ fontWeight: 500 }}>{pct(r.share * 100, 0)}</span></span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Discount analysis" subtitle="Who funded the discount changes what it costs the brand">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(132px,1fr))', gap: 10 }}>
          {[
            { l: 'Total discounts',   v: inr(m.discounts) },
            { l: 'Discount %',        v: pct(m.discountPct) },
            { l: 'Discount / Order',  v: inr(m.discountPerOrder) },
            { l: 'Platform-funded',   v: inr(m.discountPlatform), s: pct(m.platformFundedPct) },
            { l: 'Brand-funded',      v: inr(m.discountBrand),    s: pct(100 - m.platformFundedPct) },
          ].map(x => (
            <div key={x.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
              <div className="tiny muted">{x.l}</div>
              <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{x.v}</div>
              {x.s && <div className="tiny muted">{x.s} of discount</div>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Where returns and cancellations concentrate" subtitle="By channel — the fastest route to a root cause" flush>
        <DataTable
          searchable={false} pageSize={8}
          columns={[
            { key: 'name', label: 'Channel', render: r => (
              <span className="hstack" style={{ gap: 8 }}>
                <span className="swatch" style={{ background: r.color }} />
                <span style={{ fontWeight: 500 }}>{r.name}</span>
              </span>
            )},
            { key: 'returnPct', label: 'Return %', align: 'right', render: r => <span style={r.returnPct > 12 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>{pct(r.returnPct)}</span> },
            { key: 'rtoPct',    label: 'RTO %',    align: 'right', render: r => pct(r.rtoPct) },
            { key: 'cancelPct', label: 'Cancel %', align: 'right', render: r => <span style={r.cancelPct > 6 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>{pct(r.cancelPct)}</span> },
            { key: 'discountPct', label: 'Discount %', align: 'right', render: r => pct(r.discountPct) },
            { key: 'platformFundedPct', label: 'Platform-funded', align: 'right', render: r => pct(r.platformFundedPct) },
            { key: 'returns',   label: 'Return value', align: 'right', render: r => inr(r.returns) },
            { key: 'cancellations', label: 'Cancelled value', align: 'right', render: r => inr(r.cancellations) },
          ]}
          rows={rows}
          initialSort={{ key: 'returnPct', dir: 'desc' }}
          emptyText="No channel activity in this period"
        />
      </Card>
    </div>
  );
}
