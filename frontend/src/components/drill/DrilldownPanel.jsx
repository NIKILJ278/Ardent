import { useMemo } from 'react';
import {
  X, ArrowLeft, ChevronRight, Layers, Package, Tag, Store, Receipt,
} from 'lucide-react';
import { useDrill } from '../../state/Drilldown.jsx';
import { useApp } from '../../state/AppState.jsx';
import {
  totals, groupBy, series, financials, salesModel, skuBreakdown, forecastFor,
} from '../../data/engine.js';
import { CHANNEL_BY_ID, PRODUCT_BY_ID, COMPANY_BY_ID, variantById } from '../../data/catalog.js';
import { money, num, pct, fmtDate, changePct } from '../../lib/format.js';
import { DataTable, BarList, Pill, Delta, Card } from '../ui/index.jsx';
import { NotConnected } from '../ui/NotConnected.jsx';
import { RevenueTrend } from '../charts/index.jsx';
import { ExportMenu } from '../shell/Shell.jsx';
import { channelColor } from '../../lib/channels.js';

const LEVEL_ICON = {
  metric: Layers, channel: Store, brand: Store, category: Tag,
  product: Package, sku: Package, transactions: Receipt,
};

/* ── Comparison strip ──────────────────────────────────────────────────────
   Two honest bases: the previous period, which is measured, and a straight-line
   forecast of this one, which is arithmetic on the real run-rate. Targets and
   budgets were fixed multiples of the actuals — comparing the business against
   itself — and are gone until a goal supplies one.
   ──────────────────────────────────────────────────────────────────────── */

function CompareStrip({ value, period, prevValue }) {
  const forecast = forecastFor(period, value);
  const rows = [
    { label: 'vs Previous Period', base: prevValue, note: money(prevValue) },
    { label: 'vs Projected Full Period', base: forecast, note: money(forecast) },
  ];

  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(148px,1fr))', gap: 10 }}>
      {rows.map(r => {
        const pctDiff = r.base ? ((value - r.base) / r.base) * 100 : null;
        return (
          <div key={r.label} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            padding: '9px 11px', background: 'var(--surface-2)',
          }}>
            <div className="tiny muted" style={{ marginBottom: 3 }}>{r.label}</div>
            <div className="hstack" style={{ gap: 7 }}>
              <Delta value={pctDiff} />
              <span className="tiny muted tnum">{r.note}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── How a financial figure is built ───────────────────────────────────── */

function Derivation({ rows, result }) {
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="spread" style={{
          padding: '7px 0',
          borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
        }}>
          <span className="small" style={{ color: r.strong ? 'var(--ink)' : 'var(--ink-2)', fontWeight: r.strong ? 600 : 400 }}>
            {r.label}
          </span>
          <span className="small tnum" style={{
            fontWeight: r.strong ? 600 : 500,
            color: r.negative ? 'var(--critical-ink)' : 'var(--ink)',
          }}>
            {r.negative ? '−' : ''}{money(Math.abs(r.value))}
          </span>
        </div>
      ))}
      {result && (
        <div className="spread" style={{ marginTop: 8, paddingTop: 10, borderTop: '2px solid var(--border-strong)' }}>
          <span style={{ fontWeight: 600 }}>{result.label}</span>
          <span className="tnum" style={{ fontWeight: 700, fontSize: 15 }}>{money(result.value)}</span>
        </div>
      )}
    </div>
  );
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

