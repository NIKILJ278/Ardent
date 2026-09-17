import { ArrowRight, Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, Pill, Delta, Segmented } from '../ui/index.jsx';
import { money, num, pct } from '../../lib/format.js';

/* ── Revenue: GMV to final realized sales ──────────────────────────────────
   The hero. GMV down to net sales is real. The rows below net sales need your
   payment gateway and courier data, so they are listed with no figure — the
   gap is visible rather than filled with an assumed rate.
   ──────────────────────────────────────────────────────────────────────── */

export function RevenueLadder({ ladder, platform, platforms, onPlatform, delta }) {
  const peak = ladder.gmv || 1;

  return (
    <Card
      className="rev-card"
      title="Revenue"
      subtitle="From GMV to final realized sales"
      actions={
        platforms.length > 2 ? (
          <Segmented
            options={platforms.map(p => ({ id: p.id, label: p.id === 'all' ? 'All' : p.name }))}
            value={platform} onChange={onPlatform} size="sm"
          />
        ) : null
      }
    >
      <div className="rev-anchors">
        <div className="rev-anchor lead">
          <span className="rev-anchor-label">GMV</span>
          <span className="rev-anchor-value">{money(ladder.gmv)}</span>
          {delta != null && <Delta value={delta} />}
        </div>
        <span className="rev-arrow">→</span>
        <div className="rev-anchor">
          <span className="rev-anchor-label">Net Sales</span>
          <span className="rev-anchor-value mid">{money(ladder.netSales)}</span>
          <span className="tiny muted">{pct(ladder.netSalesPct)} of GMV</span>
        </div>
        <span className="rev-arrow">→</span>
        <div className="rev-anchor">
          <span className="rev-anchor-label">Final Realized Sales</span>
          {ladder.realizedKnown ? (
            <>
              <span className="rev-anchor-value final">{money(ladder.realized)}</span>
              <span className="tiny muted">{pct(ladder.realizedPct)} of GMV</span>
            </>
          ) : (
            <>
              <span className="rev-anchor-value unknown">Not connected</span>
              <span className="tiny muted">needs gateway and courier costs</span>
            </>
          )}
        </div>
      </div>

      <div className="ladder rev-ladder">
        {ladder.rows.map(r => {
          const missing = r.kind === 'missing' || r.missing;
          if (missing) {
            return (
              <div className="ladder-row missing" key={r.id}>
                <span className="ladder-label">
                  {r.kind === 'missing' && <span className="ladder-minus">−</span>}
                  {r.label}
                </span>
                <span className="ladder-bar" />
                <span className="ladder-value"><span className="ladder-missing-tag">not connected</span></span>
                <span className="ladder-pct" />
              </div>
            );
          }
          const isCost = r.kind === 'deduct';
          const tone =
            r.kind === 'total' ? 'good'
              : r.kind === 'subtotal' ? 'accent'
                : r.kind === 'head' ? 'muted' : 'cost';
          return (
            <div className={`ladder-row ${r.kind === 'head' ? 'start' : r.kind}`} key={r.id}>
              <span className="ladder-label">
                {isCost && <span className="ladder-minus">−</span>}
                {r.label}
              </span>
              <span className="ladder-bar">
                <span className={`ladder-fill ${tone}`}
                      style={{ width: `${Math.max(1, (Math.abs(r.value) / peak) * 100)}%` }} />
              </span>
              <span className={`ladder-value ${isCost ? 'cost' : ''}`}>{money(Math.abs(r.value))}</span>
              <span className="ladder-pct">{r.id === 'gmv' ? '' : pct(r.pct)}</span>
            </div>
          );
        })}
      </div>

      <div className="ladder-foot">
        Every percentage is a share of GMV. {money(ladder.knownDeductions)} of {money(ladder.gmv)} comes off
        before net sales; the charges after net sales need your payment gateway and courier data.
      </div>
    </Card>
  );
}

/* ── Product intelligence ──────────────────────────────────────────────── */

