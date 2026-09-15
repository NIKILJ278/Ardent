import { salesWaterfall } from '../../data/engine.js';
import { inr, num, pct, fmtDate } from '../../lib/format.js';
import { Pill, Delta } from '../ui/index.jsx';
import { STOCK_STATES } from '../../data/inventory.js';

/* ── Waterfall — one definition, filtered by permission ─────────────────── */

export function Waterfall({ model, can }) {
  const rows = salesWaterfall(model, can);
  const peak = Math.max(...rows.map(r => Math.abs(r.value)), 1);

  return (
    <div className="ladder">
      {rows.map(r => {
        const share = model.netSales ? (Math.abs(r.value) / model.netSales) * 100 : 0;
        const isCost = r.kind === 'cost';
        const tone =
          r.kind === 'total' ? (r.value >= 0 ? 'good' : 'critical')
          : r.kind === 'subtotal' ? 'accent'
          : r.kind === 'start' ? 'muted' : 'cost';
        return (
          <div className={`ladder-row ${r.kind}`} key={r.id}>
            <span className="ladder-label">
              {isCost && <span className="ladder-minus">−</span>}
              {r.label}
            </span>
            <span className="ladder-bar">
              <span className={`ladder-fill ${tone}`} style={{ width: `${Math.max(1, (Math.abs(r.value) / peak) * 100)}%` }} />
            </span>
            <span className={`ladder-value ${isCost ? 'cost' : ''}`}>{inr(Math.abs(r.value))}</span>
            <span className="ladder-pct">{r.id === 'gross' ? '' : pct(share)}</span>
          </div>
        );
      })}
      <div className="ladder-foot">
        Percentages are share of Net Sales.
        {!can?.profit && ' Cost of goods and profitability are not included in your view.'}
      </div>
    </div>
  );
}

/* ── Metric tile: what it is, and whether it is good ────────────────────── */

export function Metric({ label, value, sub, delta, deltaUnit = '%', invert, flag }) {
  return (
    <div className="kpi" style={{ cursor: 'default' }}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value tnum">{value}</span>
      <span className="kpi-sub">
        {delta != null && !Number.isNaN(delta) && <Delta value={delta} suffix={deltaUnit} invert={invert} />}
        {sub && <span className="muted">{sub}</span>}
        {flag && <Pill tone={flag.tone}>{flag.label}</Pill>}
      </span>
    </div>
  );
}

/* ── Channel economics: the cost stack, always ₹ + % ────────────────────── */

