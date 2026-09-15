import { useMemo, useState } from 'react';
import { PackageSearch, AlertTriangle, TrendingDown } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { inventorySnapshot, STOCK_STATES, MOVEMENT } from '../data/inventory.js';
import { inr, num, pct, periodLabel, periodRange, asAt } from '../lib/format.js';
import { Card, Pill, DataTable, Segmented, Track } from '../components/ui/index.jsx';

const coverText = (w) => (w === Infinity ? '∞' : `${w.toFixed(1)}w`);

function Figure({ label, value, sub, tone, strong }) {
  return (
    <div className="kpi" style={{ cursor: 'default' }}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value tnum" style={{
        color: tone === 'critical' ? 'var(--critical-ink)' : tone === 'warning' ? 'var(--warning-ink)'
          : tone === 'good' ? 'var(--good-ink)' : 'var(--ink)',
        fontWeight: strong ? 700 : 600,
      }}>{value}</span>
      {sub && <span className="kpi-sub"><span className="muted">{sub}</span></span>}
    </div>
  );
}

export default function Inventory() {
  const { period, companyId, today } = useApp();
  const [level, setLevel] = useState('product');

  const snap = useMemo(() => inventorySnapshot({ period, companyId }), [period, companyId]);

  const rows = level === 'product' ? snap.products : snap.skus;
  const movementCounts = Object.keys(MOVEMENT).map(k => ({
    id: k,
    ...MOVEMENT[k],
    count: snap.products.filter(p => p.movement === k).length,
    value: snap.products.filter(p => p.movement === k).reduce((s, p) => s + p.valueAtCost, 0),
  }));

  const stateCounts = Object.keys(STOCK_STATES).map(k => ({
    id: k, ...STOCK_STATES[k],
    count: snap.products.filter(p => p.state === k).length,
  })).filter(s => s.count > 0);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Inventory</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          What you are holding, what it is worth, and what needs ordering.
        </p>
        <p className="tiny muted" style={{ margin: '4px 0 0' }}>
          Position {asAt(today)} · demand measured over {periodLabel(period)} ({periodRange(period)})
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(158px,1fr))' }}>
        <Figure label="Stock value" value={inr(snap.valueAtCost)} sub="at landed cost" strong />
        <Figure label="Retail value" value={inr(snap.valueAtRetail)} sub="at selling price" />
        <Figure label="Units on hand" value={num(snap.unitsOnHand)} sub={`${num(snap.skuCount)} SKUs`} />
        <Figure label="On order" value={num(snap.unitsOnOrder)} sub="in transit" />
        <Figure label="Inventory turns" value={`${snap.turns.toFixed(1)}x`} sub="annualised" />
        <Figure label="Days of cover" value={`${Math.round(snap.daysOfCover)}`} sub="at current run-rate" />
        <Figure
          label="Needs attention"
          value={num(snap.stockouts + snap.lowCover)}
          sub={`${snap.stockouts} out · ${snap.lowCover} low`}
          tone={snap.stockouts > 0 ? 'critical' : snap.lowCover > 0 ? 'warning' : 'good'}
        />
      </div>

      {snap.actions.length > 0 && (
        <div className="hstack" style={{
          gap: 10, padding: '12px 14px', background: 'var(--warning-soft)',
          border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
          borderRadius: 'var(--radius)',
        }}>
          <AlertTriangle size={17} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--warning-ink)' }}>
              {snap.actions.length} product{snap.actions.length === 1 ? '' : 's'} need buying attention
            </div>
            <div className="small" style={{ color: 'var(--warning-ink)', opacity: 0.9 }}>
              {snap.atRisk.length > 0 && `${snap.atRisk.length} will run out before the inbound order lands — expedite rather than re-order. `}
              {snap.reorders.length > 0 && `${snap.reorders.length} have no cover on order at all.`}
            </div>
          </div>
        </div>
      )}

      <Card
        title="Replenishment watch"
        subtitle="Stock already on order is accounted for — this is only what still needs a decision"
        flush
        actions={<span className="tiny muted">{snap.inTransitCount} product(s) with stock in transit</span>}
      >
        {snap.actions.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <h4>Nothing needs buying attention</h4>
            <p>
              Every product is above its reorder point, or already has replenishment arriving before cover runs out.
            </p>
          </div>
        ) : (
          <DataTable
            searchable={false}
            pageSize={8}
            columns={[
              { key: 'productName', label: 'Product', render: r => (
                <span>
                  <span style={{ fontWeight: 500 }}>{r.productName}</span>
                  <span className="tiny muted" style={{ display: 'block' }}>{r.category} → {r.subcategory}</span>
                </span>
              )},
              { key: 'onHand', label: 'On hand', align: 'right', render: r => num(r.onHand) },
              { key: 'onOrder', label: 'In transit', align: 'right', render: r => r.onOrder ? num(r.onOrder) : <span className="muted">—</span> },
              { key: 'coverWeeks', label: 'Cover', align: 'right', render: r => (
                <span style={{ color: r.coverWeeks < 2 ? 'var(--critical-ink)' : 'var(--warning-ink)', fontWeight: 600 }}>
                  {coverText(r.coverWeeks)}
                </span>
              )},
              { key: 'weeksToArrival', label: 'Arrives in', align: 'right',
                render: r => (r.weeksToArrival != null ? `${r.weeksToArrival}w` : <span className="muted">nothing due</span>) },
              { key: 'projectedShortfall', label: 'Short by', align: 'right', render: r => (
                r.projectedShortfall
                  ? <span className="tnum" style={{ color: 'var(--critical-ink)', fontWeight: 600 }}>{num(r.projectedShortfall)}u</span>
                  : <span className="muted">—</span>
              )},
              { key: 'action', label: 'Action', sortable: false, render: r => (
                r.state === 'stockout' ? <Pill tone="critical">Stocked out</Pill>
                : r.willStockOut ? <Pill tone="critical">Expedite</Pill>
                : <Pill tone="warning">Raise order</Pill>
              )},
              { key: 'reorderQty', label: 'Suggested qty', align: 'right', render: r => (
                r.reorderQty ? <strong>{num(r.reorderQty)}</strong> : <span className="muted">—</span>
              )},
            ]}
            rows={snap.actions}
            initialSort={{ key: 'coverWeeks', dir: 'asc' }}
            emptyText="Nothing needs attention"
          />
        )}
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <Card title="Stock health" subtitle="Products by cover position">
          <div className="vstack" style={{ gap: 11 }}>
            {stateCounts.map(s => (
              <div key={s.id}>
                <div className="spread" style={{ marginBottom: 5 }}>
                  <span className="hstack" style={{ gap: 7 }}>
                    <span className={`dot ${s.tone}`} />
                    <span className="small">{s.label}</span>
                  </span>
                  <span className="tnum small" style={{ fontWeight: 600 }}>{s.count}</span>
                </div>
                <Track value={(s.count / Math.max(1, snap.productCount)) * 100} tone={s.tone} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Capital by movement" subtitle="Where the stock investment is sitting">
          <div className="vstack" style={{ gap: 11 }}>
            {movementCounts.map(mv => (
              <div key={mv.id}>
                <div className="spread" style={{ marginBottom: 5 }}>
                  <span className="hstack" style={{ gap: 7 }}>
                    <span className={`dot ${mv.tone}`} />
                    <span className="small">{mv.label}</span>
                    <span className="tiny muted">{mv.count} product{mv.count === 1 ? '' : 's'}</span>
                  </span>
                  <span className="tnum small" style={{ fontWeight: 600 }}>{inr(mv.value)}</span>
                </div>
                <Track
                  value={snap.valueAtCost ? (mv.value / snap.valueAtCost) * 100 : 0}
                  tone={mv.tone}
                />
              </div>
            ))}
          </div>
          {(snap.deadValue > 0 || snap.slowValue > 0) && (
            <div className="hstack" style={{ gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <TrendingDown size={14} style={{ color: 'var(--warning-ink)' }} />
              <span className="small" style={{ color: 'var(--ink-2)' }}>
                {inr(snap.deadValue + snap.slowValue)} is tied up in stock that is not turning.
              </span>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Stock position"
        subtitle="Every line, with cover and value"
        flush
        actions={
          <Segmented
            options={[{ id: 'product', label: 'Products' }, { id: 'sku', label: 'SKUs' }]}
            value={level} onChange={setLevel} size="sm"
          />
        }
      >
        <DataTable
          pageSize={14}
          searchKeys={level === 'product' ? ['productName', 'category', 'subcategory'] : ['code', 'productName', 'variant', 'category']}
          columns={[
            level === 'product'
              ? { key: 'productName', label: 'Product', render: r => (
                  <span>
                    <span style={{ fontWeight: 500 }}>{r.productName}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{r.category} → {r.subcategory}</span>
                  </span>
                )}
              : { key: 'code', label: 'SKU', render: r => (
                  <span>
                    <span className="mono" style={{ fontWeight: 600 }}>{r.code}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{r.productName} · {r.variant}</span>
                  </span>
                )},
            { key: 'onHand', label: 'On hand', align: 'right', render: r => <strong>{num(r.onHand)}</strong> },
            { key: 'onOrder', label: 'In transit', align: 'right', render: r => r.onOrder ? num(r.onOrder) : <span className="muted">—</span> },
            { key: 'unitsSold', label: 'Sold', align: 'right', render: r => num(r.unitsSold) },
            { key: 'weeklyDemand', label: 'Demand / wk', align: 'right', render: r => r.weeklyDemand.toFixed(0) },
            { key: 'coverWeeks', label: 'Cover', align: 'right', render: r => (
              <span style={{
                fontWeight: 600,
                color: r.coverWeeks < 2 ? 'var(--critical-ink)'
                  : r.coverWeeks < 4 ? 'var(--warning-ink)'
                  : r.coverWeeks > 16 ? 'var(--warning-ink)' : 'var(--ink)',
              }}>{coverText(r.coverWeeks)}</span>
            )},
            { key: 'valueAtCost', label: 'Value at cost', align: 'right', render: r => inr(r.valueAtCost) },
            { key: 'share', label: 'Share', align: 'right', sortValue: r => r.valueAtCost,
              render: r => pct(snap.valueAtCost ? (r.valueAtCost / snap.valueAtCost) * 100 : 0) },
            { key: 'movement', label: 'Movement', sortable: false,
              render: r => <Pill tone={MOVEMENT[r.movement].tone} icon={false}>{MOVEMENT[r.movement].label}</Pill> },
            { key: 'state', label: 'Position', sortable: false,
              render: r => <Pill tone={STOCK_STATES[r.state].tone}>{STOCK_STATES[r.state].label}</Pill> },
          ]}
          rows={rows}
          initialSort={{ key: 'valueAtCost', dir: 'desc' }}
          emptyText="No stock for this brand"
        />
      </Card>

      <div className="hstack" style={{ gap: 8, color: 'var(--ink-3)' }}>
        <PackageSearch size={13} />
        <span className="tiny">
          Stock is the running balance of receipts, restocked returns and units sold, valued at the same
          landed cost the P&amp;L charges out. It is company-wide — one warehouse serves every channel.
        </span>
      </div>
    </div>
  );
}
