import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Sliders, TrendingUp, Plug, PenLine, Loader2,
  TrendingDown, Minus, ShieldAlert, RefreshCw, LayoutGrid,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useSession } from '../state/Session.jsx';
import { useDrill } from '../state/Drilldown.jsx';
import {
  financials, salesModel, groupBy, healthBand, indicatorTone,
  COMPANY_BY_ID, comparisonLabel, businessPhase, growthTone,
} from '../data/engine.js';
import { companyHealth } from '../data/health.js';
import {
  realizedLadder, productIntelligence, gmvTrend, trendAnnotations,
  readings, lastUpdated, platformOptions,
  OVERVIEW_KPI_BY_ID, overviewKpiValue,
} from '../data/overview.js';
import {
  dataSources, SOURCE_STATUS, timelineFor, EVENT_KINDS, EVENT_SOURCES,
  eventImpact, resolveGoal,
} from '../data/business.js';
import { CHANNEL_BY_ID, channelsFor } from '../data/catalog.js';
import { live, availability } from '../data/live.js';
import { money, num, pct, fmtDate, relativeTime, changePct } from '../lib/format.js';
import { Card, Pill, Delta, Track, Empty } from '../components/ui/index.jsx';
import { NotConnected } from '../components/ui/NotConnected.jsx';
import { RevenueTrend, HealthGauge } from '../components/charts/index.jsx';
import { subjectFromScope } from '../data/watchlist.js';
import { PeriodPicker } from '../components/shell/Shell.jsx';
import { HealthModal } from '../components/health/HealthBreakdown.jsx';
import {
  RevenueLadder, ProductIntelligence, Readings, FinancialFigure, EventPointers, MarketMix,
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

/* ── Before there is data ──────────────────────────────────────────────────
   Every figure is built from orders that have actually synced. Until a store is
   connected there is nothing to show, and showing nothing is the point — a
   sample figure here would be indistinguishable from a real one.
   ──────────────────────────────────────────────────────────────────────── */

function Loading() {
  return (
    <Card>
      <div className="hstack" style={{ gap: 11, padding: '22px 4px', color: 'var(--ink-2)' }}>
        <Loader2 size={18} className="spin" />
        <span className="small">Loading your data…</span>
      </div>
    </Card>
  );
}

function LoadError({ message, onRetry }) {
  return (
    <Card title="Could not load your data">
      <div className="vstack" style={{ gap: 12, alignItems: 'flex-start' }}>
        <p className="small" style={{ margin: 0, color: 'var(--ink-2)' }}>{message}</p>
        <button className="btn btn-primary" onClick={onRetry}>
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    </Card>
  );
}

function Onboarding({ brandName }) {
  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 21 }}>Welcome to Ardent</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          {brandName ? `${brandName} has no data yet.` : 'This brand has no data yet.'}
        </p>
      </div>

      <Card>
        <div className="onboard">
          <span className="onboard-icon"><Plug size={22} strokeWidth={1.6} /></span>
          <div className="onboard-body">
            <span className="onboard-title">Connect your Shopify store</span>
            <p>
              Every figure in Ardent is computed from your own orders. Nothing is sampled,
              estimated or pre-filled, so the dashboard stays empty until a store is connected
              and its orders have synced.
            </p>
            <Link to="/sources" className="btn btn-primary">
              Connect a store <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </Card>

      <Card title="What arrives first" subtitle="And what still needs a source of its own">
        <div className="vstack" style={{ gap: 12 }}>
          <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.6 }}>
            Orders bring sales, discounts, cancellations, returns, products and variants — enough
            for revenue, product performance and return rates. Where your Shopify products carry
            unit costs, cost of goods and gross margin come with them.
          </div>
          <NotConnected
            title="Fees, courier costs, cash, inventory and ad spend"
            needs="payment gateway, courier, bank, stock and ad platform connections"
            showLink={false}
          >
            These stay marked "not connected" rather than being modelled, so no figure on this page
            ever rests on a rate nobody measured.
          </NotConnected>
        </div>
      </Card>
    </div>
  );
}