export default function DrilldownPanel() {
  const { stack, push, back, goTo, close, isOpen } = useDrill();
  const { period, prevScope } = useApp();
  const node = stack[stack.length - 1];

  const body = useMemo(() => {
    if (!node) return null;
    return renderLevel({ node, push, period, prevScope });
  }, [node, push, period, prevScope]);

  if (!isOpen || !node) return null;
  const Icon = LEVEL_ICON[node.type] ?? Layers;

  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={node.label}>
        <div className="drawer-head">
          {stack.length > 1 && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={back} aria-label="Back" title="Back">
              <ArrowLeft size={16} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="crumbs">
              {stack.map((s, i) => (
                <span key={i} className="hstack" style={{ gap: 4 }}>
                  {i > 0 && <ChevronRight size={11} className="muted" />}
                  <button
                    className={`crumb${i === stack.length - 1 ? ' last' : ''}`}
                    onClick={i === stack.length - 1 ? undefined : () => goTo(i)}
                  >
                    {s.label}
                  </button>
                </span>
              ))}
            </div>
            <div className="hstack" style={{ gap: 8 }}>
              <Icon size={17} style={{ color: 'var(--ink-3)' }} />
              <h2 style={{ fontSize: 17 }}>{node.label}</h2>
            </div>
          </div>
          <div className="hstack" style={{ gap: 6 }}>
            <ExportMenu compact />
            <button className="btn btn-ghost btn-icon" onClick={close} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="drawer-body">{body}</div>
      </aside>
    </>
  );
}

/* ── Level renderers ───────────────────────────────────────────────────── */

function renderLevel({ node, push, period, prevScope }) {
  switch (node.type) {
    case 'metric':   return <MetricLevel  node={node} push={push} period={period} prevScope={prevScope} />;
    case 'channel':  return <SplitLevel   node={node} push={push} dimension="category" />;
    case 'brand':    return <SplitLevel   node={node} push={push} dimension="category" />;
    case 'category': return <SplitLevel   node={node} push={push} dimension="product" />;
    case 'product':  return <ProductLevel node={node} push={push} />;
    case 'sku':      return <SkuLevel     node={node} />;
    default:         return null;
  }
}

