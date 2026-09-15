import { useMemo } from 'react';
import { Wallet, Percent, Landmark, Timer, TrendingUp, ArrowDownLeft, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useDrill } from '../state/Drilldown.jsx';
import { financials, series } from '../data/engine.js';
import { inr, pct, fmtDate, changePct } from '../lib/format.js';
import { Card, Delta, Pill, Track } from '../components/ui/index.jsx';
import { Bridge, RevenueTrend } from '../components/charts/index.jsx';

export default function Finance() {
  const { scope, prevScope } = useApp();
  const { open } = useDrill();

  const fin  = useMemo(() => financials(scope),     [scope]);
  const prev = useMemo(() => financials(prevScope), [prevScope]);

  /* Gross → net bridge. Deductions are negative and coloured as such; the two
     anchors (gross, net) use the neutral series colour, not a status colour. */
  const bridge = useMemo(() => ([
    { label: 'Gross',     value: fin.gross,        color: 'var(--series-1)' },
    { label: 'Discounts', value: -fin.discount,    color: 'var(--series-2)' },
    { label: 'Fees',      value: -fin.fees,        color: 'var(--series-2)' },
    { label: 'Shipping',  value: -fin.shipping,    color: 'var(--series-2)' },
    { label: 'Returns',   value: -fin.returnsValue,color: 'var(--series-2)' },
    { label: 'Net',       value: fin.net,          color: 'var(--series-3)' },
  ]), [fin]);

  const trend = useMemo(() => {
    const cur = series(scope, 'day');
    return cur.map(d => ({ label: fmtDate(d.ts), value: d.margin }));
  }, [scope]);

  const pnl = [
    { line: 'Net revenue',        value: fin.net,          strong: true },
    { line: 'Cost of goods sold', value: -fin.cogs },
    { line: 'Gross profit',       value: fin.grossProfit,  strong: true, sub: pct(fin.grossMarginPct) },
    { line: 'Marketing',          value: -fin.marketing },
    { line: 'Salaries',           value: -fin.salaries },
    { line: 'Logistics',          value: -fin.logistics },
    { line: 'Overheads',          value: -fin.overheads },
    { line: 'EBITDA',             value: fin.ebitda,       strong: true, sub: pct(fin.ebitdaPct) },
    { line: 'Depreciation',       value: -fin.depreciation },
    { line: 'Interest',           value: -fin.interest },
    { line: 'Profit before tax',  value: fin.pbt,          strong: true },
    { line: 'Tax',                value: -fin.tax },
    { line: 'Net profit',         value: fin.netProfit,    strong: true, sub: pct(fin.netMarginPct) },
  ];

  const kpis = [
    { label: 'Revenue',    value: inr(fin.net),      d: changePct(fin.net, prev.net),       icon: TrendingUp,    metric: 'net' },
    { label: 'EBITDA',     value: inr(fin.ebitda),   d: changePct(fin.ebitda, prev.ebitda), icon: Wallet,        metric: 'ebitda', sub: pct(fin.ebitdaPct) },
    { label: 'Net Profit', value: inr(fin.netProfit),d: changePct(fin.netProfit, prev.netProfit), icon: Percent, metric: 'netProfit' },
    { label: 'Net Margin', value: pct(fin.netMarginPct), d: fin.netMarginPct - prev.netMarginPct, icon: Percent, metric: 'netProfit' },
    { label: 'Cash',       value: inr(fin.cash),     icon: Landmark, metric: 'cash', sub: 'at bank' },
    { label: 'Burn Rate',  value: `${inr(fin.burnRate)}/mo`, icon: Timer, metric: 'opex' },
    { label: 'Runway',     value: `${fin.runwayMonths?.toFixed(1)} mo`, icon: Timer, metric: 'runwayMonths', format: 'months' },
    { label: 'Receivables',value: inr(fin.receivables), d: changePct(fin.receivables, prev.receivables), invert: true, icon: ArrowDownLeft, metric: 'receivables' },
    { label: 'Payables',   value: inr(fin.payables), icon: ArrowUpRight, metric: 'payables' },
    { label: 'Overdues',   value: inr(fin.overdues), icon: AlertTriangle, metric: 'overdues', warn: 'Attention' },
  ];

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Finance</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Profitability, cash and working capital. Every line traces back to source transactions.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))' }}>
        {kpis.map(k => (
          <button
            className="kpi" key={k.label}
            onClick={() => open({ type: 'metric', label: k.label, metric: k.metric, format: k.format, invert: k.invert, scope })}
          >
            <span className="kpi-label"><k.icon size={12} strokeWidth={2} />{k.label}</span>
            <span className="kpi-value tnum">{k.value}</span>
            <span className="kpi-sub">
              {k.d != null && <Delta value={k.d} invert={k.invert} />}
              {k.warn ? <Pill tone="warning">{k.warn}</Pill> : k.sub && <span>{k.sub}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)' }}>
        <Card title="Gross to net bridge" subtitle="What was deducted between the sale and the money we keep">
          <Bridge data={bridge} height={268} />
          <div className="legend" style={{ marginTop: 10 }}>
            <span className="legend-item"><span className="swatch" style={{ background: 'var(--series-1)' }} />Gross sales</span>
            <span className="legend-item"><span className="swatch" style={{ background: 'var(--series-2)' }} />Deductions</span>
            <span className="legend-item"><span className="swatch" style={{ background: 'var(--series-3)' }} />Net revenue</span>
          </div>
        </Card>

        <Card title="Profit & loss" subtitle="For the selected period" flush>
          <div style={{ padding: '4px 16px 12px' }}>
            {pnl.map((r, i) => (
              <div
                key={r.line}
                className="spread"
                style={{
                  padding: '8px 0',
                  borderBottom: i < pnl.length - 1 ? '1px solid var(--border)' : 'none',
                  background: r.strong ? 'transparent' : undefined,
                }}
              >
                <span className="small" style={{ fontWeight: r.strong ? 600 : 400, color: r.strong ? 'var(--ink)' : 'var(--ink-2)' }}>
                  {r.line}
                  {r.sub && <span className="tiny muted" style={{ marginLeft: 6 }}>{r.sub}</span>}
                </span>
                <span
                  className="small tnum"
                  style={{
                    fontWeight: r.strong ? 700 : 500,
                    color: r.value < 0 ? 'var(--critical-ink)' : 'var(--ink)',
                  }}
                >
                  {r.value < 0 ? '−' : ''}{inr(Math.abs(r.value))}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))' }}>
        <Card title="Gross profit trend" subtitle="Daily contribution after cost of goods">
          <RevenueTrend data={trend} height={200} showCompare={false} />
        </Card>

        <Card title="Working capital" subtitle="Money owed to us, and by us">
          <div className="vstack" style={{ gap: 15 }}>
            {[
              { l: 'Receivables', v: fin.receivables, note: 'Owed to us by marketplaces', tone: 'accent' },
              { l: 'Payables',    v: fin.payables,    note: 'Owed by us to vendors',      tone: 'warning' },
              { l: 'Overdues',    v: fin.overdues,    note: 'Past due — needs chasing',   tone: 'critical' },
            ].map(r => {
              const peak = Math.max(fin.receivables, fin.payables, fin.overdues, 1);
              return (
                <div key={r.l}>
                  <div className="spread" style={{ marginBottom: 5 }}>
                    <span className="small">{r.l}<span className="tiny muted" style={{ marginLeft: 7 }}>{r.note}</span></span>
                    <span className="small tnum" style={{ fontWeight: 600 }}>{inr(r.v)}</span>
                  </div>
                  <Track value={(r.v / peak) * 100} tone={r.tone} />
                </div>
              );
            })}

            <div className="spread" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <span className="small muted">Runway at current burn</span>
              <span className="hstack" style={{ gap: 8 }}>
                <span className="tnum" style={{ fontWeight: 600 }}>{fin.runwayMonths?.toFixed(1)} months</span>
                <Pill tone={fin.runwayMonths >= 8 ? 'good' : fin.runwayMonths >= 5 ? 'warning' : 'critical'}>
                  {fin.runwayMonths >= 8 ? 'Comfortable' : fin.runwayMonths >= 5 ? 'Watch' : 'Tight'}
                </Pill>
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