function ProductList({ rows, value, meta, tone, empty }) {
  if (!rows.length) return <p className="tiny muted" style={{ margin: 0 }}>{empty}</p>;
  const peak = Math.max(...rows.map(r => Math.abs(value(r).n)), 1);
  return (
    <div className="vstack" style={{ gap: 9 }}>
      {rows.map(r => {
        const v = value(r);
        return (
          <div className="pi-row" key={r.id}>
            <span className="pi-name" title={r.name}>{r.name}</span>
            <span className="pi-bar">
              <span className={`pi-fill ${tone}`}
                    style={{ width: `${Math.max(3, (Math.abs(v.n) / peak) * 100)}%` }} />
            </span>
            <span className="pi-value tnum">{v.text}</span>
            <span className="pi-meta">{meta ? meta(r) : null}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ProductIntelligence({ intel }) {
  return (
    <div>
      <div className="spread" style={{ alignItems: 'baseline', marginBottom: 10 }}>
        <span className="section-title" style={{ marginBottom: 0 }}>Product intelligence</span>
        <span className="tiny muted">
          {num(intel.count)} products selling · average return rate {pct(intel.averageReturnPct)}
        </span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(288px,1fr))' }}>
        <Card title="Top products" subtitle="Carrying the period"
              actions={<Link to="/sales" className="linkish">View all <ArrowRight size={13} /></Link>}>
          <ProductList
            rows={intel.top} tone="good"
            value={r => ({ n: r.netSales, text: money(r.netSales) })}
            meta={r => (r.growth == null ? null : <Delta value={r.growth} showIcon={false} />)}
            empty="No products sold in this period."
          />
        </Card>

        <Card title="Least-selling products" subtitle="Not paying their way">
          <ProductList
            rows={intel.weak} tone="muted"
            value={r => ({ n: r.netSales, text: money(r.netSales) })}
            meta={r => (r.growth == null ? null : <Delta value={r.growth} showIcon={false} />)}
            empty="Not enough products to rank a bottom list yet."
          />
        </Card>

        <Card title="Major return products" subtitle="By variant, filtered to material value">
          <ProductList
            rows={intel.returns} tone="critical"
            value={r => ({ n: r.returnPct, text: pct(r.returnPct) })}
            meta={r => <span className="tiny muted tnum">{money(r.returnValue)}</span>}
            empty="No material returns in this period."
          />
        </Card>
      </div>
    </div>
  );
}

/* ── Markets: the currencies customers actually paid in ────────────────────
   A store selling abroad takes money in several currencies, and Shopify
   converts each order into the shop's own currency at that order's rate. Those
   converted figures are what every other number on this page is built from.

   This card shows the spread underneath them. The per-currency totals are
   listed and never added up: summing currencies needs exchange rates, and no
   connected source supplies one.
   ──────────────────────────────────────────────────────────────────────── */

const MARKET_COLOR = (i) => `var(--series-${(i % 6) + 1})`;

export function MarketMix({ markets, reporting }) {
  if (!markets?.length) return null;
  const totalOrders = markets.reduce((s, m) => s + m.orders, 0) || 1;

  return (
    <Card
      title="Markets"
      subtitle="What your customers paid in"
      actions={<span className="tiny muted">Reported to you in {reporting}</span>}
    >
      <div className="rs-bar" role="img" aria-label="Share of orders by currency">
        {markets.map((m, i) => (
          <span
            key={m.currency}
            className="rs-seg"
            style={{ width: `${(m.orders / totalOrders) * 100}%`, background: MARKET_COLOR(i) }}
            title={`${m.currency} — ${num(m.orders)} order(s)`}
          />
        ))}
      </div>

      <div className="vstack" style={{ gap: 8, marginTop: 13 }}>
        {markets.map((m, i) => (
          <div className="spread" key={m.currency}>
            <span className="hstack" style={{ gap: 8, minWidth: 0 }}>
              <span className="swatch" style={{ background: MARKET_COLOR(i) }} />
              <span className="small" style={{ fontWeight: 500 }}>{m.currency}</span>
              {m.currency === reporting && <Pill tone="neutral" icon={false}>store currency</Pill>}
            </span>
            <span className="hstack" style={{ gap: 14 }}>
              <span className="tiny muted tnum">{num(m.orders)} orders</span>
              <span className="small tnum" style={{ fontWeight: 600, minWidth: 52, textAlign: 'right' }}>
                {pct((m.orders / totalOrders) * 100)}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="ladder-foot">
        Each row is what customers were charged in their own currency, so the amounts are listed
        rather than added — a total across currencies would need exchange rates that no connected
        source supplies. Every other figure on this page is in {reporting}, converted by Shopify at
        each order's own rate.
      </div>
    </Card>
  );
}

/* ── Readings: what changed, why, what it cost ─────────────────────────── */

const READ_ICON = { good: TrendingUp, critical: TrendingDown, serious: TrendingDown, neutral: Minus };

export function Readings({ items }) {
  if (!items?.length) return null;
  return (
    <div className="readings">
      {items.map(r => {
        const Icon = READ_ICON[r.tone] ?? Info;
        return (
          <div className={`reading ${r.tone}`} key={r.id}>
            <Icon size={14} className="reading-icon" />
            <span className="reading-body">
              <span className="reading-what">{r.what}.</span>
              {/* The clause is written lower-case so it can also be used
                  mid-sentence; here it opens one. */}
              {' '}<span className="reading-why">{r.why.charAt(0).toUpperCase() + r.why.slice(1)}.</span>
              {r.impact && <span className="reading-impact">{r.impact}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Financial position ────────────────────────────────────────────────── */

export function FinancialFigure({ label, value, sub, tone, onClick }) {
  return (
    <button className={`fin-fig${tone ? ` ${tone}` : ''}`} onClick={onClick} type="button" disabled={!onClick}>
      <span className="fin-fig-label">{label}</span>
      <span className="fin-fig-value tnum">{value}</span>
      {sub && <span className="fin-fig-sub">{sub}</span>}
    </button>
  );
}

export function EventPointers({ pointers }) {
  if (!pointers.length) return null;
  return (
    <div className="ev-list">
      {pointers.map((p, i) => (
        <div className={`ev-item ${p.direction}`} key={i}>
          <span className="ev-move tnum">
            {p.move == null ? '·' : `${p.move >= 0 ? '↑' : '↓'} ${Math.abs(p.move).toFixed(0)}%`}
          </span>
          <span className="ev-body">
            <span className="ev-label">{p.label}</span>
            {p.event ? (
              <span className="ev-why">
                {p.event.title}
                {p.others > 0 && <span className="muted"> +{p.others} more</span>}
              </span>
            ) : (
              <span className="ev-why muted">Unexplained — no event logged for this month</span>
            )}
          </span>
          {p.impact && (
            <span className="ev-impact" title={`${p.impact.channel}: average daily revenue in the ${p.impact.windowDays} days from the event against the ${p.impact.windowDays} before`}>
              {p.impact.channel} {p.impact.changePct >= 0 ? '+' : '−'}{Math.abs(p.impact.changePct).toFixed(0)}%
              {p.impact.partial && <span className="muted"> so far</span>}
            </span>
          )}
          {p.kind && <Pill tone="neutral" icon={false}>{p.kind}</Pill>}
        </div>
      ))}
    </div>
  );
}
