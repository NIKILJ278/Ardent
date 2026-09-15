import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Sliders, TrendingUp, AlertTriangle, Plus, Plug, PenLine,
  TrendingDown, Minus, ShieldAlert,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useDrill } from '../state/Drilldown.jsx';
import {
  financials, groupBy, healthBand, indicatorTone,
  COMPANY_BY_ID, comparisonLabel,
  businessPhase, growthTone, runwayTone, marginTone,
} from '../data/engine.js';
import { companyHealth } from '../data/health.js';
import {
  realizedLadder, productIntelligence, gmvTrend, trendAnnotations,
  readings, lastUpdated, platformOptions,
} from '../data/overview.js';
import {
  reconciliation, dataSources, SOURCE_STATUS, departmentPerformance,
  timelineFor, EVENT_KINDS, EVENT_SOURCES, eventImpact, resolveGoal,
} from '../data/business.js';
import { CHANNEL_BY_ID, PRODUCT_BY_ID, channelsFor } from '../data/catalog.js';
import { inr, num, pct, fmtDate, relativeTime, changePct } from '../lib/format.js';
import { Card, Pill, Delta, Track, DataTable, Empty } from '../components/ui/index.jsx';
import { RevenueTrend, HealthGauge } from '../components/charts/index.jsx';
import { PeriodPicker } from '../components/shell/Shell.jsx';
import { HealthModal } from '../components/health/HealthBreakdown.jsx';
import {
  RevenueLadder, ProductIntelligence, Readings, FinancialFigure, EventPointers,
} from '../components/overview/Sections.jsx';
import { channelColor } from '../lib/channels.js';
import { buildEventMarkers } from '../lib/markers.js';

/**
 * Channels an event touched, each with the measured revenue movement, ordered
 * by how much they actually moved. Sorted by the data, never by a fixed list.
 */
