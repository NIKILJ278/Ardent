import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Sliders, TrendingUp, Plug, Loader2,
  TrendingDown, Minus, ShieldAlert, RefreshCw, LayoutGrid,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useSession } from '../state/Session.jsx';
import { useDrill } from '../state/Drilldown.jsx';
import {
  financials, salesModel, groupBy, healthBand, indicatorTone,
  COMPANY_BY_ID, comparisonLabel, comparisonExplainer, businessPhase, growthTone,
} from '../data/engine.js';
import { companyHealth } from '../data/health.js';
import {
  realizedLadder, productIntelligence, gmvTrend, trendAnnotations,
  readings, lastUpdated, freshnessTone, platformOptions,
  OVERVIEW_KPI_BY_ID, overviewKpiValue,
} from '../data/overview.js';
import { dataSources } from '../data/business.js';
import { CHANNEL_BY_ID, channelsFor } from '../data/catalog.js';
import { live } from '../data/live.js';
import { money, num, pct, fmtDate, relativeTime, changePct } from '../lib/format.js';
import { Card, Pill, Delta, Track } from '../components/ui/index.jsx';
import { NotConnected } from '../components/ui/NotConnected.jsx';
import { RevenueTrend, HealthGauge } from '../components/charts/index.jsx';
import { subjectFromScope } from '../data/watchlist.js';
import { PeriodPicker } from '../components/shell/Shell.jsx';
import { HealthModal } from '../components/health/HealthBreakdown.jsx';
import {
  RevenueLadder, ProductIntelligence, Readings, EventPointers, MarketMix,
} from '../components/overview/Sections.jsx';
import { channelColor } from '../lib/channels.js';
import { buildEventMarkers } from '../lib/markers.js';

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
    dataVersion, overviewLayout, overviewKpis,
  } = useApp();
  const { user } = useSession();
  const { open } = useDrill();
  const [showHealth, setShowHealth] = useState(false);

  const company = COMPANY_BY_ID[companyId];
  const firstName = (user?.full_name || '').trim().split(' ')[0];

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

  // "Previous Year" on 4 days of October reads as "all of last October" —
  // spelled out and flagged so a dramatic swing isn't read as more than it is.
  const compareInfo = comparisonExplainer(period, comparison, periodId);

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

  // Always company-wide: the point of this strip is to compare channels, so it
  // must not collapse to a single row when the channel filter is on.
  const byChannel = useMemo(() => groupBy(companyScope, 'channel'), [companyScope]);
  const prevByChannel = useMemo(
    () => new Map(groupBy(prevCompanyScope, 'channel').map(r => [r.key, r])),
    [prevCompanyScope]
  );

  const sources = useMemo(() => dataSources(), [dataVersion]);

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
          {/* Every figure on this page is only as current as this — it escalates
              on its own once the sync is actually stale, rather than reading
              the same quiet grey at 2 minutes and at 2 days. */}
          {freshness && (
            <span
              className={`freshness ${freshnessTone(freshness.at)}`}
              title={`${freshness.source} · ${freshness.count} live connection(s)`}
            >
              <span className={`dot ${freshnessTone(freshness.at)}`} />
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
                  // The rolling trailing-months view (gmv.rolling) always compares
                  // whole months against whole months regardless of how little of
                  // the current one has elapsed — the "partial period" caveat only
                  // applies when the chart is actually plotting the raw period.
                  compareLabel={gmv.rolling ? comparisonLabel(comparison) : compareInfo.label}
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

          default:
            return null;
        }
      })}

      {showHealth && <HealthModal health={health} onClose={() => setShowHealth(false)} />}
    </div>
  );
}
