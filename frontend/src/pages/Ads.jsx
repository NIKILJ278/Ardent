import { useMemo, useState } from 'react';
import { ChevronRight, Home, Megaphone, Sparkles, AlertTriangle } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import {
  adSummary, adsByChannel, adsByDimension, campaigns, adSeries,
  newProducts, spendReconciliation, NEW_PRODUCT_DAYS,
} from '../data/ads.js';
import { CHANNEL_BY_ID, PRODUCT_BY_ID, channelsFor } from '../data/catalog.js';
import { inr, num, pct, fmtDate, periodLabel, periodRange, changePct } from '../lib/format.js';
import { Card, Pill, Delta, DataTable, Segmented, Empty } from '../components/ui/index.jsx';
import { MeasureBars } from '../components/charts/index.jsx';
import { channelColor } from '../lib/channels.js';
import { WatchButton } from '../components/watch/WatchButton.jsx';

/* ── Sub-navigation ────────────────────────────────────────────────────── */

const SECTIONS = [
  { id: 'general',   label: 'General' },
  { id: 'spend',     label: 'Ad Spend' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'channels',  label: 'Channels' },
  { id: 'products',  label: 'Products' },
  { id: 'returns',   label: 'Returns' },
  { id: 'category',  label: 'Category' },
  { id: 'new',       label: 'New Products' },
];

/** Category → Subcategory → Product, drilled in place. */
const LEVELS = [
  { dim: 'category', label: 'Category' },
  { dim: 'subcategory', label: 'Subcategory' },
  { dim: 'product', label: 'Product' },
];

/* ── Shared cells ──────────────────────────────────────────────────────── */

const roasTone = (r) => (r >= 4 ? 'var(--good-ink)' : r >= 2.5 ? 'var(--ink)' : 'var(--critical-ink)');

const Roas = ({ value }) => (
  <span className="tnum" style={{ fontWeight: 600, color: roasTone(value) }}>
    {value.toFixed(2)}x
  </span>
);

function Kpi({ label, value, sub, delta, invert, tone }) {
  return (
    <div className="ad-kpi">
      <span className="ad-kpi-label">{label}</span>
      <span className="ad-kpi-value tnum" style={tone ? { color: `var(--${tone}-ink)` } : undefined}>
        {value}
      </span>
      <span className="ad-kpi-sub">
        {delta != null && !Number.isNaN(delta) && <Delta value={delta} invert={invert} />}
        {sub && <span className="muted">{sub}</span>}
      </span>
    </div>
  );
}