function channelImpacts(event, limit = 4) {
  const rows = eventImpact(event);
  return {
    shown: rows.slice(0, limit).map(r => ({
      key: r.channel,
      name: CHANNEL_BY_ID[r.channel]?.name ?? r.channel,
      color: channelColor(r.channel),
      changePct: r.changePct,
      partial: r.partial,
      afterDays: r.afterDays,
    })),
    more: Math.max(0, rows.length - limit),
  };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/* ── Headline status banner ────────────────────────────────────────────────
   The 30-second read: what phase the business is in, and the three signals
   that decide it. Always company-wide — a phase is a statement about the
   company, not about one sales channel.
   ──────────────────────────────────────────────────────────────────────── */

const PHASE_ICON = {
  good: TrendingUp, info: Minus, warning: TrendingUp,
  serious: TrendingDown, critical: ShieldAlert,
};

function StatusBanner({ phase, metrics }) {
  const Icon = PHASE_ICON[phase.tone] ?? TrendingUp;
  return (
    <div className={`status-banner ${phase.tone}`}>
      <span className="status-mark"><Icon size={19} strokeWidth={2.2} /></span>
      <span className="status-copy">
        <span className="status-title">{phase.label}</span>
        <span className="status-blurb">{phase.blurb}</span>
      </span>
      <span className="status-metrics">
        {metrics.map(m => (
          <span className="status-metric" key={m.label}>
            <span className="status-metric-label">{m.label}</span>
            <span className="status-metric-value tnum">
              {m.value}
              <span className={`dot ${m.tone}`} />
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function Overview() {
  const { scope, prevScope, companyScope, prevCompanyScope, companyId, channelId,
          setChannelId, period, periodId, healthConfig, comparison, notes, events } = useApp();
  const { open } = useDrill();
  const [showHealth, setShowHealth] = useState(false);

  const company = COMPANY_BY_ID[companyId];
  const ceo = company?.ceo ?? 'Vismay Shah';

  const fin      = useMemo(() => financials(scope),     [scope]);

  // Company Health describes the whole company. It is deliberately NOT scoped
  // to the channel filter — a single channel cannot have its own cash position
  // or runway, so a "health score for Amazon" would be a fiction.
  const coFin     = useMemo(() => financials(companyScope),     [companyScope]);
  const coPrevFin = useMemo(() => financials(prevCompanyScope), [prevCompanyScope]);
  const health = useMemo(
    () => companyHealth({
      scope: companyScope, prevScope: prevCompanyScope,
      period, companyId, config: healthConfig,
    }),
    [companyScope, prevCompanyScope, period, companyId, healthConfig]
  );
  const band = healthBand(health.overall);
  const channelFiltered = channelId !== 'all';

  // Headline status — computed company-wide from the same figures as the KPIs.
  const coGrowth = changePct(coFin.net, coPrevFin.net);
  const phase = useMemo(
    () => businessPhase({
      growthPct: coGrowth,
      runwayMonths: coFin.runwayMonths,
      netMarginPct: coFin.netMarginPct,
    }),
    [coGrowth, coFin.runwayMonths, coFin.netMarginPct]
  );
  // Only call it month-on-month when that is genuinely what is being compared.
  const growthLabel =
    comparison === 'year' ? 'YoY Growth'
    : comparison !== 'previous' ? 'Growth'
    : periodId === 'month'   ? 'MoM Growth'
    : periodId === 'quarter' ? 'QoQ Growth'
    : periodId === 'year'    ? 'YoY Growth'
    : 'Growth';
  const statusMetrics = [
    { label: growthLabel, value: coGrowth == null ? '—' : `${coGrowth >= 0 ? '+' : '−'}${Math.abs(coGrowth).toFixed(1)}%`, tone: growthTone(coGrowth) },
    { label: 'Runway',     value: coFin.runwayMonths == null ? '—' : `${coFin.runwayMonths.toFixed(1)} mo`, tone: runwayTone(coFin.runwayMonths) },
    { label: 'Net Margin', value: pct(coFin.netMarginPct), tone: marginTone(coFin.netMarginPct) },
  ];
  const channelName = CHANNEL_BY_ID[channelId]?.name;

  // Always company-wide: the point of this strip is to compare channels, so it
  // must not collapse to a single row when the channel filter is on.
  const byChannel = useMemo(() => groupBy(companyScope, 'channel'), [companyScope]);
  const prevByChannel = useMemo(
    () => new Map(groupBy(prevCompanyScope, 'channel').map(r => [r.key, r])),
    [prevCompanyScope]
  );



  const recon = useMemo(() => reconciliation(scope), [scope]);
  const sources = useMemo(() => dataSources(companyId), [companyId]);
  const depts = useMemo(() => departmentPerformance(scope), [scope]);
  const timeline = useMemo(
    () => timelineFor([...events, ...notes], companyId, period),
    [events, notes, companyId, period]
  );

  const { goals } = useApp();
  const liveGoals = useMemo(
    () => goals.filter(g => companyId === 'all' || g.company === companyId)
               .map(g => resolveGoal(g, scope, period)),
    [goals, companyId, scope, period]
  );

  const products = useMemo(() => {
    const rows = groupBy(scope, 'product').slice(0, 6);
    const prev = new Map(groupBy(prevScope, 'product').map(r => [r.key, r]));
    return rows.map(r => {
      const p = PRODUCT_BY_ID[r.key];
      const pv = prev.get(r.key);
      return {
        id: r.key, name: p?.name ?? r.key, category: p?.category,
        net: r.net, units: r.units,
        growth: pv?.net ? ((r.net - pv.net) / pv.net) * 100 : null,
        marginPct: r.net ? (r.margin / r.net) * 100 : 0,
        isNew: !!p?.launchedOn, launchedOn: p?.launchedOn,
      };
    });
  }, [scope, prevScope]);

  /* The Overview's own reads. Each one calls the model the deeper module
     calls, so the command centre and the detail pages cannot disagree. */
  const ladder = useMemo(() => realizedLadder(scope), [scope]);
  const prevLadder = useMemo(() => realizedLadder(prevScope), [prevScope]);
  const gmvDelta = changePct(ladder.gmv, prevLadder.gmv);

  const intel = useMemo(() => productIntelligence(scope, prevScope), [scope, prevScope]);

  // GMV runs monthly on the Overview: a CEO reads the shape of the year here
  // and the daily detail on the Sales page.
  const gmv = useMemo(() => gmvTrend(scope, prevScope, period), [scope, prevScope, period]);
  const pointers = useMemo(
    () => trendAnnotations({ points: gmv, events, notes, companyId, channelId }),
    [gmv, events, notes, companyId, channelId]
  );
  const gmvMarkers = useMemo(
    () => buildEventMarkers({ events, notes, companyId, channelId, trend: gmv, grain: 'month' }),
    [events, notes, companyId, channelId, gmv]
  );

  const reads = useMemo(() => readings({ scope, prevScope, fmt: { inr, pct } }), [scope, prevScope]);
  const freshness = useMemo(() => lastUpdated(sources), [sources]);
  const platforms = useMemo(
    () => platformOptions(companyId === 'all' ? [] : channelsFor(companyId)),
    [companyId]
  );

  const drillMetric = (label, metric, format, invert) =>
    open({ type: 'metric', label, metric, format, invert, scope });


  return (
    <div className="vstack" style={{ gap: 18 }}>
      <StatusBanner phase={phase} metrics={statusMetrics} />

      {/* Greeting */}
      <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 21 }}>{greeting()}, {ceo.split(' ')[0]}</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            Here's how {companyId === 'all' ? 'the group' : company?.name} is performing.
          </p>
        </div>
        <div className="hstack" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="d-xl-none"><PeriodPicker /></span>
          <span className="tiny muted d-none d-xl-block">
            {fmtDate(period.start, 'long')} — {fmtDate(period.end, 'long')}
          </span>
          {/* Freshness, stated quietly. A number is only as good as its sync. */}
          {freshness && (
            <span className="freshness" title={`${freshness.source} · ${freshness.count} live connections`}>
              <span className="dot good" />
              Last updated {relativeTime(freshness.at)}
            </span>
          )}
        </div>
      </div>

      {/* 1 — Revenue. The hero: where the money starts and what survives. */}
      <RevenueLadder
        ladder={ladder}
        platform={channelId}
        platforms={platforms}
        onPlatform={setChannelId}
        delta={gmvDelta}
      />

      {/* 2 — Product intelligence: what is winning, lagging, and coming back. */}
      <ProductIntelligence intel={intel} />

      {/* Revenue performance */}
      <Card
        title="GMV performance"
        subtitle={gmv.rolling
          ? `Trailing ${gmv.months} months to ${fmtDate(period.end, 'long')} · your period is too short for a trend, so the chart widens`
          : `Month on month against ${comparison === 'year' ? 'the same period last year' : 'the previous period'} · dots mark business events`}
        actions={<span className="tiny muted">{num(pointers.length)} movements explained below</span>}
      >
        <RevenueTrend
          data={gmv}
          height={288}
          compareLabel={comparisonLabel(comparison)}
          markers={gmvMarkers}
        />

        {/* Every meaningful movement, with the event that explains it. */}
        <EventPointers pointers={pointers} />

        {reads.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <Readings items={reads} />
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(158px,1fr))', gap: 8 }}>
              {byChannel.map(c => {
                const pv = prevByChannel.get(c.key);
                const ch = changePct(c.net, pv?.net);
                return (
                  <button
                    key={c.key}
                    className="spread"
                    style={{
                      border: `1px solid ${channelId === c.key ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 11px',
                      background: channelId === c.key ? 'var(--accent-soft)' : 'var(--surface)',
                      cursor: 'pointer', width: '100%',
                    }}
                    title={`Open ${CHANNEL_BY_ID[c.key]?.name ?? c.key} in detail`}
                    onClick={() => open({
                      type: 'channel',
                      label: CHANNEL_BY_ID[c.key]?.name ?? c.key,
                      scope: { ...companyScope, channel: c.key },
                    })}
                  >
                    <span className="hstack" style={{ gap: 7, minWidth: 0 }}>
                      <span className="swatch" style={{ background: channelColor(c.key) }} />
                      <span className="small" style={{ fontWeight: 500 }}>{CHANNEL_BY_ID[c.key]?.name ?? c.key}</span>
                    </span>
                    <span className="hstack" style={{ gap: 8 }}>
                      <span className="tiny muted tnum">{inr(c.net)}</span>
                      <Delta value={ch} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* 4 — Financial position. Compact by design; Finance holds the detail. */}
      <div>
        <div className="spread" style={{ alignItems: 'baseline', marginBottom: 10 }}>
          <span className="section-title" style={{ marginBottom: 0 }}>
            Financial position{channelFiltered ? ` — ${channelName} only` : ''}
          </span>
          <Link to="/finance" className="linkish">Finance module <ArrowRight size={13} /></Link>
        </div>
        <div className="fin-grid">
          <FinancialFigure
            label="Cash" value={inr(fin.cash)}
            sub={channelFiltered ? 'at bank · company-wide' : 'at bank'}
            onClick={() => drillMetric('Cash Position', 'cash')}
          />
          <FinancialFigure
            label="Cash Flow" value={inr(fin.ebitda - fin.tax)}
            sub="operating, after tax"
            tone={fin.ebitda - fin.tax >= 0 ? 'good' : 'critical'}
            onClick={() => drillMetric('EBITDA', 'ebitda')}
          />
          <FinancialFigure
            label="Runway" value={fin.runwayMonths == null ? '—' : `${fin.runwayMonths.toFixed(1)} mo`}
            sub={`${inr(fin.burnRate)}/mo burn`}
            tone={fin.runwayMonths < 6 ? 'critical' : undefined}
            onClick={() => drillMetric('Runway', 'runwayMonths', 'months')}
          />
          <FinancialFigure
            label="Receivables" value={inr(fin.receivables)}
            sub={`${inr(fin.overdues)} overdue`}
            tone={fin.overdues / (fin.receivables || 1) > 0.15 ? 'warning' : undefined}
            onClick={() => drillMetric('Receivables', 'receivables')}
          />
          <FinancialFigure
            label="Payables" value={inr(fin.payables)} sub="due to vendors"
            onClick={() => drillMetric('Payables', 'payables')}
          />
          <FinancialFigure
            label="Contribution Margin" value={pct(ladder.model.cm1Pct)}
            sub={inr(ladder.model.cm1)}
            onClick={() => drillMetric('Contribution Margin', 'grossProfit')}
          />
          <FinancialFigure
            label="Net Margin" value={pct(fin.netMarginPct)}
            sub={inr(fin.netProfit)}
            tone={fin.netMarginPct < 0 ? 'critical' : undefined}
            onClick={() => drillMetric('Net Profit', 'netProfit')}
          />
          <FinancialFigure
            label="EBITDA" value={inr(fin.ebitda)} sub={pct(fin.ebitdaPct)}
            onClick={() => drillMetric('EBITDA', 'ebitda')}
          />
        </div>
      </div>

      {/* Company Health — compact. Weighting lives in the breakdown, not here. */}
      <Card
        className="health-card"
        title="Company Health"
        subtitle={channelFiltered
          ? 'Based on your 5 key business indicators · always company-wide'
          : 'Based on your 5 key business indicators'}
        actions={
          <button className="linkish" onClick={() => setShowHealth(true)}>
            <Sliders size={13} /> View health breakdown <ArrowRight size={13} />
          </button>
        }
      >
        <div className="health compact">
          <div className="health-score">
            <HealthGauge score={health.overall} tone={band.tone} size={88} />
            <Pill tone={band.tone}>{band.label}</Pill>
          </div>

          <div className="health-rows">
            {health.dimensions.map(d => {
              const s = health.scores[d.id];
              return (
                <div className="health-row" key={d.id} title={`${d.question} · ${d.basis}`}>
                  <span className="nm">{d.label}</span>
                  <Track value={s} tone={indicatorTone(s)} />
                  <span className="sc tnum">{s}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Goals + Departments */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))' }}>
        <Card
          title="Goals & targets"
          subtitle={`${liveGoals.filter(g => g.status.id === 'ontrack' || g.status.id === 'achieved').length} of ${liveGoals.length} on track`}
          actions={<Link to="/goals" className="linkish">All goals <ArrowRight size={13} /></Link>}
        >
          {liveGoals.length === 0 ? (
            <Empty icon={Plus} title="No goals yet">Create a goal to start tracking.</Empty>
          ) : (
            <div className="vstack" style={{ gap: 14 }}>
              {liveGoals.slice(0, 4).map(g => (
                <div key={g.id}>
                  <div className="spread" style={{ marginBottom: 5 }}>
                    <span className="small" style={{ fontWeight: 500 }}>{g.name}</span>
                    <Pill tone={g.status.tone}>{g.status.label}</Pill>
                  </div>
                  <Track value={g.progress} tone={g.status.tone} markerAt={100} />
                  <div className="spread tiny muted" style={{ marginTop: 4 }}>
                    <span className="tnum">
                      {g.isPct ? pct(g.current) : inr(g.current)} / {g.isPct ? pct(g.target) : inr(g.target)}
                    </span>
                    <span className="tnum">Forecast {g.isPct ? pct(g.forecast) : inr(g.forecast)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Department performance" subtitle="Attainment against departmental targets">
          <div className="vstack" style={{ gap: 13 }}>
            {depts.map(d => (
              <div key={d.name} title={d.basis}>
                <div className="spread" style={{ marginBottom: 5 }}>
                  <span className="small">{d.name}</span>
                  <span className="hstack" style={{ gap: 8 }}>
                    <span className="tnum small" style={{ fontWeight: 600 }}>{d.attainment}%</span>
                    <Pill tone={d.tone} icon={false}>
                      {d.tone === 'good' ? 'On track' : d.tone === 'warning' ? 'At risk' : 'Behind'}
                    </Pill>
                  </span>
                </div>
                <Track value={d.attainment} tone={d.tone} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Products + Timeline */}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)' }}>
        <Card title="Product performance" subtitle="Top contributors this period" flush
          actions={<Link to="/sales" className="linkish">All products <ArrowRight size={13} /></Link>}>
          <DataTable
            searchable={false}
            pageSize={6}
            columns={[
              {
                key: 'name', label: 'Product',
                render: r => (
                  <span>
                    <span className="hstack" style={{ gap: 6 }}>
                      <span style={{ fontWeight: 500 }}>{r.name}</span>
                      {r.isNew && <Pill tone="info" icon={false}>New</Pill>}
                    </span>
                    <span className="tiny muted">{r.category}</span>
                  </span>
                ),
              },
              { key: 'net',    label: 'Revenue', align: 'right', render: r => <strong>{inr(r.net)}</strong> },
              { key: 'growth', label: 'Growth',  align: 'right', render: r => <Delta value={r.growth} /> },
              { key: 'marginPct', label: 'Margin', align: 'right', render: r => pct(r.marginPct) },
            ]}
            rows={products}
            onRowClick={(r) => open({
              type: 'product', label: r.name,
              scope: { ...scope, product: r.id },
            })}
          />
        </Card>

        <Card
          title="Business timeline"
          subtitle="Channel impact is revenue 7 days from the event vs the 7 before"
          actions={<Link to="/goals#timeline" className="linkish">Manage <ArrowRight size={13} /></Link>}
        >
          {timeline.length === 0 ? (
            <Empty title="No events logged">Mark launches, price changes and campaigns to give the numbers context.</Empty>
          ) : (
            <div className="tl">
              {timeline.slice(-6).reverse().map(e => {
                const kind = EVENT_KINDS[e.kind] ?? EVENT_KINDS.business;
                const src = EVENT_SOURCES[e.source] ?? EVENT_SOURCES.manual;
                const { shown: impacts, more } = channelImpacts(e, 3);
                return (
                  <div className="tl-item" key={e.id}>
                    <span className={`tl-dot`} style={{
                      background: `var(--${kind.tone === 'good' ? 'good' : kind.tone === 'warning' ? 'warning' : kind.tone === 'serious' ? 'serious' : kind.tone === 'neutral' ? 'ink-3' : 'accent'})`,
                    }} />

                    {/* What kind of event it is, and when */}
                    <div className="tl-meta">
                      <Pill tone={kind.tone === 'neutral' ? 'neutral' : kind.tone} icon={false}>{kind.label}</Pill>
                      <span className="tl-date">{fmtDate(e.date + 'T12:00:00', 'long')}</span>
                    </div>

                    <div className="tl-title">{e.title}</div>

                    {/* Which channels moved, and by how much */}
                    {impacts.length > 0 && (
                      <div className="tl-chans" title="Average daily revenue in the 7 days from this date, against the 7 days before">
                        {impacts.map(c => (
                          <span className="chan-chip" key={c.key}>
                            <span className="swatch" style={{ background: c.color }} />
                            {c.name}
                            {c.changePct == null
                              ? <span className="chip-delta flat">n/a</span>
                              : <span className={`chip-delta ${c.changePct >= 0 ? 'up' : 'down'}`}>
                                  {c.changePct >= 0 ? '+' : '−'}{Math.abs(c.changePct).toFixed(1)}%
                                </span>}
                          </span>
                        ))}
                        {more > 0 && <span className="chan-chip muted">+{more} more</span>}
                      </div>
                    )}

                    {e.detail && <div className="tl-detail">{e.detail}</div>}

                    {/* Where Ardent picked it up */}
                    <div className="tl-src" title={`${src.capture} source`}>
                      {src.capture === 'Manual'
                        ? <><PenLine size={10} /> Logged by {e.author ?? 'CEO'} in Ardent</>
                        : <><Plug size={10} /> Captured from {src.label}</>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Reconciliation + Data sources */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))' }}>
        <Card
          title="Reconciliation"
          subtitle="Marketplace money owed against money received"
          actions={<Link to="/reconciliation" className="linkish">View <ArrowRight size={13} /></Link>}
        >
          <div className="vstack" style={{ gap: 9 }}>
            {[
              { l: 'Marketplace sales',   v: recon.sales },
              { l: 'Expected settlement', v: recon.expected },
              { l: 'Received in bank',    v: recon.received },
            ].map(r => (
              <div className="spread" key={r.l}>
                <span className="small muted">{r.l}</span>
                <span className="small tnum" style={{ fontWeight: 600 }}>{inr(r.v)}</span>
              </div>
            ))}
            <div className="spread" style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <span className="small" style={{ fontWeight: 600 }}>Outstanding</span>
              <span className="tnum" style={{ fontWeight: 700, color: 'var(--critical-ink)' }}>{inr(recon.outstanding)}</span>
            </div>
            {recon.outstanding > 0 && (
              <div className="hstack" style={{ gap: 8, padding: '9px 11px', background: 'var(--warning-soft)', borderRadius: 'var(--radius-sm)', marginTop: 2 }}>
                <AlertTriangle size={14} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />
                <span className="small" style={{ color: 'var(--warning-ink)' }}>
                  {inr(recon.outstanding)} requires attention — {inr(recon.disputed)} disputed, {inr(recon.inTransit)} in transit.
                </span>
              </div>
            )}
          </div>
        </Card>

        <Card
          title="Data sources"
          subtitle="Where these numbers come from"
          actions={<Link to="/sources" className="linkish">Manage <ArrowRight size={13} /></Link>}
        >
          <div className="vstack" style={{ gap: 2 }}>
            {sources.slice(0, 7).map(s => {
              const st = SOURCE_STATUS[s.status];
              return (
                <div className="spread" key={s.id} style={{ padding: '6px 0' }}>
                  <span className="hstack" style={{ gap: 8, minWidth: 0 }}>
                    <span className={`dot ${st.tone}`} />
                    <span className="small" style={{ fontWeight: 500 }}>{s.name}</span>
                    <span className="tiny muted">{s.kind}</span>
                  </span>
                  <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{relativeTime(s.lastSync)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {showHealth && <HealthModal health={health} onClose={() => setShowHealth(false)} />}
    </div>
  );
}