export function CostStack({ model, showCogs = false }) {
  const lines = [
    showCogs && { id: 'cogs', label: 'Cost of Goods Sold', v: model.cogs, p: model.cogsPct },
    { id: 'fees',        label: 'Channel Fees',         v: model.channelFees, p: model.channelFeesPct },
    { id: 'logistics',   label: 'Logistics',            v: model.logistics,   p: model.logisticsPct },
    { id: 'warehousing', label: 'Warehousing',          v: model.warehousing, p: model.warehousingPct },
    { id: 'fulfilment',  label: 'Fulfilment',           v: model.fulfilment,  p: model.fulfilmentPct },
    { id: 'payment',     label: 'Payment & Collection', v: model.paymentFees, p: model.paymentFeesPct },
    { id: 'other',       label: 'Other Channel Costs',  v: model.otherCost,   p: model.otherCostPct },
  ].filter(Boolean);
  const peak = Math.max(...lines.map(l => l.v), 1);

  return (
    <div className="vstack" style={{ gap: 9 }}>
      {lines.map(l => (
        <div className="bar-row" key={l.id}>
          <span className="bl" title={l.label}>{l.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(1.5, (l.v / peak) * 100)}%`, background: 'var(--series-2)' }} />
          </div>
          <span className="bv">{inr(l.v)} <span className="muted" style={{ fontWeight: 500 }}>{pct(l.p)}</span></span>
        </div>
      ))}
      <div className="spread" style={{ paddingTop: 10, marginTop: 2, borderTop: '1px solid var(--border)' }}>
        <span className="small" style={{ fontWeight: 600 }}>Total Channel Cost</span>
        <span className="tnum" style={{ fontWeight: 700 }}>
          {inr(model.channelCost)} <span className="muted small" style={{ fontWeight: 500 }}>{pct(model.channelCostPct)}</span>
        </span>
      </div>
    </div>
  );
}

/* ── Unit economics: the same shape for company or a single channel ─────── */

export function UnitEconomics({ model, can, dense = false }) {
  const cells = [
    { l: 'Revenue / Order', v: inr(model.revenuePerOrder) },
    { l: 'AOV',             v: inr(model.revenuePerOrder) },
    { l: 'ASP',             v: inr(model.asp) },
    { l: 'Units / Order',   v: model.unitsPerOrder.toFixed(2) },
    { l: 'Discount / Order',v: inr(model.discountPerOrder) },
    { l: 'Return %',        v: pct(model.returnPct) },
    { l: 'Cancellation %',  v: pct(model.cancelPct) },
    { l: 'Channel Cost / Order', v: inr(model.channelCostPerOrder) },
    { l: 'Logistics / Order',    v: inr(model.logisticsPerOrder) },
    { l: 'Channel Fee / Order',  v: inr(model.feesPerOrder) },
    can?.profit && { l: 'Contribution / Order', v: inr(model.contributionPerOrder) },
    can?.profit && { l: 'Contribution Margin',  v: pct(model.cm1Pct) },
  ].filter(Boolean);

  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit,minmax(${dense ? 108 : 124}px,1fr))`, gap: 10 }}>
      {cells.map(c => (
        <div key={c.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
          <div className="tiny muted">{c.l}</div>
          <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{c.v}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Flags — kept few and always carrying the number that triggered them ── */

export function FlagRow({ flags, max = 3 }) {
  if (!flags?.length) return null;
  return (
    <div className="hstack" style={{ gap: 6, flexWrap: 'wrap' }}>
      {flags.slice(0, max).map((f, i) => (
        <span key={i} title={f.detail}>
          <Pill tone={f.tone}>{f.label} · {f.detail}</Pill>
        </span>
      ))}
    </div>
  );
}

/** ₹ plus share — the pairing that separates scale from unit economics. */
export function MoneyPct({ v, p }) {
  return (
    <span className="tnum">
      {inr(v)} <span className="muted tiny" style={{ fontWeight: 500 }}>{pct(p)}</span>
    </span>
  );
}

export { num };

/* ── Weekly product performance, including stock in hand ────────────────── */

export function WeeklyProduct({ data }) {
  const { weeks, stockIsCompanyWide, avgWeeklyDemand, reorderPoint, plan, weeksStockedOut } = data;
  if (!weeks.length) return <div className="empty" style={{ padding: 28 }}>No weeks in this period</div>;

  const peakUnits = Math.max(...weeks.map(w => w.units), 1);
  const peakStock = Math.max(...weeks.map(w => w.closingStock), 1);

  return (
    <div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Week starting</th>
              <th className="num">Units</th>
              <th className="num">Sales</th>
              <th className="num">Avg ASP</th>
              <th className="num">Return %</th>
              <th className="num">Received</th>
              <th className="num">Stock in hand</th>
              <th className="num">Cover</th>
              <th>Position</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.id}>
                <td>
                  {fmtDate(w.ts, 'long')}
                  {w.partial && <span className="tiny muted" style={{ display: 'block' }}>partial week</span>}
                </td>
                <td className="num">
                  <span className="hstack" style={{ gap: 7, justifyContent: 'flex-end' }}>
                    <span style={{ width: 40, height: 5, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${(w.units / peakUnits) * 100}%`, background: 'var(--series-1)' }} />
                    </span>
                    <span className="tnum">{num(w.units)}</span>
                  </span>
                </td>
                <td className="num">{inr(w.netSales)}</td>
                <td className="num">{w.units ? inr(w.asp) : <span className="muted">—</span>}</td>
                <td className="num">
                  <span style={w.returnPct > 12 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>
                    {pct(w.returnPct)}
                  </span>
                </td>
                <td className="num">{w.received ? <span className="tnum" style={{ color: 'var(--good-ink)' }}>+{num(w.received)}</span> : <span className="muted">—</span>}</td>
                <td className="num">
                  <span className="hstack" style={{ gap: 7, justifyContent: 'flex-end' }}>
                    <span style={{ width: 40, height: 5, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                      <span style={{
                        display: 'block', height: '100%', width: `${(w.closingStock / peakStock) * 100}%`,
                        background: w.state === 'healthy' ? 'var(--good)' : w.state === 'low' ? 'var(--warning)' : 'var(--critical)',
                      }} />
                    </span>
                    <strong className="tnum">{num(w.closingStock)}</strong>
                  </span>
                </td>
                <td className="num">{w.coverWeeks.toFixed(1)}w</td>
                <td><Pill tone={STOCK_STATES[w.state].tone}>{STOCK_STATES[w.state].label}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ladder-foot">
        Stock is the closing balance each week: opening plus receipts and restocked returns, less units sold.
        Average demand {Math.round(avgWeeklyDemand)} units a week · reorder at {num(reorderPoint)} units ·
        {' '}{plan.leadTimeWeeks}-week lead time.
        {stockIsCompanyWide && ' Stock is company-wide — one warehouse serves every channel — while sales reflect the channel filter.'}
        {weeksStockedOut > 0 && ` ${weeksStockedOut} week(s) stocked out.`}
      </div>
    </div>
  );
}