/** The columns every ads table shares, so a row reads the same everywhere. */
const perfColumns = (nameLabel, renderName) => ([
  { key: 'name', label: nameLabel, render: renderName },
  { key: 'spend', label: 'Ad Spend', align: 'right', render: r => inr(r.spend) },
  { key: 'attributed', label: 'Ad Revenue', align: 'right', render: r => <strong>{inr(r.attributed)}</strong> },
  { key: 'roas', label: 'ROAS', align: 'right', render: r => <Roas value={r.roas} /> },
  { key: 'acos', label: 'ACOS', align: 'right', render: r => pct(r.acos) },
  { key: 'orders', label: 'Ad Orders', align: 'right', render: r => num(Math.round(r.orders)) },
  { key: 'cvr', label: 'Conv %', align: 'right', render: r => pct(r.cvr) },
  { key: 'returnsAttributed', label: 'Returns', align: 'right', render: r => <span className="muted">{inr(r.returnsAttributed)}</span> },
  { key: 'realized', label: 'Net Realized', align: 'right', render: r => <strong>{inr(r.realized)}</strong> },
]);

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function Ads() {
  const { scope, prevScope, companyId, channelId, setChannelId, period, today } = useApp();
  const [tab, setTab] = useState('general');
  const [path, setPath] = useState([]);
  const [grain, setGrain] = useState('week');

  const drillScope = useMemo(
    () => path.reduce((a, s) => ({ ...a, [s.dim]: s.key }), scope),
    [scope, path]
  );

  const summary = useMemo(() => adSummary(scope, prevScope), [scope, prevScope]);
  const cur = summary.current;
  const prev = summary.previous;

  const chans = useMemo(() => adsByChannel(scope), [scope]);
  const camps = useMemo(() => campaigns(scope), [scope]);
  const timeline = useMemo(() => adSeries(scope, grain), [scope, grain]);
  const recon = useMemo(() => spendReconciliation(scope), [scope]);
  const fresh = useMemo(() => newProducts(scope, companyId, today), [scope, companyId, today]);

  const usedDims = new Set(path.map(s => s.dim));
  const level = LEVELS.find(l => !usedDims.has(l.dim)) ?? LEVELS[LEVELS.length - 1];
  const levelRows = useMemo(() => adsByDimension(drillScope, level.dim), [drillScope, level.dim]);
  const products = useMemo(() => adsByDimension(drillScope, 'product'), [drillScope]);

  const drillTo = (r) => setPath(prev2 => {
    const i = prev2.findIndex(s => s.dim === r.dim);
    return i === -1 ? [...prev2, { dim: r.dim, key: r.key }]
      : [...prev2.slice(0, i), { dim: r.dim, key: r.key }];
  });

  const platforms = companyId === 'all' ? [] : channelsFor(companyId);

  if (!cur) {
    return (
      <div className="vstack" style={{ gap: 18 }}>
        <h1 style={{ fontSize: 20 }}>Ads</h1>
        <Card><Empty icon={Megaphone} title="No advertising activity">
          Nothing was sold in this period, so there is no attributed revenue to report.
        </Empty></Card>
      </div>
    );
  }

  const d = (a, b) => changePct(a, b);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Ads</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            What advertising spent, what it earned, and what survived returns.
          </p>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            {periodLabel(period)} · {periodRange(period)}
            {channelId !== 'all' && ` · ${CHANNEL_BY_ID[channelId]?.name}`}
          </p>
        </div>
        <div className="hstack" style={{ gap: 8, flexWrap: 'wrap' }}>
          {platforms.length > 1 && (
            <Segmented
              options={[{ id: 'all', label: 'All' },
                ...platforms.map(c => ({ id: c, label: CHANNEL_BY_ID[c]?.name ?? c }))]}
              value={channelId} onChange={setChannelId} size="sm"
            />
          )}
          {path.length > 0 && (
            <button className="btn btn-sm" onClick={() => setPath([])}>
              <Home size={13} /> All categories
            </button>
          )}
        </div>
      </div>

      {/* Headline: the four numbers that decide whether advertising is working. */}
      <div className="ad-kpis">
        <Kpi label="Ad Revenue" value={inr(cur.attributed)} delta={d(cur.attributed, prev?.attributed)}
             sub={`${pct(cur.adShareOfSales)} of sales`} />
        <Kpi label="Ad Spend" value={inr(cur.spend)} delta={d(cur.spend, prev?.spend)} invert
             sub={`${pct(cur.tacos)} TACOS`} />
        <Kpi label="ROAS" value={`${cur.roas.toFixed(2)}x`} delta={d(cur.roas, prev?.roas)}
             tone={cur.roas >= 4 ? 'good' : cur.roas < 2.5 ? 'critical' : null}
             sub={`${pct(cur.acos)} ACOS`} />
        <Kpi label="Net Realized" value={inr(cur.realized)}
             sub={`after ${inr(cur.returnsAttributed)} returns`} />
      </div>

      {Math.abs(recon.variancePct) > 12 && (
        <div className="ad-flag">
          <AlertTriangle size={14} />
          <span>
            Modelled spend is {pct(Math.abs(recon.variancePct))} {recon.variance > 0 ? 'above' : 'below'} the
            marketing line in the P&amp;L ({inr(recon.ledger)}). Reconcile before acting on ROAS.
          </span>
        </div>
      )}

      <div className="segmented" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {SECTIONS.map(sct => (
          <button key={sct.id} className={tab === sct.id ? 'on' : ''} onClick={() => setTab(sct.id)}>
            {sct.label}
          </button>
        ))}
      </div>

      {tab === 'general' && <GeneralTab cur={cur} prev={prev} timeline={timeline} grain={grain} setGrain={setGrain} recon={recon} />}
      {tab === 'spend' && <SpendTab cur={cur} chans={chans} camps={camps} scope={scope} />}
      {tab === 'analytics' && <AnalyticsTab cur={cur} prev={prev} camps={camps} timeline={timeline} />}
      {tab === 'channels' && <ChannelsTab rows={chans} total={cur} />}
      {tab === 'products' && <ProductsTab rows={products} scope={drillScope} />}
      {tab === 'returns' && <ReturnsTab cur={cur} chans={chans} products={products} scope={scope} />}
      {tab === 'category' && (
        <CategoryTab
          level={level} rows={levelRows} path={path} onDrill={drillTo}
          onCrumb={(i) => setPath(path.slice(0, i))}
        />
      )}
      {tab === 'new' && <NewProductsTab rows={fresh} />}
    </div>
  );
}

