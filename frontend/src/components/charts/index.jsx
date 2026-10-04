import { useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ReferenceLine, ReferenceDot, Cell,
} from 'recharts';
import { money, moneyScale, iso } from '../../lib/format.js';
import { WatchForm } from '../watch/WatchButton.jsx';
import { LabelList } from 'recharts';

/* An invisible hit target over every point, not just the one under the mouse
   (Recharts only draws `dot` on hover otherwise) — so a point is clickable the
   moment the chart is visible, not only after first hovering it. */
function ClickableDot({ cx, cy, payload, onPick }) {
  if (cx == null || cy == null) return null;
  return (
    <circle
      cx={cx} cy={cy} r={9} fill="transparent"
      style={{ cursor: 'pointer' }}
      onClick={(e) => { e.stopPropagation(); onPick(payload); }}
    />
  );
}

/** Most events shown inside one tooltip before it is summarised. */
const MAX_TIP_EVENTS = 4;

/**
 * One unit for the whole axis, chosen from its maximum. Formatting each tick
 * independently produces mixed scales on a single axis — "2.0L, 1.5L, 1.0L,
 * 50k" — which reads as a break in the series rather than a smaller number.
 *
 * The scale follows the store's currency: a rupee axis steps in lakhs and
 * crores, a dollar axis in K and M. Reading "1.2 Cr" off a USD chart would be
 * wrong twice over — wrong unit, and wrong by a factor of eight.
 */
function makeAxisFmt(max) {
  const a = Math.abs(max || 0);
  const [div, suffix] = moneyScale(a);
  const dp = div === 1 ? 0 : (a / div) >= 10 ? 0 : 1;
  return (v) => (v === 0 ? '0' : `${(v / div).toFixed(dp)}${suffix}`);
}

/** Fallback for charts that do not pass a domain maximum. */
const axisFmt = (v) => makeAxisFmt(v)(v);

