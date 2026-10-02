import { salesWaterfall, series } from '../../data/engine.js';
import { money, num, pct, fmtDate } from '../../lib/format.js';
import { Pill, Delta } from '../ui/index.jsx';
import { NotConnected } from '../ui/NotConnected.jsx';

/* ── Waterfall — one definition, filtered by permission ───────────────────
   The ladder runs as far as synced order data reaches and then stops. What it
   cannot show is listed underneath by name, so a missing cost is visible
   rather than silently absent.
   ──────────────────────────────────────────────────────────────────────── */

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
            <span className={`ladder-value ${isCost ? 'cost' : ''}`}>{money(Math.abs(r.value))}</span>
            <span className="ladder-pct">{r.id === 'gross' ? '' : pct(share)}</span>
          </div>
        );
      })}

      {rows.missing?.length > 0 && (
        <div className="ladder-missing">
          {rows.missing.map(line => (
            <div className="ladder-missing-line" key={line}>
              <span className="ladder-missing-tag">not connected</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}

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

/* ── Unit economics — only what an order line can actually answer ───────── */

export function UnitEconomics({ model, can, dense = false }) {
  const showCogs = model.known.cogs && (!can || can('fin.cogs'));
  const cells = [
    { l: 'Revenue / Order', v: money(model.revenuePerOrder) },
    { l: 'ASP',             v: money(model.asp) },
    { l: 'Units / Order',   v: model.unitsPerOrder.toFixed(2) },
    { l: 'Discount / Order', v: money(model.discountPerOrder) },
    { l: 'Return %',        v: pct(model.returnPct) },
    { l: 'Cancellation %',  v: pct(model.cancelPct) },
    showCogs && { l: 'Gross Margin / Order', v: money(model.grossMarginPerOrder) },
    showCogs && { l: 'Gross Margin %',       v: pct(model.grossMarginPct) },
  ].filter(Boolean);

  return (
    <div className="vstack" style={{ gap: 12 }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit,minmax(${dense ? 108 : 124}px,1fr))`, gap: 10 }}>
        {cells.map(c => (
          <div key={c.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
            <div className="tiny muted">{c.l}</div>
            <div className="tnum" style={{ fontWeight: 600, fontSize: 15, marginTop: 2 }}>{c.v}</div>
          </div>
        ))}
      </div>

      {!showCogs && (
        <NotConnected
          title="Cost of goods per order"
          needs="unit costs on every product sold"
          compact
        >
          Shopify reports a unit cost only where you have entered one. Until every sold unit
          carries one, a margin per order would understate cost.
        </NotConnected>
      )}
      <NotConnected
        title="Channel fee, logistics and contribution per order"
        needs="payment gateway and courier connections"
        compact
      />
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

/** Money plus share — the pairing that separates scale from unit economics. */
export function MoneyPct({ v, p }) {
  if (v == null) return <span className="tiny muted">not connected</span>;
  return (
    <span className="tnum">
      {money(v)} <span className="muted tiny" style={{ fontWeight: 500 }}>{pct(p)}</span>
    </span>
  );
}

export { num };

/* ── Weekly sales — real order weeks, no stock ledger ─────────────────────
   Stock in hand needs an inventory source, so this is what orders alone can
   say: how much sold each week, at what price, and how much came back.
   ──────────────────────────────────────────────────────────────────────── */

export function WeeklySales({ scope }) {
  const weeks = series(scope, 'week');
  if (!weeks.length) return <div className="empty" style={{ padding: 28 }}>No weeks with sales in this period</div>;

  const peakUnits = Math.max(...weeks.map(w => w.units), 1);

  return (
    <div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Week starting</th>
              <th className="num">Units</th>
              <th className="num">Orders</th>
              <th className="num">Net sales</th>
              <th className="num">Avg ASP</th>
              <th className="num">Returns</th>
              <th className="num">Return %</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => {
              const net = w.grossSales - w.cancelValue - w.returnsValue - w.discount;
              const asp = w.units ? (w.grossSales - w.discount) / w.units : null;
              const returnPct = w.grossSales ? (w.returnsValue / w.grossSales) * 100 : 0;
              return (
                <tr key={w.date}>
                  <td>{fmtDate(w.ts, 'long')}</td>
                  <td className="num">
                    <span className="hstack" style={{ gap: 7, justifyContent: 'flex-end' }}>
                      <span style={{ width: 40, height: 5, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${(w.units / peakUnits) * 100}%`, background: 'var(--series-1)' }} />
                      </span>
                      <span className="tnum">{num(w.units)}</span>
                    </span>
                  </td>
                  <td className="num">{num(w.orders)}</td>
                  <td className="num">{money(net)}</td>
                  <td className="num">{asp == null ? <span className="muted">—</span> : money(asp)}</td>
                  <td className="num">{money(w.returnsValue)}</td>
                  <td className="num">
                    <span style={returnPct > 12 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>
                      {pct(returnPct)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="ladder-foot">
        Weeks run Monday to Sunday and are summed from your synced orders. Stock in hand needs an
        inventory source, which is not connected.
      </div>
    </div>
  );
}
