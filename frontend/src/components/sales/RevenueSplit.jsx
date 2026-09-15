import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, Segmented, Delta } from '../ui/index.jsx';
import { revenueSplit } from '../../data/ads.js';
import { CHANNEL_BY_ID } from '../../data/catalog.js';
import { inr, pct } from '../../lib/format.js';

const STREAM_COLOR = {
  organic: 'var(--series-1)',
  ads: 'var(--series-2)',
  course: 'var(--series-3)',
};

/**
 * Where revenue actually comes from.
 *
 * One stacked bar rather than three cards, because the question is about
 * proportion — a CEO wants to see at a glance whether the business is bought
 * or earned. The ₹ and % toggle changes the labels, never the bar, so the
 * shape of the mix stays comparable across both readings.
 */
export function RevenueSplit({ scope, prevScope, channels, channelId, onChannel }) {
  const [mode, setMode] = useState('value');
  const split = useMemo(() => revenueSplit(scope, prevScope), [scope, prevScope]);

  const totalChange = split.prevTotal
    ? ((split.total - split.prevTotal) / split.prevTotal) * 100 : null;

  const options = [
    { id: 'all', label: 'All Channels' },
    ...channels.map(c => ({ id: c, label: CHANNEL_BY_ID[c]?.name ?? c })),
  ];

  return (
    <Card
      title="Revenue split"
      subtitle="Where the revenue actually comes from"
      actions={
        <span className="hstack" style={{ gap: 8 }}>
          <Segmented
            options={[{ id: 'value', label: '₹' }, { id: 'pct', label: '%' }]}
            value={mode} onChange={setMode} size="sm"
          />
          <Link to="/ads" className="linkish">Ads detail <ArrowRight size={13} /></Link>
        </span>
      }
    >
      {/* The channel selector belongs to this question, so it sits with it. */}
      <div className="rs-channels">
        {options.map(o => (
          <button
            key={o.id} type="button"
            className={`chip${channelId === o.id ? ' active' : ''}`}
            onClick={() => onChannel(o.id)}
          >{o.label}</button>
        ))}
      </div>

      <div className="rs-total">
        <span className="tiny muted">Total revenue</span>
        <span className="rs-total-value tnum">{inr(split.total)}</span>
        {totalChange != null && <Delta value={totalChange} />}
      </div>

      <div className="rs-bar" role="img" aria-label="Revenue split by source">
        {split.rows.filter(r => r.pct > 0).map(r => (
          <span
            key={r.id}
            className="rs-seg"
            style={{ width: `${r.pct}%`, background: STREAM_COLOR[r.id] }}
            title={`${r.label} ${inr(r.value)} (${pct(r.pct)})`}
          />
        ))}
      </div>

      <div className="rs-rows">
        {split.rows.map(r => (
          <div className="rs-row" key={r.id}>
            <span className="hstack" style={{ gap: 8, minWidth: 0 }}>
              <span className="swatch" style={{ background: STREAM_COLOR[r.id] }} />
              <span style={{ minWidth: 0 }}>
                <span className="rs-label">{r.label}</span>
                <span className="tiny muted" style={{ display: 'block' }}>{r.blurb}</span>
              </span>
            </span>
            <span className="rs-figures">
              <span className="rs-value tnum">{mode === 'value' ? inr(r.value) : pct(r.pct)}</span>
              <span className="tiny muted tnum">
                {mode === 'value' ? pct(r.pct) : inr(r.value)}
              </span>
            </span>
            <span className="rs-delta">
              {r.change == null ? <span className="tiny muted">—</span> : <Delta value={r.change} />}
              {r.prevPct != null && (
                <span className="tiny muted" style={{ display: 'block' }}>
                  was {pct(r.prevPct)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="ladder-foot">
        Ad-driven revenue is the slice a campaign was credited with inside its attribution
        window, not revenue added on top. Organic is the remainder, so the three always sum to
        total revenue. Spend behind the ad slice was {inr(split.adSpend)}.
      </div>
    </Card>
  );
}