/* ── A. General ────────────────────────────────────────────────────────── */

function GeneralTab({ cur, prev, timeline, grain, setGrain, recon }) {
  const d = (a, b) => changePct(a, b);
  const metrics = [
    ['Total Ad Revenue', inr(cur.attributed), d(cur.attributed, prev?.attributed), false],
    ['Total Ad Spend', inr(cur.spend), d(cur.spend, prev?.spend), true],
    ['ROAS', `${cur.roas.toFixed(2)}x`, d(cur.roas, prev?.roas), false],
    ['ACOS', pct(cur.acos), cur.acos - (prev?.acos ?? cur.acos), true],
    ['TACOS', pct(cur.tacos), cur.tacos - (prev?.tacos ?? cur.tacos), true],
    ['Ad Orders', num(Math.round(cur.orders)), d(cur.orders, prev?.orders), false],
    ['Conversion Rate', pct(cur.cvr), cur.cvr - (prev?.cvr ?? cur.cvr), false],
    ['CPC', inr(cur.cpc), d(cur.cpc, prev?.cpc), true],
    ['CTR', pct(cur.ctr), cur.ctr - (prev?.ctr ?? cur.ctr), false],
    ['Impressions', num(Math.round(cur.impressions)), d(cur.impressions, prev?.impressions), false],
    ['Clicks', num(Math.round(cur.clicks)), d(cur.clicks, prev?.clicks), false],
    ['Cost per Order', inr(cur.cpa), d(cur.cpa, prev?.cpa), true],
  ];

  return (
    <div className="vstack" style={{ gap: 14 }}>
      <Card title="General metrics" subtitle="Every headline number, against the previous period" flush>
        <div className="ad-metric-grid">
          {metrics.map(([label, value, delta, invert]) => (
            <div className="ad-metric" key={label}>
              <span className="tiny muted">{label}</span>
              <span className="ad-metric-value tnum">{value}</span>
              {delta != null && !Number.isNaN(delta) && <Delta value={delta} invert={invert} />}
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Spend against return"
        subtitle="Where money went in, and what came back out"
        actions={
          <Segmented
            options={[{ id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]}
            value={grain} onChange={setGrain} size="sm"
          />
        }
      >
        <MeasureBars
          data={timeline.map(t => ({ label: t.label, value: t.revenue, color: 'var(--series-1)' }))}
          height={200}
        />
        <div className="ad-series">
          {timeline.map(t => (
            <div className="ad-series-row" key={t.date}>
              <span className="tiny muted">{t.label}</span>
              <span className="tnum tiny">{inr(t.spend)}</span>
              <span className="tnum tiny" style={{ fontWeight: 600 }}>{inr(t.revenue)}</span>
              <Roas value={t.roas} />
            </div>
          ))}
        </div>
        <div className="ladder-foot">
          Spend reconciles to the marketing line in the P&amp;L: {inr(recon.modelled)} of{' '}
          {inr(recon.ledger)} total marketing is performance media.
        </div>
      </Card>
    </div>
  );
}

/* ── B. Ad Spend ───────────────────────────────────────────────────────── */

function SpendTab({ cur, chans, camps, scope }) {
  const byCategory = useMemo(() => adsByDimension(scope, 'category'), [scope]);

  const share = (v) => (cur.spend > 0 ? (v / cur.spend) * 100 : 0);
  const revShare = (v) => (cur.attributed > 0 ? (v / cur.attributed) * 100 : 0);

  const spendCols = (nameLabel, renderName) => ([
    { key: 'name', label: nameLabel, render: renderName },
    { key: 'spend', label: 'Spend', align: 'right', render: r => inr(r.spend) },
    { key: 'spendShare', label: 'Share of Spend', align: 'right',
      sortValue: r => share(r.spend), render: r => pct(share(r.spend)) },
    { key: 'attributed', label: 'Revenue', align: 'right', render: r => inr(r.attributed) },
    { key: 'revShare', label: 'Share of Revenue', align: 'right',
      sortValue: r => revShare(r.attributed), render: r => pct(revShare(r.attributed)) },
    // The gap between the two shares is the whole point of this view.
    { key: 'gap', label: 'Efficiency', align: 'right',
      sortValue: r => revShare(r.attributed) - share(r.spend),
      render: r => {
        const g = revShare(r.attributed) - share(r.spend);
        return (
          <span className="tnum" style={{ fontWeight: 600, color: g >= 0 ? 'var(--good-ink)' : 'var(--critical-ink)' }}>
            {g >= 0 ? '+' : '−'}{Math.abs(g).toFixed(1)}pp
          </span>
        );
      } },
    { key: 'roas', label: 'ROAS', align: 'right', render: r => <Roas value={r.roas} /> },
  ]);

  return (
    <div className="vstack" style={{ gap: 14 }}>
      <Card title="Spend by marketplace" subtitle="Where money is deployed against where revenue lands" flush>
        <DataTable
          searchable={false} pageSize={8}
          columns={spendCols('Marketplace', r => (
            <span className="hstack" style={{ gap: 8 }}>
              <span className="swatch" style={{ background: channelColor(r.id) }} />
              <span style={{ fontWeight: 500 }}>{r.name}</span>
            </span>
          ))}
          rows={chans}
          initialSort={{ key: 'spend', dir: 'desc' }}
        />
      </Card>

      <Card title="Spend by category" subtitle="Which parts of the range absorb the budget" flush>
        <DataTable
          searchable={false} pageSize={10}
          columns={spendCols('Category', r => <span style={{ fontWeight: 500 }}>{r.name}</span>)}
          rows={byCategory}
          initialSort={{ key: 'spend', dir: 'desc' }}
        />
      </Card>

      <Card title="Spend by campaign" subtitle="The level an ad manager actually works at" flush>
        <DataTable
          pageSize={12} searchKeys={['name', 'channelName', 'typeLabel']}
          columns={[
            { key: 'name', label: 'Campaign', render: r => (
              <span>
                <span className="small" style={{ fontWeight: 500, display: 'block' }}>{r.name}</span>
                <span className="tiny muted">{r.channelName} · {r.typeLabel}</span>
              </span>
            )},
            { key: 'spend', label: 'Spend', align: 'right', render: r => inr(r.spend) },
            { key: 'attributed', label: 'Revenue', align: 'right', render: r => inr(r.attributed) },
            { key: 'roas', label: 'ROAS', align: 'right', render: r => <Roas value={r.roas} /> },
            { key: 'acos', label: 'ACOS', align: 'right', render: r => pct(r.acos) },
            { key: 'orders', label: 'Orders', align: 'right', render: r => num(Math.round(r.orders)) },
            { key: 'status', label: 'Status', render: r => (
              <Pill tone={r.status === 'scaling' ? 'good' : r.status === 'review' ? 'critical' : 'neutral'} icon={false}>
                {r.status === 'scaling' ? 'Scaling' : r.status === 'review' ? 'Review' : 'Steady'}
              </Pill>
            )},
          ]}
          rows={camps}
          initialSort={{ key: 'spend', dir: 'desc' }}
        />
      </Card>
    </div>
  );
}

/* ── C. Analytics ──────────────────────────────────────────────────────── */

function AnalyticsTab({ cur, prev, camps, timeline }) {
  const funnel = [
    { label: 'Impressions', value: cur.impressions, rate: null },
    { label: 'Clicks', value: cur.clicks, rate: cur.ctr, rateLabel: 'CTR' },
    { label: 'Add to cart', value: cur.addToCart, rate: cur.atcRate, rateLabel: 'of clicks' },
    { label: 'Orders', value: cur.orders, rate: cur.cvr, rateLabel: 'conversion' },
  ];
  const peak = funnel[0].value || 1;

  return (
    <div className="vstack" style={{ gap: 14 }}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)' }}>
        <Card title="The funnel" subtitle="Each stage against the one above it">
          <div className="vstack" style={{ gap: 11 }}>
            {funnel.map(f => (
              <div key={f.label}>
                <div className="spread" style={{ marginBottom: 4 }}>
                  <span className="small">{f.label}</span>
                  <span className="hstack" style={{ gap: 9 }}>
                    <span className="tnum small" style={{ fontWeight: 600 }}>{num(Math.round(f.value))}</span>
                    {f.rate != null && <span className="tiny muted">{pct(f.rate)} {f.rateLabel}</span>}
                  </span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{
                    width: `${Math.max(0.6, (f.value / peak) * 100)}%`, background: 'var(--series-1)',
                  }} />
                </div>
              </div>
            ))}
          </div>
          <div className="ladder-foot">
            Cost per click {inr(cur.cpc)} · cost per order {inr(cur.cpa)} · average ad order {inr(cur.aov)}.
          </div>
        </Card>

        <Card title="Efficiency over time" subtitle="Return on every rupee, period by period">
          <MeasureBars
            data={timeline.map(t => ({
              label: t.label, value: t.roas,
              color: t.roas >= 4 ? 'var(--good)' : t.roas >= 2.5 ? 'var(--series-1)' : 'var(--critical)',
            }))}
            height={214}
            valueFmt={(v) => `${v.toFixed(1)}x`}
          />
        </Card>
      </div>

      <Card title="Campaign analytics" subtitle="The full funnel per campaign — select a column to sort" flush>
        <DataTable
          pageSize={12} searchKeys={['name', 'channelName']}
          columns={[
            { key: 'name', label: 'Campaign', render: r => (
              <span>
                <span className="small" style={{ fontWeight: 500, display: 'block' }}>{r.name}</span>
                <span className="tiny muted">{r.channelName}</span>
              </span>
            )},
            { key: 'impressions', label: 'Impr.', align: 'right', render: r => num(Math.round(r.impressions)) },
            { key: 'clicks', label: 'Clicks', align: 'right', render: r => num(Math.round(r.clicks)) },
            { key: 'ctr', label: 'CTR', align: 'right', render: r => pct(r.ctr) },
            { key: 'cpc', label: 'CPC', align: 'right', render: r => inr(r.cpc) },
            { key: 'addToCart', label: 'Add to cart', align: 'right', render: r => num(Math.round(r.addToCart)) },
            { key: 'cvr', label: 'Conv %', align: 'right', render: r => pct(r.cvr) },
            { key: 'orders', label: 'Orders', align: 'right', render: r => num(Math.round(r.orders)) },
            { key: 'attributed', label: 'Revenue', align: 'right', render: r => inr(r.attributed) },
            { key: 'spend', label: 'Spend', align: 'right', render: r => inr(r.spend) },
            { key: 'roas', label: 'ROAS', align: 'right', render: r => <Roas value={r.roas} /> },
            { key: 'acos', label: 'ACOS', align: 'right', render: r => pct(r.acos) },
          ]}
          rows={camps}
          initialSort={{ key: 'spend', dir: 'desc' }}
          dense
        />
      </Card>
      {prev && (
        <p className="tiny muted" style={{ margin: 0 }}>
          Against the previous period: impressions {num(Math.round(prev.impressions))},
          clicks {num(Math.round(prev.clicks))}, orders {num(Math.round(prev.orders))},
          ROAS {prev.roas.toFixed(2)}x.
        </p>
      )}
    </div>
  );
}

/* ── D. Channel level ──────────────────────────────────────────────────── */

function ChannelsTab({ rows, total }) {
  return (
    <Card
      title="Marketplace comparison"
      subtitle="Which marketplace gives the best return on advertising — sort by any column"
      flush
    >
      <DataTable
        searchable={false} pageSize={10}
        columns={[
          { key: 'name', label: 'Marketplace', render: r => (
            <span className="hstack" style={{ gap: 8 }}>
              <span className="swatch" style={{ background: channelColor(r.id) }} />
              <span style={{ fontWeight: 500 }}>{r.name}</span>
            </span>
          )},
          { key: 'spend', label: 'Ad Spend', align: 'right', render: r => inr(r.spend) },
          { key: 'attributed', label: 'Ad Revenue', align: 'right', render: r => <strong>{inr(r.attributed)}</strong> },
          { key: 'roas', label: 'ROAS', align: 'right', render: r => <Roas value={r.roas} /> },
          { key: 'acos', label: 'ACOS', align: 'right', render: r => pct(r.acos) },
          { key: 'tacos', label: 'TACOS', align: 'right', render: r => pct(r.tacos) },
          { key: 'orders', label: 'Ad Orders', align: 'right', render: r => num(Math.round(r.orders)) },
          { key: 'cvr', label: 'Conv %', align: 'right', render: r => pct(r.cvr) },
          { key: 'contribution', label: 'Revenue Share', align: 'right',
            sortValue: r => (total.attributed ? r.attributed / total.attributed : 0),
            render: r => pct(total.attributed ? (r.attributed / total.attributed) * 100 : 0) },
        ]}
        rows={rows}
        initialSort={{ key: 'roas', dir: 'desc' }}
        emptyText="No advertising on any channel this period"
      />
      <div className="ladder-foot">
        TACOS is spend against that channel's whole revenue, not just the advertised part — it
        says how dependent the channel is on paid traffic.
      </div>
    </Card>
  );
}

/* ── E. Product performance ────────────────────────────────────────────── */

function ProductsTab({ rows, scope }) {
  // Four quadrants a CEO can act on directly.
  const median = (arr, pick) => {
    if (!arr.length) return 0;
    const v = arr.map(pick).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const medSpend = median(rows, r => r.spend);
  const medRoas = median(rows, r => r.roas);

  const classify = (r) => {
    if (r.spend >= medSpend && r.roas < medRoas) return { id: 'bleed', label: 'High spend, low return', tone: 'critical' };
    if (r.spend < medSpend && r.roas >= medRoas) return { id: 'opportunity', label: 'Low spend, high return', tone: 'good' };
    if (r.spend >= medSpend && r.roas >= medRoas) return { id: 'best', label: 'Performing', tone: 'good' };
    return { id: 'quiet', label: 'Under-invested', tone: 'neutral' };
  };

  const tagged = rows.map(r => ({ ...r, verdict: classify(r) }));
  const bleed = tagged.filter(r => r.verdict.id === 'bleed');
  const opp = tagged.filter(r => r.verdict.id === 'opportunity');

  return (
    <div className="vstack" style={{ gap: 14 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        <Card title="High spend, low return" subtitle="Budget going out faster than revenue comes back">
          {bleed.length === 0 ? <p className="tiny muted" style={{ margin: 0 }}>Nothing is over-spending.</p> : (
            <div className="vstack" style={{ gap: 9 }}>
              {bleed.slice(0, 5).map(r => (
                <div className="spread" key={r.id}>
                  <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span className="hstack" style={{ gap: 10 }}>
                    <span className="tiny muted tnum">{inr(r.spend)}</span>
                    <Roas value={r.roas} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Low spend, high return" subtitle="Where more budget would likely pay">
          {opp.length === 0 ? <p className="tiny muted" style={{ margin: 0 }}>No obvious opportunity.</p> : (
            <div className="vstack" style={{ gap: 9 }}>
              {opp.slice(0, 5).map(r => (
                <div className="spread" key={r.id}>
                  <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                  <span className="hstack" style={{ gap: 10 }}>
                    <span className="tiny muted tnum">{inr(r.spend)}</span>
                    <Roas value={r.roas} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Product advertising performance" subtitle="Every advertised product, with what survived returns" flush>
        <DataTable
          pageSize={14} searchKeys={['name', 'category', 'subcategory']}
          columns={[
            { key: 'name', label: 'Product', render: r => (
              <span>
                <span className="small" style={{ fontWeight: 500, display: 'block' }}>{r.name}</span>
                <span className="tiny muted">{r.category}{r.subcategory ? ` · ${r.subcategory}` : ''}</span>
              </span>
            )},
            ...perfColumns('Product', null).slice(1),
            { key: 'verdict', label: 'Read', sortable: false, render: r => (
              <Pill tone={r.verdict.tone} icon={false}>{r.verdict.label}</Pill>
            )},
            { key: 'watch', label: '', sortable: false, align: 'right', render: r => (
              <WatchButton
                subject={{
                  company: scope.company, channel: scope.channel,
                  category: r.category, subcategory: r.subcategory,
                  product: r.id, title: r.name, metric: 'netSales',
                }}
                iconOnly
              />
            )},
          ]}
          rows={tagged}
          initialSort={{ key: 'spend', dir: 'desc' }}
          emptyText="No advertised products in this selection"
        />
      </Card>
    </div>
  );
}

/* ── F. Returns ────────────────────────────────────────────────────────── */

function ReturnsTab({ cur, chans, products, scope }) {
  const cats = useMemo(() => adsByDimension(scope, 'category'), [scope]);
  const returnRate = cur.attributed > 0 ? (cur.returnsAttributed / cur.attributed) * 100 : 0;

  const table = (title, subtitle, rows, nameLabel) => (
    <Card title={title} subtitle={subtitle} flush>
      <DataTable
        searchable={false} pageSize={8}
        columns={[
          { key: 'name', label: nameLabel, render: r => <span style={{ fontWeight: 500 }}>{r.name}</span> },
          { key: 'attributed', label: 'Ad Revenue', align: 'right', render: r => inr(r.attributed) },
          { key: 'returnsAttributed', label: 'Returned', align: 'right', render: r => inr(r.returnsAttributed) },
          { key: 'returnRate', label: 'Return %', align: 'right',
            sortValue: r => (r.attributed ? r.returnsAttributed / r.attributed : 0),
            render: r => {
              const v = r.attributed ? (r.returnsAttributed / r.attributed) * 100 : 0;
              return <span style={{ color: v > returnRate * 1.2 ? 'var(--critical-ink)' : 'var(--ink)', fontWeight: 600 }}>{pct(v)}</span>;
            } },
          { key: 'realized', label: 'Net Realized', align: 'right', render: r => <strong>{inr(r.realized)}</strong> },
          { key: 'realRoas', label: 'ROAS after returns', align: 'right',
            sortValue: r => (r.spend ? r.realized / r.spend : 0),
            render: r => <Roas value={r.spend ? r.realized / r.spend : 0} /> },
        ]}
        rows={rows}
        initialSort={{ key: 'returnsAttributed', dir: 'desc' }}
      />
    </Card>
  );

  return (
    <div className="vstack" style={{ gap: 14 }}>
      <div className="ad-kpis">
        <Kpi label="Ad Revenue" value={inr(cur.attributed)} sub="before returns" />
        <Kpi label="Returned" value={inr(cur.returnsAttributed)} sub={`${pct(returnRate)} of ad revenue`} />
        <Kpi label="Net Realized" value={inr(cur.realized)} sub="what actually stayed" />
        <Kpi label="ROAS after returns" value={`${(cur.spend ? cur.realized / cur.spend : 0).toFixed(2)}x`}
             sub={`${cur.roas.toFixed(2)}x before`}
             tone={cur.realized / cur.spend >= 4 ? 'good' : cur.realized / cur.spend < 2.5 ? 'critical' : null} />
      </div>

      <div className="ad-flag info">
        <Sparkles size={14} />
        <span>
          Return rate is applied to the advertised slice at the same rate the products themselves
          return, so a product that advertises well but comes back often shows a lower realized
          return than its headline ROAS suggests.
        </span>
      </div>

      {table('Returns by marketplace', 'Where advertised revenue fails to stick', chans, 'Marketplace')}
      {table('Returns by category', 'Which parts of the range are worst', cats, 'Category')}
      {table('Returns by product', 'The listings costing the most after returns', products.slice(0, 20), 'Product')}
    </div>
  );
}

/* ── G. Category → Subcategory → Product ───────────────────────────────── */

function CategoryTab({ level, rows, path, onDrill, onCrumb }) {
  const best = rows.length ? Math.max(...rows.map(r => r.roas)) : 1;

  return (
    <div className="vstack" style={{ gap: 14 }}>
      {path.length > 0 && (
        <div className="crumbs">
          <button className="crumb" onClick={() => onCrumb(0)}>All categories</button>
          {path.map((s, i) => (
            <span key={i} className="hstack" style={{ gap: 4 }}>
              <ChevronRight size={11} className="muted" />
              <button
                className={`crumb${i === path.length - 1 ? ' last' : ''}`}
                onClick={i === path.length - 1 ? undefined : () => onCrumb(i + 1)}
              >
                {s.dim === 'product' ? (PRODUCT_BY_ID[s.key]?.name ?? s.key) : s.key}
              </button>
            </span>
          ))}
        </div>
      )}

      <Card
        title={`${level.label} advertising performance`}
        subtitle="Ranked by return — select a row to go a level deeper"
        flush
      >
        <DataTable
          pageSize={12} searchKeys={['name']}
          columns={[
            { key: 'name', label: level.label, render: r => (
              <span className="hstack" style={{ gap: 9, minWidth: 0 }}>
                <span className="cat-rank">
                  <span className="cat-rank-fill" style={{ width: `${Math.max(4, (r.roas / best) * 100)}%` }} />
                </span>
                <span style={{ fontWeight: 500 }}>{r.name}</span>
              </span>
            )},
            ...perfColumns(level.label, null).slice(1),
            ...(level.dim === 'product' ? [] : [{
              key: 'go', label: '', sortable: false, align: 'right',
              render: () => <ChevronRight size={14} className="muted" />,
            }]),
          ]}
          rows={rows}
          initialSort={{ key: 'attributed', dir: 'desc' }}
          onRowClick={level.dim === 'product' ? undefined : onDrill}
          emptyText="Nothing advertised at this level"
        />
      </Card>
    </div>
  );
}

/* ── H. New products ───────────────────────────────────────────────────── */

function NewProductsTab({ rows }) {
  const cohorts = [
    { id: '0-30', label: 'First 30 days', blurb: 'Launch spend buying the first reviews' },
    { id: '31-60', label: 'Days 31 to 60', blurb: 'Whether any of it stuck' },
  ];

  if (!rows.length) {
    return (
      <Card>
        <Empty icon={Sparkles} title="No products launched in the last 60 days">
          A product appears here for {NEW_PRODUCT_DAYS} days from its listing date, split at 30,
          so launch spend can be judged separately from what it left behind.
        </Empty>
      </Card>
    );
  }

  return (
    <div className="vstack" style={{ gap: 14 }}>
      {cohorts.map(c => {
        const mine = rows.filter(r => r.cohort === c.id);
        const spend = mine.reduce((s, r) => s + r.spend, 0);
        const rev = mine.reduce((s, r) => s + r.attributed, 0);
        const realized = mine.reduce((s, r) => s + r.realized, 0);
        const orders = mine.reduce((s, r) => s + r.orders, 0);
        return (
          <Card
            key={c.id}
            title={c.label}
            subtitle={c.blurb}
            actions={<span className="tiny muted">{mine.length} product{mine.length === 1 ? '' : 's'}</span>}
            flush
          >
            {mine.length === 0 ? (
              <p className="tiny muted" style={{ padding: '12px 16px', margin: 0 }}>
                Nothing in this cohort.
              </p>
            ) : (
              <>
                <div className="ad-kpis" style={{ margin: '0 0 2px' }}>
                  <Kpi label="Ad Spend" value={inr(spend)} />
                  <Kpi label="Ad Revenue" value={inr(rev)} />
                  <Kpi label="ROAS" value={`${(spend ? rev / spend : 0).toFixed(2)}x`}
                       tone={rev / spend >= 3 ? 'good' : rev / spend < 2 ? 'critical' : null} />
                  <Kpi label="Net Realized" value={inr(realized)} sub={`${num(Math.round(orders))} ad orders`} />
                </div>
                <DataTable
                  searchable={false} pageSize={8}
                  columns={[
                    { key: 'name', label: 'Product', render: r => (
                      <span>
                        <span className="small" style={{ fontWeight: 500, display: 'block' }}>{r.name}</span>
                        <span className="tiny muted">
                          Listed {fmtDate(r.launchedOn, 'long')} · day {r.ageDays}
                          {r.digital && ' · digital'}
                        </span>
                      </span>
                    )},
                    ...perfColumns('Product', null).slice(1),
                  ]}
                  rows={mine}
                  initialSort={{ key: 'spend', dir: 'desc' }}
                />
              </>
            )}
          </Card>
        );
      })}
      <p className="tiny muted" style={{ margin: 0 }}>
        A product counts as new for {NEW_PRODUCT_DAYS} days from listing. The split at 30 days
        matters: the first month is spend buying a listing its first traction, the second is
        whether that traction held once the launch push stopped.
      </p>
    </div>
  );
}
