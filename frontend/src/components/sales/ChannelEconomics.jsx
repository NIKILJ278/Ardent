import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import {
  salesModel, marketplaceWaterfall, series, groupBy,
} from '../../data/engine.js';
import { CHANNELS, PRODUCT_BY_ID } from '../../data/catalog.js';
import { inr, num, pct, fmtDate, changePct } from '../../lib/format.js';
import { Card, Segmented, Delta, Popover, Pill } from '../ui/index.jsx';
import { WaterfallChart, MeasureBars } from '../charts/index.jsx';
import { channelColor } from '../../lib/channels.js';

/* ── 1. Sales — one toggle, one chart, one space ────────────────────────── */

export function SalesToggleSection({ scope, prevScope }) {
  const [mode, setMode] = useState('gmv');   // a true toggle, never both at once

  const weeks = useMemo(() => {
    const rows = series(scope, 'week');
    return rows.map((d, i) => {
      const value = mode === 'gmv' ? d.grossSales : d.units;
      const prev = i > 0 ? (mode === 'gmv' ? rows[i - 1].grossSales : rows[i - 1].units) : null;
      return {
        label: `w/c ${fmtDate(d.ts)}`,
        value,
        wow: prev ? ((value - prev) / prev) * 100 : null,
        color: 'var(--series-1)',
      };
    });
  }, [scope, mode]);

  const cur = useMemo(() => salesModel(scope), [scope]);
  const prv = useMemo(() => salesModel(prevScope), [prevScope]);

  const total = mode === 'gmv' ? cur.grossSales : cur.units;
  const prevTotal = mode === 'gmv' ? prv.grossSales : prv.units;
  const lastWow = weeks.length ? weeks[weeks.length - 1].wow : null;

  return (
    <Card
      title="Sales"
      subtitle="How much are we selling?"
      actions={
        <Segmented
          options={[{ id: 'gmv', label: 'GMV' }, { id: 'units', label: 'Units' }]}
          value={mode} onChange={setMode} size="sm"
        />
      }
    >
      <div className="hstack" style={{ gap: 26, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div className="kpi-label">{mode === 'gmv' ? 'Gross Merchandise Value' : 'Units Sold'}</div>
          <div className="tnum" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {mode === 'gmv' ? inr(total) : num(total)}
          </div>
          <div className="hstack" style={{ gap: 8, marginTop: 3 }}>
            <Delta value={changePct(total, prevTotal)} />
            <span className="tiny muted">vs previous period</span>
          </div>
        </div>
        {lastWow != null && (
          <div>
            <div className="kpi-label">Latest week on week</div>
            <div className="hstack" style={{ gap: 7, marginTop: 4 }}>
              <Delta value={lastWow} />
              <span className="tiny muted">
                {mode === 'gmv' ? inr(weeks[weeks.length - 1].value) : `${num(weeks[weeks.length - 1].value)} units`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* The only sales trend on this page. Same space in both toggle states. */}
      <MeasureBars
        data={weeks}
        height={190}
        valueFmt={mode === 'gmv' ? inr : num}
      />
      <div className="ladder-foot" style={{ marginTop: 4 }}>
        Week-on-week {mode === 'gmv' ? 'GMV' : 'units'} across the selected period.
      </div>
    </Card>
  );
}

/* ── 2 & 3. Marketplace economics, each with its own drill hierarchy ────── */

const HIER = [
  { dim: 'category',    label: 'Category' },
  { dim: 'subcategory', label: 'Subcategory' },
  { dim: 'product',     label: 'Product' },
];

const nameFor = (dim, key) => (dim === 'product' ? (PRODUCT_BY_ID[key]?.name ?? key) : key);

function MarketplaceCard({ channel, scope }) {
  const [path, setPath] = useState([]);   // [{dim, key}] within this marketplace

  const cardScope = useMemo(
    () => path.reduce((a, s) => ({ ...a, [s.dim]: s.key }), { ...scope, channel: channel.id }),
    [scope, channel.id, path]
  );
  const model = useMemo(() => salesModel(cardScope), [cardScope]);
  const steps = useMemo(() => marketplaceWaterfall(model), [model]);

  // The next level down, if there is one.
  const nextLevel = HIER[path.length];
  const options = useMemo(
    () => (nextLevel ? groupBy(cardScope, nextLevel.dim) : []),
    [cardScope, nextLevel]
  );

  const crumbs = [
    { label: 'All Products', at: 0 },
    ...path.map((s, i) => ({ label: nameFor(s.dim, s.key), at: i + 1 })),
  ];

  return (
    <Card
      title={
        <span className="hstack" style={{ gap: 8 }}>
          <span className="swatch" style={{ background: channelColor(channel.id) }} />
          {channel.name}
          <Pill tone="neutral" icon={false}>
            {channel.kind === 'marketplace' ? 'Marketplace' : 'Own store'}
          </Pill>
        </span>
      }
      subtitle={crumbs.map(c => c.label).join(' → ')}
      actions={
        nextLevel && options.length > 0 ? (
          <Popover
            align="right" width={244}
            trigger={({ toggle }) => (
              <button className="btn btn-sm" onClick={toggle}>
                {nextLevel.label}<ChevronDown size={13} style={{ opacity: 0.6 }} />
              </button>
            )}
          >
            {({ close }) => (
              <>
                <div className="pop-label">Drill into {nextLevel.label.toLowerCase()}</div>
                {options.slice(0, 12).map(o => (
                  <button
                    key={o.key} className="pop-item"
                    onClick={() => { setPath([...path, { dim: nextLevel.dim, key: o.key }]); close(); }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {nameFor(nextLevel.dim, o.key)}
                    </span>
                    <span className="tiny muted tnum">{inr(o.grossSales)}</span>
                  </button>
                ))}
              </>
            )}
          </Popover>
        ) : null
      }
    >
      {/* Breadcrumb — the hierarchy, not four unrelated filters */}
      {crumbs.length > 1 && (
        <div className="crumbs" style={{ marginBottom: 10 }}>
          {crumbs.map((c, i) => (
            <span key={i} className="hstack" style={{ gap: 4 }}>
              {i > 0 && <ChevronRight size={11} className="muted" />}
              <button
                className={`crumb${i === crumbs.length - 1 ? ' last' : ''}`}
                onClick={i === crumbs.length - 1 ? undefined : () => setPath(path.slice(0, c.at))}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
      )}

      {model.grossSales <= 0 ? (
        <div className="empty" style={{ padding: 30 }}>No sales for this selection</div>
      ) : (
        <>
          <WaterfallChart steps={steps} height={252} />
          <div className="spread" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: 10 }}>
            <span className="hstack" style={{ gap: 18, flexWrap: 'wrap' }}>
              <span>
                <span className="tiny muted" style={{ display: 'block' }}>GMV</span>
                <span className="tnum" style={{ fontWeight: 600 }}>{inr(model.grossSales)}</span>
              </span>
              <span>
                <span className="tiny muted" style={{ display: 'block' }}>Total deductions</span>
                <span className="tnum" style={{ fontWeight: 600, color: 'var(--series-2)' }}>{inr(model.totalDeductions)}</span>
              </span>
              <span>
                <span className="tiny muted" style={{ display: 'block' }}>Realized Sales</span>
                <span className="tnum" style={{ fontWeight: 700, color: 'var(--accent)' }}>{inr(model.realizedSales)}</span>
              </span>
            </span>
            <span title="Share of GMV that reaches you after marketplace deductions">
              <Pill tone={model.realizedPct >= 62 ? 'good' : model.realizedPct >= 55 ? 'warning' : 'critical'}>
                {pct(model.realizedPct)} realization
              </Pill>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

export function MarketplaceEconomics({ scope, companyChannels }) {
  const channels = CHANNELS.filter(c => companyChannels.includes(c.id));
  return (
    <div className="vstack" style={{ gap: 14 }}>
      <div className="spread" style={{ alignItems: 'baseline' }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Marketplace economics</div>
        <span className="tiny muted">
          GMV to Marketplace Realized Sales. Internal cost and profitability are handled separately.
        </span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(430px,1fr))' }}>
        {channels.map(c => (
          <MarketplaceCard key={c.id} channel={c} scope={scope} />
        ))}
      </div>
    </div>
  );
}