/** Shared tooltip — identity is carried by a swatch plus the series name. */
function Tip({ active, payload, label, labelFmt, valueFmt = money, markerByLabel }) {
  if (!active || !payload?.length) return null;
  const marker = markerByLabel?.get(label);
  return (
    <div className="tip">
      <div className="tip-h">{labelFmt ? labelFmt(label) : label}</div>
      {payload
        .filter(p => p.value != null)
        // Primary series first; the comparison line is rendered underneath it.
        .sort((a, b) => (a.dataKey === 'compare' ? 1 : 0) - (b.dataKey === 'compare' ? 1 : 0))
        .map((p, i) => (
        <div className="tip-row" key={i}>
          <span className="k">
            <span className="swatch" style={{ background: p.color ?? p.stroke ?? p.fill }} />
            {p.name}
          </span>
          <span className="v">{valueFmt(p.value)}</span>
        </div>
      ))}

      {/* What happened on this date, and where it came from. */}
      {marker && (
        <div className="tip-events">
          {/* A coarse axis can collapse many events onto one point; cap the
              list so the tooltip stays readable. */}
          {marker.items.slice(0, MAX_TIP_EVENTS).map(ev => (
            <div className="tip-event" key={ev.id}>
              <div className="tip-event-h">
                <span className={`dot ${ev.tone === 'neutral' ? 'neutral' : ev.tone}`} />
                <span className="tip-event-kind">{ev.kindLabel}</span>
              </div>
              <div className="tip-event-title">{ev.title}</div>
              {ev.channels.length > 0 && (
                <>
                  <div className="tip-event-chans">
                    {ev.channels.map(c => (
                      <span className="chan-chip" key={c.key ?? c.name}>
                        {c.color && <span className="swatch" style={{ background: c.color }} />}
                        {c.name}
                        {c.changePct == null
                          ? <span className="chip-delta flat">n/a</span>
                          : <span className={`chip-delta ${c.changePct >= 0 ? 'up' : 'down'}`}>
                              {c.changePct >= 0 ? '+' : '−'}{Math.abs(c.changePct).toFixed(1)}%
                            </span>}
                      </span>
                    ))}
                    {ev.moreChannels > 0 && <span className="chan-chip muted">+{ev.moreChannels}</span>}
                  </div>
                  <div className="tip-event-note">
                    Revenue, 7 days from this date vs the 7 before
                    {ev.channels.some(c => c.partial) ? ' (partial — period still running)' : ''}
                  </div>
                </>
              )}
              <div className="tip-event-src">{ev.source}</div>
            </div>
          ))}
          {marker.items.length > MAX_TIP_EVENTS && (
            <div className="tip-event-more">
              +{marker.items.length - MAX_TIP_EVENTS} more event
              {marker.items.length - MAX_TIP_EVENTS > 1 ? 's' : ''} in this period
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Revenue trend ─────────────────────────────────────────────────────────
   One measure, one axis. The comparison series is the same measure over a
   different window, so it shares the scale — never a second y-axis.
   ──────────────────────────────────────────────────────────────────────── */

export function RevenueTrend({
  data, height = 280, compareLabel = 'Previous Period',
  showCompare = true, targetLine, markers = [], onMarkerClick, watchSubject,
}) {
  const hasCompare = showCompare && data.some(d => d.compare != null);
  const markerByLabel = new Map(markers.map(m => [m.label, m]));
  const axisMax = Math.max(
    ...data.map(d => Math.max(d.value ?? 0, d.compare ?? 0)),
    targetLine ?? 0, 1
  );
  const fmtTick = makeAxisFmt(axisMax);

  // Any point can be marked, not just the latest one — a result noticed
  // afterwards, from a past point on the chart, is still worth a watch.
  const [watchPoint, setWatchPoint] = useState(null);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 12, left: 2, bottom: 4 }}>
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--series-1)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }}
            tick={{ fontSize: 11 }} minTickGap={22}
          />
          <YAxis
            tickFormatter={fmtTick} tickLine={false} axisLine={false}
            tick={{ fontSize: 11 }} width={50}
          />
          <RTooltip
            content={<Tip markerByLabel={markerByLabel} />}
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          />

          {targetLine != null && (
            <ReferenceLine
              y={targetLine} stroke="var(--ink-3)" strokeDasharray="4 4"
              label={{ value: 'Target', position: 'right', fill: 'var(--ink-3)', fontSize: 10 }}
            />
          )}

          {hasCompare && (
            <Area
              type="monotone" dataKey="compare" name={compareLabel}
              stroke="var(--series-muted)" strokeWidth={2} strokeDasharray="5 4"
              fill="none" dot={false} activeDot={{ r: 4 }}
            />
          )}
          <Area
            type="monotone" dataKey="value" name="Revenue"
            stroke="var(--series-1)" strokeWidth={2} fill="url(#revFill)"
            dot={watchSubject ? <ClickableDot onPick={setWatchPoint} /> : false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--chart-surface)' }}
          />

          {markers.map(m => {
            const fill = `var(--${m.tone === 'good' ? 'good' : m.tone === 'warning' ? 'warning' : m.tone === 'serious' ? 'serious' : m.tone === 'critical' ? 'critical' : 'accent'})`;
            const count = m.items?.length ?? 1;
            return (
              <ReferenceDot
                key={m.id} x={m.label} y={m.value} r={6}
                fill={fill} stroke="var(--chart-surface)" strokeWidth={2}
                style={{ cursor: onMarkerClick ? 'pointer' : 'default' }}
                onClick={() => onMarkerClick?.(m)}
                label={count > 1 ? {
                  value: count, position: 'top', dy: -4,
                  fill: 'var(--ink-2)', fontSize: 10, fontWeight: 700,
                } : undefined}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>

      <div className="legend" style={{ marginTop: 8, paddingLeft: 46 }}>
        <span className="legend-item"><span className="swatch" style={{ background: 'var(--series-1)' }} />Revenue</span>
        {hasCompare && (
          <span className="legend-item">
            <span className="swatch" style={{ background: 'var(--series-muted)' }} />{compareLabel}
          </span>
        )}
        {markers.length > 0 && (
          <span className="legend-item">
            <span className="dot info" />
            Business events
            <span className="muted" style={{ fontSize: 11 }}>— hover a date for detail</span>
          </span>
        )}
        {watchSubject && (
          <span className="legend-item muted" style={{ fontSize: 11 }}>
            Click any point to watch it
          </span>
        )}
      </div>

      {watchPoint && (
        <WatchForm
          subject={{ ...watchSubject, markedOn: iso(new Date(watchPoint.ts ?? watchPoint.date)) }}
          onClose={() => setWatchPoint(null)}
        />
      )}
    </div>
  );
}

/* ── Simple measure bars (one series, entity-coloured, always labelled) ─── */

export function MeasureBars({ data, height = 240, colorKey = 'color', valueFmt = money }) {
  const fmtTick = makeAxisFmt(Math.max(...data.map(d => d.value ?? 0), 1));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 12, left: 2, bottom: 4 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={fmtTick} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={50} />
        <RTooltip content={<Tip valueFmt={valueFmt} />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Bar dataKey="value" name="Net revenue" radius={[4, 4, 0, 0]} maxBarSize={46}>
          {data.map((d, i) => <Cell key={i} fill={d[colorKey] ?? 'var(--series-1)'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Profit bridge (gross → net), a signed waterfall ────────────────────── */

export function Bridge({ data, height = 260 }) {
  const fmtTick = makeAxisFmt(Math.max(...data.map(d => Math.abs(d.value ?? 0)), 1));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 12, left: 2, bottom: 4 }}>
        <CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} tick={{ fontSize: 10.5 }} interval={0} />
        <YAxis tickFormatter={fmtTick} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={50} />
        <RTooltip content={<Tip />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]} maxBarSize={54}>
          {data.map((d, i) => <Cell key={i} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Sparkline for table rows ──────────────────────────────────────────── */

export function Spark({ data, tone = 'var(--series-1)', width = 92, height = 26 }) {
  if (!data?.length) return <span className="muted tiny">—</span>;
  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
        <Line type="monotone" dataKey="v" stroke={tone} strokeWidth={1.75} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── Company health gauge ──────────────────────────────────────────────── */

export function HealthGauge({ score, tone = 'good', size = 132 }) {
  // Ring and type scale with the diameter, so a smaller gauge stays legible.
  // At the default 132 these resolve to the original 10px / 33px / 11px.
  const stroke = Math.round(size * 0.0758);
  const scoreSize = Math.round(size * 0.27);
  const capSize = Math.max(9.5, Math.round(size * 0.0833));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const colorVar = `var(--${tone === 'good' ? 'good' : tone === 'warning' ? 'warning' : tone === 'serious' ? 'serious' : 'critical'})`;

  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="var(--surface-3)" strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={colorVar} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div className="gauge-mid">
        <div>
          <div className="gauge-score" style={{ fontSize: scoreSize }}>{score}</div>
          <div className="gauge-of" style={{ fontSize: capSize }}>out of 100</div>
        </div>
      </div>
    </div>
  );
}

/* ── True stepped waterfall ────────────────────────────────────────────────
   A transparent base bar carries each step up to where the previous one ended,
   so the visible bar floats — the sequence reads as one falling flow rather
   than a set of independent magnitudes.
   ──────────────────────────────────────────────────────────────────────── */

export function WaterfallChart({ steps, height = 250 }) {
  const top = Math.max(...steps.map(s => s.base + s.value), 1);
  const fmtTick = makeAxisFmt(top);

  const fillFor = (s) =>
    s.kind === 'total'
      ? (s.id === 'gmv' ? 'var(--ink-3)' : 'var(--accent)')
      : 'var(--series-2)';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={steps} margin={{ top: 20, right: 8, left: 2, bottom: 4 }} barCategoryGap="18%">
        <CartesianGrid strokeDasharray="0" vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }}
          tick={{ fontSize: 10 }} interval={0} angle={-22} textAnchor="end" height={62}
        />
        <YAxis tickFormatter={fmtTick} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={50} />
        <RTooltip
          cursor={{ fill: 'var(--surface-hover)' }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const s = payload[0]?.payload;
            if (!s) return null;
            return (
              <div className="tip">
                <div className="tip-h">{label}</div>
                <div className="tip-row">
                  <span className="k">{s.kind === 'cost' ? 'Deduction' : 'Total'}</span>
                  <span className="v">{s.kind === 'cost' ? '−' : ''}{money(Math.abs(s.amount))}</span>
                </div>
                {s.kind === 'cost' && (
                  <div className="tip-row">
                    <span className="k">Running</span>
                    <span className="v">{money(s.base)}</span>
                  </div>
                )}
              </div>
            );
          }}
        />
        {/* Invisible riser that lifts each bar to the running total. */}
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} maxBarSize={54}>
          {steps.map((s, i) => <Cell key={i} fill={fillFor(s)} />)}
          <LabelList
            dataKey="amount" position="top" offset={6}
            formatter={(v) => (v < 0 ? `−${money(Math.abs(v))}` : money(v))}
            style={{ fill: 'var(--ink-2)', fontSize: 10, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ── Watch chart — a metric either side of the day it was marked ────────── */

/**
 * One line, one vertical rule on the day the metric was marked, and an
 * optional rule at the target the meeting agreed to.
 *
 * The run-up is drawn in a muted tone and the aftermath in the series colour,
 * so the break is legible without a second axis or a second series — the point
 * of the chart is when the line changed, not what it is worth today.
 */
export function WatchChart({
  points, markLabel, target, valueFmt = money, height = 170, labelFmt,
}) {
  if (!points?.length) return null;

  // Two keys off one dataset: the shared point keeps the line unbroken.
  const data = points.map((p, i) => {
    const prevAfter = i > 0 && points[i - 1].after;
    return {
      date: p.date,
      // The first post-mark point is drawn on both lines so they join up.
      pre: !p.after || !prevAfter ? p.value : null,
      post: p.after || (i + 1 < points.length && points[i + 1].after) ? p.value : null,
    };
  });
  const markIndex = points.findIndex(p => p.after);
  const markAt = markIndex > 0 ? points[markIndex].date : null;

  const max = Math.max(...points.map(p => p.value), target ?? 0);
  const fmtAxis = valueFmt === money ? makeAxisFmt(max) : valueFmt;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 14, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey="date" tickFormatter={labelFmt} tickLine={false} axisLine={false}
          tick={{ fill: 'var(--ink-3)', fontSize: 10.5 }} minTickGap={22}
        />
        <YAxis
          tickFormatter={fmtAxis} tickLine={false} axisLine={false} width={44}
          tick={{ fill: 'var(--ink-3)', fontSize: 10.5 }}
        />
        <RTooltip content={<Tip valueFmt={valueFmt} labelFmt={labelFmt} />} />
        {target != null && (
          <ReferenceLine
            y={target} stroke="var(--ink-3)" strokeDasharray="4 4"
            label={{ value: `Target ${valueFmt(target)}`, position: 'insideTopRight', fill: 'var(--ink-3)', fontSize: 10 }}
          />
        )}
        {markAt && (
          <ReferenceLine
            x={markAt} stroke="var(--accent)" strokeWidth={1.5}
            label={{ value: markLabel ?? 'Marked', position: 'top', fill: 'var(--accent)', fontSize: 10, fontWeight: 600 }}
          />
        )}
        <Line
          dataKey="pre" name="Before" type="monotone" stroke="var(--ink-3)"
          strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls={false}
        />
        <Line
          dataKey="post" name="Since marked" type="monotone" stroke="var(--series-1)"
          strokeWidth={2.25} dot={{ r: 2 }} isAnimationActive={false} connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export { axisFmt };
