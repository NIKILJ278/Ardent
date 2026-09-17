import { useMemo, useState } from 'react';
import { Card, Segmented, Delta } from '../ui/index.jsx';
import { NotConnected } from '../ui/NotConnected.jsx';
import { revenueSplit } from '../../data/ads.js';
import { CHANNEL_BY_ID } from '../../data/catalog.js';
import { money, pct, currencySymbol } from '../../lib/format.js';

const STREAM_COLOR = {
  all: 'var(--series-1)',
  organic: 'var(--series-1)',
  ads: 'var(--series-2)',
  course: 'var(--series-3)',
};

/**
 * Where revenue actually comes from.
 *
 * Splitting organic from ad-driven revenue needs each order credited to a
 * campaign, which only an ad platform can supply. Until one is connected there
 * is one honest bucket — all of it — and the attribution gap is stated rather
 * than filled with a modelled share.
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
        <Segmented
          options={[{ id: 'value', label: currencySymbol() }, { id: 'pct', label: '%' }]}
          value={mode} onChange={setMode} size="sm"
        />
      }
    >
      {options.length > 2 && (
        <div className="rs-channels">
          {options.map(o => (
            <button
              key={o.id} type="button"
              className={`chip${channelId === o.id ? ' active' : ''}`}
              onClick={() => onChannel(o.id)}
            >{o.label}</button>
          ))}
        </div>
      )}

      <div className="rs-total">
        <span className="tiny muted">Total revenue</span>
        <span className="rs-total-value tnum">{money(split.total)}</span>
        {totalChange != null && <Delta value={totalChange} />}
      </div>

      <div className="rs-bar" role="img" aria-label="Revenue split by source">
        {split.rows.filter(r => r.pct > 0).map(r => (
          <span
            key={r.id}
            className="rs-seg"
            style={{ width: `${r.pct}%`, background: STREAM_COLOR[r.id] ?? 'var(--series-1)' }}
            title={`${r.label} ${money(r.value)} (${pct(r.pct)})`}
          />
        ))}
      </div>

      <div className="rs-rows">
        {split.rows.map(r => (
          <div className="rs-row" key={r.id}>
            <span className="hstack" style={{ gap: 8, minWidth: 0 }}>
              <span className="swatch" style={{ background: STREAM_COLOR[r.id] ?? 'var(--series-1)' }} />
              <span style={{ minWidth: 0 }}>
                <span className="rs-label">{r.label}</span>
                <span className="tiny muted" style={{ display: 'block' }}>{r.blurb}</span>
              </span>
            </span>
            <span className="rs-figures">
              <span className="rs-value tnum">{mode === 'value' ? money(r.value) : pct(r.pct)}</span>
              <span className="tiny muted tnum">
                {mode === 'value' ? pct(r.pct) : money(r.value)}
              </span>
            </span>
            <span className="rs-delta">
              {r.change == null ? <span className="tiny muted">—</span> : <Delta value={r.change} />}
            </span>
          </div>
        ))}
      </div>

      {!split.attributed && (
        <div style={{ marginTop: 12 }}>
          <NotConnected
            title="Organic, ad-driven and course revenue"
            needs="Meta Ads, Google Ads or another ad platform"
            compact
          >
            Attribution has to come from the platform that ran the campaign. Splitting this total
            without it would be a guess dressed as a measurement.
          </NotConnected>
        </div>
      )}
    </Card>
  );
}
