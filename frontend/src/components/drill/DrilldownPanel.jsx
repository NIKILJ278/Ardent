import { useMemo } from 'react';
import {
  X, ArrowLeft, ChevronRight, Layers, Package, Tag, Store, Receipt,
} from 'lucide-react';
import { useDrill } from '../../state/Drilldown.jsx';
import { useApp } from '../../state/AppState.jsx';
import {
  totals, groupBy, series, financials, skuBreakdown, transactionsFor,
  targetFor, budgetFor, forecastFor,
} from '../../data/engine.js';
import {
  CHANNEL_BY_ID, PRODUCT_BY_ID, COMPANY_BY_ID,
} from '../../data/catalog.js';
import { inr, inrExact, num, pct, fmtDate, changePct } from '../../lib/format.js';
import { DataTable, BarList, Pill, Delta, Card } from '../ui/index.jsx';
import { RevenueTrend } from '../charts/index.jsx';
import { ExportMenu } from '../shell/Shell.jsx';
import { channelColor } from '../../lib/channels.js';

const LEVEL_ICON = {
  metric: Layers, channel: Store, brand: Store, category: Tag,
  product: Package, sku: Package, transactions: Receipt,
};

/* ── Comparison strip: vs target / previous / year / budget / forecast ─── */

function CompareStrip({ value, companyId, period, prevValue }) {
  const target = targetFor(companyId, value);
  const budget = budgetFor(companyId, value);
  const forecast = forecastFor(period, value);

  const rows = [
    { label: 'vs Target',          base: target,    note: inr(target) },
    { label: 'vs Previous Period', base: prevValue, note: inr(prevValue) },
    { label: 'vs Budget',          base: budget,    note: inr(budget) },
    { label: 'vs Forecast',        base: forecast,  note: inr(forecast) },
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
            {r.negative ? '−' : ''}{inr(Math.abs(r.value))}
          </span>
        </div>
      ))}
      {result && (
        <div className="spread" style={{ marginTop: 8, paddingTop: 10, borderTop: '2px solid var(--border-strong)' }}>
          <span style={{ fontWeight: 600 }}>{result.label}</span>
          <span className="tnum" style={{ fontWeight: 700, fontSize: 15 }}>{inr(result.value)}</span>
        </div>
      )}
    </div>
  );
}

/* ── Panel ─────────────────────────────────────────────────────────────── */