/* ── Headline status banner ────────────────────────────────────────────────
   The 30-second read. With only order data connected it rests on growth and
   says so — profit and cash need sources that are not wired up.
   ──────────────────────────────────────────────────────────────────────── */

const PHASE_ICON = {
  good: TrendingUp, info: Minus, warning: TrendingUp,
  serious: TrendingDown, critical: ShieldAlert, neutral: Minus,
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
          <span className="status-metric" key={m.id ?? m.label}>
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
  const { dataVersion } = useApp();
  const { loadFacts, brandId } = useSession();

  // Read so this gate re-evaluates whenever the live store moves.
  void dataVersion;

  if (live.status === 'loading' || live.status === 'idle') return <Loading />;
  if (live.status === 'error') {
    return (
      <LoadError
        message={live.error ?? 'The server did not return your data.'}
        onRetry={() => loadFacts(brandId)}
      />
    );
  }
  if (!live.rows.length) return <Onboarding brandName={COMPANY_BY_ID[brandId]?.name} />;
  return <Dashboard />;
}

function Dashboard() {
  const {
    scope, prevScope, companyScope, prevCompanyScope, companyId, channelId,
    setChannelId, period, periodId, healthConfig, comparison, notes, events,
    goals, dataVersion, overviewLayout, overviewKpis,
  } = useApp();
  const { user } = useSession();
  const { open } = useDrill();
  const [showHealth, setShowHealth] = useState(false);

  const company = COMPANY_BY_ID[companyId];
  const firstName = (user?.full_name || '').trim().split(' ')[0];
  const avail = useMemo(() => availability(), [dataVersion]);

  const fin = useMemo(() => financials(scope), [scope]);

  // Company Health describes the whole company, so it is deliberately NOT
  // scoped to the channel filter — one channel has no cash position of its own.
  const coFin     = useMemo(() => financials(companyScope),     [companyScope]);
  const coPrevFin = useMemo(() => financials(prevCompanyScope), [prevCompanyScope]);
  const health = useMemo(
    () => companyHealth({
      scope: companyScope, prevScope: prevCompanyScope, period, config: healthConfig,
    }),
    [companyScope, prevCompanyScope, period, healthConfig]
  );
  const band = healthBand(health.overall);
  const channelFiltered = channelId !== 'all';

  const coGrowth = changePct(coFin.netSales, coPrevFin.netSales);
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

  // Company-wide, same as the rest of the banner — one channel has no growth
  // rate or margin of its own that means anything on its own.
  const coModel = useMemo(() => salesModel(companyScope), [companyScope]);

  // Which figures sit in this strip, and in what order, is chosen in Settings
  // — a CEO and a CFO read this banner differently. Only measured figures earn
  // a place: margin joins it when every sold unit carried a cost, never a
  // partial figure passed off as the whole one.
  const statusMetrics = overviewKpis.map(id => {
    if (id === 'growth') {
      return {
        id, label: growthLabel,
        value: coGrowth == null ? '—' : `${coGrowth >= 0 ? '+' : '−'}${Math.abs(coGrowth).toFixed(1)}%`,
        tone: growthTone(coGrowth),
      };
    }
    const k = OVERVIEW_KPI_BY_ID[id];
    if (!k) return null;
    const raw = overviewKpiValue(id, coModel);
    const value = raw == null ? 'not connected'
      : k.fmt === 'money' ? money(raw)
      : k.fmt === 'num' ? num(raw)
      : pct(raw);
    return { id, label: k.label, value, tone: 'neutral' };
  }).filter(Boolean);
  const channelName = CHANNEL_BY_ID[channelId]?.name;

  // Always company-wide: the point of this strip is to compare channels, so it
  // must not collapse to a single row when the channel filter is on.
  const byChannel = useMemo(() => groupBy(companyScope, 'channel'), [companyScope]);
  const prevByChannel = useMemo(
    () => new Map(groupBy(prevCompanyScope, 'channel').map(r => [r.key, r])),
    [prevCompanyScope]
  );

  const sources = useMemo(() => dataSources(), [dataVersion]);
  const timeline = useMemo(
    () => timelineFor([...events, ...notes], companyId, period),
    [events, notes, companyId, period]
  );

  const liveGoals = useMemo(
    () => goals.filter(g => g.company === companyId).map(g => resolveGoal(g, scope, period)),
    [goals, companyId, scope, period]
  );

  /* The Overview's own reads. Each one calls the model the deeper module calls,
     so the command centre and the detail pages cannot disagree. */
  const ladder = useMemo(() => realizedLadder(scope), [scope]);
  const prevLadder = useMemo(() => realizedLadder(prevScope), [prevScope]);
  const gmvDelta = changePct(ladder.gmv, prevLadder.gmv);

  const intel = useMemo(() => productIntelligence(scope, prevScope), [scope, prevScope]);

  // GMV runs monthly here: a CEO reads the shape of the year on the Overview
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

  const reads = useMemo(() => readings({ scope, prevScope, fmt: { money, pct } }), [scope, prevScope]);

  // Only worth a card when the store actually takes more than one currency;
  // for a single-market shop it would be a row that always says the same thing.
  const markets = live.meta.presentmentCurrencies ?? [];
  const freshness = useMemo(() => lastUpdated(sources), [sources]);
  const platforms = useMemo(() => platformOptions(channelsFor(companyId)), [companyId, dataVersion]);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <StatusBanner phase={phase} metrics={statusMetrics} />

      {/* Greeting */}
      <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 21 }}>{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            Here's how {company?.name ?? 'your brand'} is performing.
          </p>
        </div>
        <div className="hstack" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="d-xl-none"><PeriodPicker /></span>
          <span className="tiny muted d-none d-xl-block">
            {fmtDate(period.start, 'long')} — {fmtDate(period.end, 'long')}
          </span>
          {/* Freshness, stated quietly. A number is only as good as its sync. */}
          {freshness && (
            <span className="freshness" title={`${freshness.source} · ${freshness.count} live connection(s)`}>
              <span className="dot good" />
              Last synced {relativeTime(freshness.at)}
            </span>
          )}
          <Link to="/settings#overview-layout" className="linkish tiny" title="Choose and reorder what this page shows">
            <LayoutGrid size={12} /> Customize
          </Link>
        </div>
      </div>

      {/* Every section below is optional and reorderable — see Settings →
          "Customize your Overview". `overviewLayout` names which appear and in
          what order; what each one computes never changes, only its place on
          the page. */}
      {overviewLayout.map(id => {
        switch (id) {
          case 'ladder':
            // The hero: where the money starts and what survives.
            return (
              <RevenueLadder
                key={id}
                ladder={ladder}
                platform={channelId}
                platforms={platforms}
                onPlatform={setChannelId}
                delta={gmvDelta}
              />
            );

          case 'products':
            // What is winning, lagging, and coming back.
            return <ProductIntelligence key={id} intel={intel} />;

          case 'markets':
            // Where in the world the demand came from, when there is a spread.
            return markets.length > 1
              ? <MarketMix key={id} markets={markets} reporting={live.meta.currency} /> : null;

          case 'trend':
            // Revenue over time, with the events that explain the movements.
            return (
              <Card
                key={id}
                title="GMV performance"
                subtitle={gmv.rolling
                  ? `Trailing ${gmv.months} months to ${fmtDate(period.end, 'long')} · your period is too short for a trend, so the chart widens`
                  : `Month on month against ${comparison === 'year' ? 'the same period last year' : 'the previous period'} · dots mark business events`}
                actions={<span className="tiny muted">{num(pointers.length)} movement(s) explained below</span>}
              >
                <RevenueTrend
                  data={gmv}
                  height={288}
                  compareLabel={comparisonLabel(comparison)}
                  watchSubject={subjectFromScope(scope)}
                  markers={gmvMarkers}
                />

                <EventPointers pointers={pointers} />

                {reads.length > 0 && (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                    <Readings items={reads} />
                    {byChannel.length > 1 && (
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
                                <span className="tiny muted tnum">{money(c.net)}</span>
                                <Delta value={ch} />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );

          case 'financials':
            // Only what orders can answer is a figure.
            return (
              <div key={id}>
                <div className="spread" style={{ alignItems: 'baseline', marginBottom: 10 }}>
                  <span className="section-title" style={{ marginBottom: 0 }}>
                    Financial position{channelFiltered ? ` — ${channelName} only` : ''}
                  </span>
                  <Link to="/finance" className="linkish">Finance module <ArrowRight size={13} /></Link>
                </div>
                <div className="fin-grid">
                  <FinancialFigure label="Gross Sales" value={money(fin.grossSales)} sub="before deductions" />
                  <FinancialFigure
                    label="Net Sales" value={money(fin.netSales)}
                    sub="after returns, cancellations and discounts"
                    onClick={() => open({ type: 'metric', label: 'Net Sales', metric: 'netSales', scope })}
                  />
                  <FinancialFigure
                    label="Cost of Goods"
                    value={fin.costComplete ? money(fin.cogs) : 'Not connected'}
                    sub={fin.costComplete ? 'from your product unit costs' : 'needs a unit cost on every product'}
                  />
                  <FinancialFigure
                    label="Gross Margin"
                    value={fin.costComplete ? money(fin.grossProfit) : 'Not connected'}
                    sub={fin.costComplete ? pct(fin.grossMarginPct) : 'needs cost of goods'}
                    tone={fin.costComplete && fin.grossProfit < 0 ? 'critical' : undefined}
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  <NotConnected
                    title="Cash, runway, receivables, payables and net margin"
                    needs="bank statements and accounting"
                  >
                    Order data cannot answer these. They stay blank rather than being modelled from an
                    assumed cost base.
                  </NotConnected>
                </div>
              </div>
            );

          case 'health':
            // Unscored dimensions say so and are left out.
            return (
              <Card
                key={id}
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
                    {health.overall == null ? (
                      <div className="health-empty">
                        <span className="small" style={{ fontWeight: 600 }}>No score yet</span>
                        <span className="tiny muted">None of your five indicators can be measured</span>
                      </div>
                    ) : (
                      <>
                        <HealthGauge score={health.overall} tone={band.tone} size={88} />
                        <Pill tone={band.tone}>{band.label}</Pill>
                      </>
                    )}
                  </div>

                  <div className="health-rows">
                    {health.dimensions.map(d => {
                      const s = health.scores[d.id];
                      return (
                        <div className="health-row" key={d.id} title={`${d.question} · ${d.basis}`}>
                          <span className="nm">{d.label}</span>
                          {s == null
                            ? <span className="health-na">Not connected — needs {d.needs}</span>
                            : <Track value={s} tone={indicatorTone(s)} />}
                          <span className="sc tnum">{s == null ? '—' : s}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {health.scoredCount > 0 && health.unavailable.length > 0 && (
                  <div className="ladder-foot">
                    Scored on {health.scoredCount} of {health.dimensions.length} indicators. The rest need
                    sources that are not connected, and are left out of the overall score rather than
                    counted as zero.
                  </div>
                )}
              </Card>
            );

          case 'goals':
            return (
              <Card
                key={id}
                title="Goals & targets"
                subtitle={liveGoals.length
                  ? `${liveGoals.filter(g => g.status.id === 'ontrack' || g.status.id === 'achieved').length} of ${liveGoals.length} on track`
                  : 'Nothing set yet'}
                actions={<Link to="/goals" className="linkish">All goals <ArrowRight size={13} /></Link>}
              >
                {liveGoals.length === 0 ? (
                  <Empty title="No goals yet">Set a target on the Goals page to track progress against it.</Empty>
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
                            {g.current == null ? 'not measurable' : g.isPct ? pct(g.current) : money(g.current)}
                            {g.target != null && ` / ${g.isPct ? pct(g.target) : money(g.target)}`}
                          </span>
                          {g.forecast != null && (
                            <span className="tnum">Forecast {g.isPct ? pct(g.forecast) : money(g.forecast)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );

          case 'timeline':
            return (
              <Card
                key={id}
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
                          <span className="tl-dot" style={{
                            background: `var(--${kind.tone === 'good' ? 'good' : kind.tone === 'warning' ? 'warning' : kind.tone === 'serious' ? 'serious' : kind.tone === 'neutral' ? 'ink-3' : 'accent'})`,
                          }} />

                          <div className="tl-meta">
                            <Pill tone={kind.tone === 'neutral' ? 'neutral' : kind.tone} icon={false}>{kind.label}</Pill>
                            <span className="tl-date">{fmtDate(e.date + 'T12:00:00', 'long')}</span>
                          </div>

                          <div className="tl-title">{e.title}</div>

                          {impacts.length > 0 && (
                            <div className="tl-chans" title="Average daily revenue in the 7 days from this date, against the 7 days before">
                              {impacts.map(c => (
                                <span className="chan-chip" key={c.key}>
                                  <span className="swatch" style={{ background: c.color }} />
                                  {c.name}
                                  {c.changePct == null
                                    ? <span className="chip-delta flat">n/a</span>
                                    : (
                                      <span className={`chip-delta ${c.changePct >= 0 ? 'up' : 'down'}`}>
                                        {c.changePct >= 0 ? '+' : '−'}{Math.abs(c.changePct).toFixed(1)}%
                                      </span>
                                    )}
                                </span>
                              ))}
                              {more > 0 && <span className="chan-chip muted">+{more} more</span>}
                            </div>
                          )}

                          {e.detail && <div className="tl-detail">{e.detail}</div>}

                          <div className="tl-src" title={`${src.capture} source`}>
                            {src.capture === 'Manual'
                              ? <><PenLine size={10} /> Logged by {e.author ?? 'you'} in Ardent</>
                              : <><Plug size={10} /> Captured from {src.label}</>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );

          case 'sources':
            return (
              <Card
                key={id}
                title="Data sources"
                subtitle="Where these numbers come from"
                actions={<Link to="/sources" className="linkish">Manage <ArrowRight size={13} /></Link>}
              >
                <div className="vstack" style={{ gap: 2 }}>
                  {sources.map(s => {
                    const st = SOURCE_STATUS[s.status];
                    return (
                      <div className="spread" key={s.id} style={{ padding: '6px 0' }}>
                        <span className="hstack" style={{ gap: 8, minWidth: 0 }}>
                          <span className={`dot ${st.tone}`} />
                          <span className="small" style={{ fontWeight: 500 }}>{s.name}</span>
                          <span className="tiny muted">{s.kind}</span>
                        </span>
                        <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                          {s.lastSync ? relativeTime(s.lastSync) : 'never synced'}
                        </span>
                      </div>
                    );
                  })}
                  {!avail.cogs && (
                    <div className="tiny muted" style={{ paddingTop: 8, lineHeight: 1.55 }}>
                      {avail.cogsPartial
                        ? 'Some sold units have no unit cost, so cost of goods and margin are withheld until every one is costed.'
                        : 'No unit costs found on your products, so cost of goods and margin cannot be computed.'}
                    </div>
                  )}
                </div>
              </Card>
            );

          default:
            return null;
        }
      })}

      {showHealth && <HealthModal health={health} onClose={() => setShowHealth(false)} />}
    </div>
  );
}
