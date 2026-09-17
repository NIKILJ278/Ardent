import { useMemo, useState } from 'react';
import { salesModel, series } from '../../data/engine.js';
import { money, num, fmtDate, changePct } from '../../lib/format.js';
import { Card, Segmented, Delta } from '../ui/index.jsx';
import { NotConnected } from '../ui/NotConnected.jsx';
import { MeasureBars } from '../charts/index.jsx';

/* ── Sales — one toggle, one chart, one space ───────────────────────────── */

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
            {mode === 'gmv' ? money(total) : num(total)}
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
                {mode === 'gmv' ? money(weeks[weeks.length - 1].value) : `${num(weeks[weeks.length - 1].value)} units`}
              </span>
            </div>
          </div>
        )}
      </div>

      {weeks.length === 0 ? (
        <div className="empty" style={{ padding: 30 }}>No sales in this period</div>
      ) : (
        <>
          <MeasureBars data={weeks} height={190} valueFmt={mode === 'gmv' ? money : num} />
          <div className="ladder-foot" style={{ marginTop: 4 }}>
            Week-on-week {mode === 'gmv' ? 'GMV' : 'units'} across the selected period.
          </div>
        </>
      )}
    </Card>
  );
}

/* ── Marketplace economics ─────────────────────────────────────────────────
   GMV down to marketplace realized sales needs each marketplace's own fee and
   settlement feed. Only your own store is connected, and its order data carries
   no marketplace deductions, so there is nothing here to draw.
   ──────────────────────────────────────────────────────────────────────── */

export function MarketplaceEconomics() {
  return (
    <div className="vstack" style={{ gap: 14 }}>
      <div className="spread" style={{ alignItems: 'baseline' }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Marketplace economics</div>
      </div>
      <Card>
        <NotConnected
          title="GMV to marketplace realized sales"
          needs="Amazon, Flipkart or Myntra seller accounts"
        >
          This ladder subtracts commission, closing fees, shipping and settlement deductions from
          marketplace GMV. Every one of those figures comes from the marketplace itself — none can
          be derived from your own store's orders.
        </NotConnected>
      </Card>
    </div>
  );
}