/* Top level — a KPI was clicked. */
function MetricLevel({ node, push, period, prevScope }) {
  const scope = node.scope;
  const fin = financials(scope);
  const prevFin = financials({ ...prevScope });
  const metric = node.metric ?? 'netSales';

  const value = fin[metric] ?? fin.netSales;
  const prevValue = prevFin[metric] ?? prevFin.netSales;

  const byChannel = groupBy(scope, 'channel');
  const chartData = series(scope, 'day').map(d => ({ label: fmtDate(d.ts), value: d.net }));

  // Composed figures get an explicit derivation. Only the ones real order data
  // can build are offered — there is no EBITDA or net profit to take apart.
  const DERIVATIONS = {
    netSales: {
      rows: [
        { label: 'Gross sales',   value: fin.grossSales },
        { label: 'Cancellations', value: fin.cancelValue,  negative: true },
        { label: 'Discounts',     value: fin.discount,     negative: true },
        { label: 'Returns',       value: fin.returnsValue, negative: true },
      ],
      result: { label: 'Net sales', value: fin.netSales },
    },
    grossProfit: fin.costComplete ? {
      rows: [
        { label: 'Net sales',     value: fin.netSales, strong: true },
        { label: 'Cost of goods', value: fin.cogs, negative: true },
      ],
      result: { label: 'Gross margin', value: fin.grossProfit },
    } : null,
  };
  const derivation = DERIVATIONS[metric];
  const isCurrency = node.format !== 'pct' && node.format !== 'months';

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div>
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em' }}>
          {value == null ? 'Not connected'
            : node.format === 'pct' ? pct(value)
            : node.format === 'months' ? `${value.toFixed(1)} months`
            : money(value)}
        </div>
        <div className="hstack" style={{ gap: 8, marginTop: 4 }}>
          <Delta value={changePct(value, prevValue)} invert={node.invert} />
          <span className="tiny muted">
            vs previous period ({node.format === 'pct' ? pct(prevValue) : money(prevValue)})
          </span>
        </div>
      </div>

      {isCurrency && value != null && (
        <CompareStrip value={value} period={period} prevValue={prevValue} />
      )}

      {derivation && (
        <Card title="How this number is built" subtitle="Every line is summed from your synced orders">
          <Derivation rows={derivation.rows} result={derivation.result} />
        </Card>
      )}

      {chartData.length > 1 && (
        <Card title="Trend over the period">
          <RevenueTrend data={chartData} height={200} showCompare={false} />
        </Card>
      )}

      {byChannel.length > 0 && (
        <Card title="Contribution by channel" subtitle="Select a channel to keep drilling" flush>
          <div style={{ padding: 16 }}>
            <BarList
              items={byChannel.map(c => ({
                key: c.key,
                label: CHANNEL_BY_ID[c.key]?.name ?? c.key,
                value: c.net,
                color: channelColor(c.key),
              }))}
              formatValue={money}
              onItemClick={(it) => push({
                type: 'channel',
                label: it.label,
                scope: { ...node.scope, channel: it.key },
              })}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

/** Generic "show me the next dimension down" level. */
function SplitLevel({ node, push, dimension }) {
  const scope = node.scope;
  const t = totals(scope);
  const rows = groupBy(scope, dimension);

  const nextType = { company: 'brand', category: 'category', product: 'product' }[dimension];
  const nameOf = (key) =>
    dimension === 'company' ? (COMPANY_BY_ID[key]?.name ?? key)
    : dimension === 'product' ? (PRODUCT_BY_ID[key]?.name ?? key)
    : key;

  const data = rows.map(r => ({
    id: r.key, key: r.key, name: nameOf(r.key),
    units: r.units, orders: r.orders, net: r.net,
    returnPct: r.grossSales ? (r.returnsValue / r.grossSales) * 100 : 0,
    // A margin is only shown where every unit in the row carried a cost.
    margin: r.costGaps === 0 ? r.net - r.cogs : null,
    marginPct: r.costGaps === 0 && r.net ? ((r.net - r.cogs) / r.net) * 100 : null,
    share: t.net ? (r.net / t.net) * 100 : 0,
  }));

  const columns = [
    {
      key: 'name',
      label: dimension === 'company' ? 'Brand' : dimension === 'product' ? 'Product' : 'Category',
      render: r => <span style={{ fontWeight: 500 }}>{r.name}</span>,
    },
    { key: 'units',  label: 'Units',      align: 'right', render: r => num(r.units) },
    { key: 'orders', label: 'Orders',     align: 'right', render: r => num(r.orders) },
    { key: 'net',    label: 'Net sales',  align: 'right', render: r => <strong>{money(r.net)}</strong> },
    { key: 'returnPct', label: 'Return %', align: 'right', render: r => pct(r.returnPct) },
    {
      key: 'marginPct', label: 'Margin %', align: 'right',
      render: r => (r.marginPct == null
        ? <span className="tiny muted">no unit cost</span>
        : <span style={{ color: r.marginPct >= 25 ? 'var(--good-ink)' : r.marginPct >= 12 ? 'var(--ink)' : 'var(--critical-ink)' }}>{pct(r.marginPct)}</span>),
    },
    { key: 'share', label: 'Share', align: 'right', render: r => pct(r.share) },
  ];

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        {[
          { l: 'Net sales',   v: money(t.net) },
          { l: 'Gross sales', v: money(t.grossSales) },
          { l: 'Units',       v: num(t.units) },
          { l: 'Orders',      v: num(t.orders) },
          { l: 'Returns',     v: money(t.returnsValue) },
        ].map(k => (
          <div key={k.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
            <div className="tiny muted">{k.l}</div>
            <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{k.v}</div>
          </div>
        ))}
      </div>

      <Card
        title={`Breakdown by ${dimension === 'company' ? 'brand' : dimension}`}
        subtitle="These rows sum to the total above"
        flush
      >
        <DataTable
          columns={columns}
          rows={data}
          initialSort={{ key: 'net', dir: 'desc' }}
          pageSize={10}
          onRowClick={(r) => push({
            type: nextType,
            label: r.name,
            scope: {
              ...node.scope,
              ...(dimension === 'company'  ? { company: r.key }
                : dimension === 'category' ? { category: r.key }
                : { product: r.key }),
            },
          })}
        />
      </Card>
    </div>
  );
}

/** Product → its real variants. */
function ProductLevel({ node, push }) {
  const t = totals(node.scope);
  const m = salesModel(node.scope);
  const skus = skuBreakdown(node.scope);
  const chartData = series(node.scope, 'day').map(d => ({ label: fmtDate(d.ts), value: d.net }));

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        {[
          { l: 'Net sales', v: money(m.netSales) },
          { l: 'Units',     v: num(t.units) },
          { l: 'ASP',       v: money(m.asp) },
          { l: 'Return %',  v: pct(m.returnPct) },
          { l: 'Gross margin', v: m.known.cogs ? money(m.grossMargin) : 'not connected' },
        ].map(k => (
          <div key={k.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
            <div className="tiny muted">{k.l}</div>
            <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{k.v}</div>
          </div>
        ))}
      </div>

      {chartData.length > 1 && (
        <Card title="Daily revenue"><RevenueTrend data={chartData} height={190} showCompare={false} /></Card>
      )}

      <Card title="Variants" subtitle="Each row is summed from that variant's own order lines" flush>
        <DataTable
          columns={[
            { key: 'code',  label: 'SKU', render: r => <span className="mono">{r.code}</span> },
            { key: 'label', label: 'Variant' },
            { key: 'units', label: 'Units', align: 'right', render: r => num(r.units) },
            { key: 'net',   label: 'Net sales', align: 'right', render: r => <strong>{money(r.net)}</strong> },
            { key: 'share', label: 'Share', align: 'right', render: r => pct(r.share) },
          ]}
          rows={skus.map(s => ({ ...s, share: m.netSales ? (s.net / m.netSales) * 100 : 0 }))}
          searchable={false}
          pageSize={10}
          onRowClick={(r) => push({
            type: 'sku',
            label: `${r.code} · ${r.label}`,
            scope: node.scope,
            sku: r,
          })}
          emptyText="No variants sold in this period"
        />
      </Card>
    </div>
  );
}

/** Variant — the deepest level the synced data reaches. */
function SkuLevel({ node }) {
  const { sku, scope } = node;
  const variantScope = { ...scope, variant: sku.id };
  const m = salesModel(variantScope);
  const t = totals(variantScope);
  const meta = variantById(sku.id);
  const daily = series(variantScope, 'day').map(d => ({ label: fmtDate(d.ts), value: d.net }));

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        {[
          { l: 'Units',     v: num(t.units) },
          { l: 'Orders',    v: num(t.orders) },
          { l: 'Net sales', v: money(m.netSales) },
          { l: 'ASP',       v: money(m.asp) },
          { l: 'Return %',  v: pct(m.returnPct) },
        ].map(k => (
          <div key={k.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
            <div className="tiny muted">{k.l}</div>
            <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Pill tone="neutral" icon={false}>SKU {sku.code}</Pill>
        {meta?.title && <Pill tone="neutral" icon={false}>{meta.title}</Pill>}
        <Pill tone={m.known.cogs ? 'good' : 'neutral'} icon={false}>
          {m.known.cogs ? `Cost of goods ${money(m.cogs)}` : 'No unit cost'}
        </Pill>
      </div>

      {daily.length > 1 && (
        <Card title="Daily revenue for this variant">
          <RevenueTrend data={daily} height={190} showCompare={false} />
        </Card>
      )}

      <Card title="Source transactions">
        <NotConnected
          title="Individual order lines"
          needs="an orders endpoint on the Ardent backend"
          showLink={false}
        >
          Ardent stores your orders, but this panel reads the aggregated fact table, which sums
          them by day and variant. The order-by-order list is the next thing to expose — until it
          is, these figures are the deepest level available.
        </NotConnected>
      </Card>
    </div>
  );
}