export default function DrilldownPanel() {
  const { stack, push, back, goTo, close, isOpen } = useDrill();
  const { companyId, period, prevScope } = useApp();
  const node = stack[stack.length - 1];

  const body = useMemo(() => {
    if (!node) return null;
    return renderLevel({ node, push, companyId, period, prevScope });
  }, [node, push, companyId, period, prevScope]);

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

function renderLevel({ node, push, companyId, period, prevScope }) {
  switch (node.type) {
    case 'metric':      return <MetricLevel  node={node} push={push} companyId={companyId} period={period} prevScope={prevScope} />;
    case 'channel':     return <SplitLevel   node={node} push={push} dimension={companyId === 'all' ? 'company' : 'category'} />;
    case 'brand':       return <SplitLevel   node={node} push={push} dimension="category" />;
    case 'category':    return <SplitLevel   node={node} push={push} dimension="product" />;
    case 'product':     return <ProductLevel node={node} push={push} />;
    case 'sku':         return <SkuLevel     node={node} />;
    default:            return null;
  }
}

/* Top level — a KPI was clicked. */
function MetricLevel({ node, push, companyId, period, prevScope }) {
  const scope = node.scope;
  const fin = financials(scope);
  const prevFin = financials({ ...prevScope });
  const metric = node.metric ?? 'net';

  const value = fin[metric] ?? fin.net;
  const prevValue = prevFin[metric] ?? prevFin.net;

  const byChannel = groupBy(scope, 'channel');
  const chartData = series(scope, 'day').map(d => ({ label: fmtDate(d.ts), value: d.net }));

  // Metrics that are composed rather than summed get an explicit derivation.
  const DERIVATIONS = {
    net: {
      rows: [
        { label: 'Gross sales',            value: fin.gross },
        { label: 'Discounts & promotions', value: fin.discount,     negative: true },
        { label: 'Marketplace fees',       value: fin.fees,         negative: true },
        { label: 'Shipping & fulfilment',  value: fin.shipping,     negative: true },
        { label: 'Returns & RTO',          value: fin.returnsValue, negative: true },
      ],
      result: { label: 'Net revenue', value: fin.net },
    },
    ebitda: {
      rows: [
        { label: 'Net revenue',        value: fin.net, strong: true },
        { label: 'Cost of goods sold', value: fin.cogs,      negative: true },
        { label: 'Marketing',          value: fin.marketing, negative: true },
        { label: 'Salaries',           value: fin.salaries,  negative: true },
        { label: 'Logistics',          value: fin.logistics, negative: true },
        { label: 'Overheads',          value: fin.overheads, negative: true },
      ],
      result: { label: 'EBITDA', value: fin.ebitda },
    },
    netProfit: {
      rows: [
        { label: 'EBITDA',       value: fin.ebitda, strong: true },
        { label: 'Depreciation', value: fin.depreciation, negative: true },
        { label: 'Interest',     value: fin.interest,     negative: true },
        { label: 'Tax',          value: fin.tax,          negative: true },
      ],
      result: { label: 'Net profit', value: fin.netProfit },
    },
  };
  const derivation = DERIVATIONS[metric];
  const isCurrency = node.format !== 'pct' && node.format !== 'months';

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div>
        <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em' }}>
          {node.format === 'pct' ? pct(value)
            : node.format === 'months' ? `${value.toFixed(1)} months`
            : inr(value)}
        </div>
        <div className="hstack" style={{ gap: 8, marginTop: 4 }}>
          <Delta value={changePct(value, prevValue)} invert={node.invert} />
          <span className="tiny muted">vs previous period ({node.format === 'pct' ? pct(prevValue) : inr(prevValue)})</span>
        </div>
      </div>

      {isCurrency && (
        <CompareStrip value={value} companyId={companyId} period={period} prevValue={prevValue} />
      )}

      {derivation && (
        <Card title="How this number is built" subtitle="Every line is summed from source transactions">
          <Derivation rows={derivation.rows} result={derivation.result} />
        </Card>
      )}

      {chartData.length > 1 && (
        <Card title="Trend over the period">
          <RevenueTrend data={chartData} height={200} showCompare={false} />
        </Card>
      )}

      <Card
        title="Contribution by channel"
        subtitle="Select a channel to keep drilling"
        flush
      >
        <div style={{ padding: 16 }}>
          <BarList
            items={byChannel.map(c => ({
              key: c.key,
              label: CHANNEL_BY_ID[c.key]?.name ?? c.key,
              value: c.net,
              color: channelColor(c.key),
            }))}
            formatValue={inr}
            onItemClick={(it) => push({
              type: 'channel',
              label: it.label,
              scope: { ...node.scope, channel: it.key },
            })}
          />
        </div>
      </Card>
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

  const columns = [
    {
      key: 'name',
      label: dimension === 'company' ? 'Brand' : dimension === 'product' ? 'Product' : 'Category',
      render: r => (
        <span className="hstack" style={{ gap: 7 }}>
          <span style={{ fontWeight: 500 }}>{r.name}</span>
          {r.isNew && <Pill tone="info" icon={false}>New</Pill>}
        </span>
      ),
    },
    { key: 'units',  label: 'Units',      align: 'right', render: r => num(r.units) },
    { key: 'orders', label: 'Orders',     align: 'right', render: r => num(r.orders) },
    { key: 'net',    label: 'Net revenue',align: 'right', render: r => <strong>{inr(r.net)}</strong> },
    { key: 'margin', label: 'Margin',     align: 'right', render: r => inr(r.margin) },
    {
      key: 'marginPct', label: 'Margin %', align: 'right',
      render: r => <span style={{ color: r.marginPct >= 25 ? 'var(--good-ink)' : r.marginPct >= 12 ? 'var(--ink)' : 'var(--critical-ink)' }}>{pct(r.marginPct)}</span>,
    },
    { key: 'share', label: 'Share', align: 'right', render: r => pct(r.share) },
  ];

  const data = rows.map(r => {
    const product = dimension === 'product' ? PRODUCT_BY_ID[r.key] : null;
    return {
      id: r.key, key: r.key, name: nameOf(r.key),
      units: r.units, orders: r.orders, net: r.net, margin: r.margin,
      marginPct: r.net ? (r.margin / r.net) * 100 : 0,
      share: t.net ? (r.net / t.net) * 100 : 0,
      isNew: !!product?.launchedOn,
    };
  });

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        {[
          { l: 'Net revenue', v: inr(t.net) },
          { l: 'Gross sales', v: inr(t.gross) },
          { l: 'Units',       v: num(t.units) },
          { l: 'Orders',      v: num(t.orders) },
          { l: 'Margin',      v: inr(t.margin) },
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

/** Product → SKUs. */
function ProductLevel({ node, push }) {
  const t = totals(node.scope);
  const skus = skuBreakdown(node.scope);
  const product = PRODUCT_BY_ID[node.scope.product];
  const chartData = series(node.scope, 'day').map(d => ({ label: fmtDate(d.ts), value: d.net }));

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        {[
          { l: 'Net revenue', v: inr(t.net) },
          { l: 'Units',       v: num(t.units) },
          { l: 'Selling price', v: inrExact(product?.price) },
          { l: 'Margin',      v: inr(t.margin) },
          { l: 'Margin %',    v: pct(t.net ? (t.margin / t.net) * 100 : 0) },
        ].map(k => (
          <div key={k.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
            <div className="tiny muted">{k.l}</div>
            <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{k.v}</div>
          </div>
        ))}
      </div>

      {product?.launchedOn && (
        <div className="hstack" style={{ gap: 8, padding: '10px 12px', background: 'var(--accent-soft)', borderRadius: 'var(--radius-sm)' }}>
          <Pill tone="info" icon={false}>New product</Pill>
          <span className="small">Launched {fmtDate(product.launchedOn, 'long')}</span>
        </div>
      )}

      {chartData.length > 1 && (
        <Card title="Daily revenue"><RevenueTrend data={chartData} height={190} showCompare={false} /></Card>
      )}

      <Card title="SKU breakdown" subtitle="Select a SKU to see its transactions" flush>
        <DataTable
          columns={[
            { key: 'code',  label: 'SKU', render: r => <span className="mono">{r.code}</span> },
            { key: 'label', label: 'Variant' },
            { key: 'units', label: 'Units', align: 'right', render: r => num(r.units) },
            { key: 'net',   label: 'Net revenue', align: 'right', render: r => <strong>{inr(r.net)}</strong> },
            { key: 'share', label: 'Share', align: 'right', render: r => pct(r.ratio * 100) },
          ]}
          rows={skus.map(s => ({ ...s, share: s.ratio * 100 }))}
          searchable={false}
          pageSize={10}
          onRowClick={(r) => push({
            type: 'sku',
            label: `${r.code} · ${r.label}`,
            scope: node.scope,
            sku: r,
          })}
        />
      </Card>
    </div>
  );
}

/** SKU → transactions (the bottom of the drill). */
function SkuLevel({ node }) {
  const { sku, scope } = node;
  const rows = transactionsFor({
    skuId: sku.id, productId: scope.product, channel: scope.channel,
    start: scope.start, end: scope.end, limit: 200,
  });
  const sum = rows.reduce((s, r) => s + r.net, 0);

  const STATUS_TONE = { Delivered: 'good', 'In Transit': 'info', Returned: 'warning', RTO: 'critical' };

  return (
    <div className="vstack" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        {[
          { l: 'Transactions', v: num(rows.length) },
          { l: 'Units',        v: num(rows.reduce((s, r) => s + r.qty, 0)) },
          { l: 'Net value',    v: inr(sum) },
          { l: 'SKU',          v: sku.code },
        ].map(k => (
          <div key={k.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
            <div className="tiny muted">{k.l}</div>
            <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{k.v}</div>
          </div>
        ))}
      </div>

      <Card
        title="Source transactions"
        subtitle="The lowest level Ardent holds — matched to the platform's own report"
        flush
      >
        <DataTable
          columns={[
            { key: 'id',      label: 'Order ID', render: r => <span className="mono">{r.id}</span> },
            { key: 'date',    label: 'Date',     render: r => fmtDate(r.ts) },
            { key: 'city',    label: 'Location', render: r => <span>{r.city} <span className="muted tiny">{r.state}</span></span> },
            { key: 'qty',     label: 'Qty',      align: 'right' },
            { key: 'gross',   label: 'Gross',    align: 'right', render: r => inrExact(r.gross) },
            { key: 'fee',     label: 'Fees',     align: 'right', render: r => <span className="muted">−{inrExact(r.fee)}</span> },
            { key: 'net',     label: 'Net',      align: 'right', render: r => <strong>{inrExact(r.net)}</strong> },
            { key: 'payment', label: 'Payment',  render: r => <span className="small muted">{r.payment}</span> },
            { key: 'status',  label: 'Status',   render: r => <Pill tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Pill> },
          ]}
          rows={rows}
          initialSort={{ key: 'date', dir: 'desc' }}
          pageSize={15}
          searchKeys={['id', 'city', 'status', 'payment']}
        />
      </Card>
    </div>
  );
}
