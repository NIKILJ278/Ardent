import { ArrowRight, Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, Pill, Delta, Segmented } from '../ui/index.jsx';
import { inr, num, pct } from '../../lib/format.js';

/* ── Revenue: GMV to final realized sales ──────────────────────────────────
   The hero. It reuses the ladder language the Sales page already uses, so the
   CEO meets the same shape wherever a deduction stack appears — but here the
   three anchor figures are lifted out above it, because the point of this
   section is the journey's start, middle and end, not the individual lines.
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
          <span className="rev-anchor-value">{inr(ladder.gmv)}</span>
          {delta != null && <Delta value={delta} />}
        </div>
        <span className="rev-arrow">→</span>
        <div className="rev-anchor">
          <span className="rev-anchor-label">Net Sales</span>
          <span className="rev-anchor-value mid">{inr(ladder.netSales)}</span>
          <span className="tiny muted">{pct((ladder.netSales / peak) * 100)} of GMV</span>
        </div>
        <span className="rev-arrow">→</span>
        <div className="rev-anchor">
          <span className="rev-anchor-label">Final Realized Sales</span>
          <span className="rev-anchor-value final">{inr(ladder.realized)}</span>
          <span className="tiny muted">{pct(ladder.realizedPct)} of GMV</span>
        </div>
      </div>

      <div className="ladder rev-ladder">
        {ladder.rows.map(r => {
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
              <span className={`ladder-value ${isCost ? 'cost' : ''}`}>{inr(Math.abs(r.value))}</span>
              <span className="ladder-pct">{r.id === 'gmv' ? '' : pct(r.pct)}</span>
            </div>
          );
        })}
      </div>

      <div className="ladder-foot">
        Every percentage is a share of GMV, so the lines compare directly.
        {' '}{inr(ladder.totalDeductions)} of {inr(ladder.gmv)} never reaches the company.
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

export function ProductIntelligence({ intel, onOpen }) {
  const viewAll = (
    <Link to="/sales" className="linkish">View all <ArrowRight size={13} /></Link>
  );

  return (
    <div>
      <div className="spread" style={{ alignItems: 'baseline', marginBottom: 10 }}>
        <span className="section-title" style={{ marginBottom: 0 }}>Product intelligence</span>
        <span className="tiny muted">
          {num(intel.count)} products selling · average return rate {pct(intel.averageReturnPct)}
        </span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(288px,1fr))' }}>
        <Card title="Top products" subtitle="Carrying the period" actions={viewAll}>
          <ProductList
            rows={intel.top} tone="good"
            value={r => ({ n: r.netSales, text: inr(r.netSales) })}
            meta={r => (r.growth == null ? null : <Delta value={r.growth} showIcon={false} />)}
            empty="No products sold in this period."
          />
        </Card>

        <Card title="Least-selling products" subtitle="Not paying their way">
          <ProductList
            rows={intel.weak} tone="muted"
            value={r => ({ n: r.netSales, text: inr(r.netSales) })}
            meta={r => (r.growth == null ? null : <Delta value={r.growth} showIcon={false} />)}
            empty="Nothing under-performing."
          />
        </Card>

        <Card title="Major return products" subtitle="Ranked by rate, filtered to material value">
          <ProductList
            rows={intel.returns} tone="critical"
            value={r => ({ n: r.returnPct, text: pct(r.returnPct) })}
            meta={r => <span className="tiny muted tnum">{inr(r.returnValue)}</span>}
            empty="No material return problem."
          />
        </Card>
      </div>
      {onOpen && null}
    </div>
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
    <button className={`fin-fig${tone ? ` ${tone}` : ''}`} onClick={onClick} type="button">
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
          {/* The event's own measured effect, kept separate from the month's
              movement so the two are never confused for one another. */}
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
