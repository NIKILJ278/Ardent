import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TODAY } from '../../lib/clock.js';
import { iso } from '../../lib/format.js';

/**
 * One calendar, a rail of ways to choose, and dates you can also type.
 *
 * Nothing changes until Apply, so a half-picked range never reaches the
 * dashboard. Days after today are disabled (there are no orders from the
 * future) and so are days before the first synced order.
 *
 * Rail:  presets and "Last N days" apply the moment they are chosen;
 *        "Since" takes one date and runs to today; "Between" takes two.
 */

const WEEKDAYS = ['Mon', 'Tu', 'Wed', 'Th', 'Fr', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parseIso = (s) => (s ? new Date(`${s}T00:00:00`) : null);
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const shown = (s) => (s ? parseIso(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** Typed text → ISO day, or null. Takes "Jan 6, 2024", "6 Jan 2024" and "2024-01-06". */
function parseTyped(text) {
  const t = text.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = parseIso(t);
    return Number.isNaN(d.getTime()) || iso(d) !== t ? null : t;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) || d.getFullYear() < 2000 ? null : iso(d);
}

function daysAgo(n) {
  const d = startOfDay(TODAY);
  d.setDate(d.getDate() - (n - 1));
  return iso(d);
}

const LAST_OPTIONS = [7, 30, 90];

function DateField({ value, onCommit, label }) {
  const [text, setText] = useState(shown(value));
  const commit = () => {
    const parsed = parseTyped(text);
    if (parsed) onCommit(parsed); else setText(shown(value));
  };
  return (
    <input
      className="input drp-input" value={text} aria-label={label} placeholder="Pick a date"
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
    />
  );
}

export function DatePanel({ presets, periodId, period, minDate, onPreset, onRange, onCancel }) {
  const today = iso(TODAY);
  const min = minDate ?? '2000-01-01';

  const [mode, setMode] = useState('between');
  const [start, setStart] = useState(iso(period.start));
  const [end, setEnd] = useState(iso(period.end));
  const [anchor, setAnchor] = useState(false); // a first click is waiting for its second
  const [hover, setHover] = useState(null);
  const [view, setView] = useState(() => {
    const d = parseIso(iso(period.end));
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const firstYear = parseIso(min).getFullYear();
  const years = [];
  for (let y = firstYear; y <= TODAY.getFullYear(); y++) years.push(y);

  const move = (delta) => setView(v => {
    const d = new Date(v.year, v.month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const canPrev = new Date(view.year, view.month, 1) > parseIso(min);
  const canNext = new Date(view.year, view.month + 1, 1) <= TODAY;

  // Monday-first grid; the neighbouring months' days are shown faintly.
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const lead = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(view.year, view.month, 1 - lead + i);
      return { day: iso(d), n: d.getDate(), outside: d.getMonth() !== view.month };
    });
  }, [view]);

  const pick = (day) => {
    if (mode === 'since') { setStart(day); setEnd(today); setAnchor(false); return; }
    if (!anchor) { setStart(day); setEnd(day); setAnchor(true); return; }
    const [a, b] = day < start ? [day, start] : [start, day];
    setStart(a); setEnd(b); setAnchor(false);
  };

  // While the second click is pending, preview the range under the pointer.
  const [lo, hi] = anchor && hover
    ? (hover < start ? [hover, start] : [start, hover])
    : [start, end];

  const commitStart = (v) => {
    setAnchor(false);
    if (mode === 'since') { setStart(v); setEnd(today); } else if (v > end) { setStart(v); setEnd(v); } else setStart(v);
    const d = parseIso(v); setView({ year: d.getFullYear(), month: d.getMonth() });
  };
  const commitEnd = (v) => {
    setAnchor(false);
    if (v < start) { setEnd(start); setStart(v); } else setEnd(v);
  };
  const clampOk = (v) => v >= min && v <= today;

  const choose = (m) => { setMode(m); setAnchor(false); if (m === 'since') setEnd(today); };
  const valid = start && end && clampOk(start) && clampOk(end);

  return (
    <div className="drp">
      <div className="drp-rail" role="tablist" aria-label="Ways to choose dates">
        {presets.map(p => (
          <button key={p.id} className={`drp-rail-item${periodId === p.id ? ' on' : ''}`} onClick={() => onPreset(p.id)}>
            {p.label}
          </button>
        ))}
        <div className="drp-rail-sep" />
        {LAST_OPTIONS.map(n => (
          <button key={n} className="drp-rail-item" onClick={() => onRange(daysAgo(n), today)}>Last {n} days</button>
        ))}
        <div className="drp-rail-sep" />
        <button className={`drp-rail-item${mode === 'since' ? ' on' : ''}`} onClick={() => choose('since')}>Since</button>
        <button className={`drp-rail-item${mode === 'between' || mode === 'custom' ? ' on' : ''}`} onClick={() => choose('between')}>Between</button>
      </div>

      <div className="drp-main">
        <div className="drp-head">
          <select className="drp-select" aria-label="Month" value={view.month}
            onChange={e => setView(v => ({ ...v, month: Number(e.target.value) }))}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <select className="drp-select" aria-label="Year" value={view.year}
            onChange={e => setView(v => ({ ...v, year: Number(e.target.value) }))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-icon btn-sm" disabled={!canPrev} onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={14} /></button>
          <button className="btn btn-ghost btn-icon btn-sm" disabled={!canNext} onClick={() => move(1)} aria-label="Next month"><ChevronRight size={14} /></button>
        </div>

        <div className="drp-grid" onMouseLeave={() => setHover(null)}>
          {WEEKDAYS.map(w => <span key={w} className="drp-dow">{w}</span>)}
          {cells.map(c => {
            const off = c.day > today || c.day < min;
            const inRange = c.day >= lo && c.day <= hi;
            const cls = [
              'drp-day',
              c.outside && 'outside',
              off && 'off',
              inRange && 'in',
              c.day === lo && 'edge',
              c.day === hi && 'edge',
              c.day === today && 'today',
              anchor && hover === c.day && 'hover',
            ].filter(Boolean).join(' ');
            return (
              <button key={c.day} className={cls} disabled={off} aria-pressed={c.day === lo || c.day === hi}
                aria-label={shown(c.day)} onClick={() => pick(c.day)} onMouseEnter={() => setHover(c.day)}>
                {c.n}
              </button>
            );
          })}
        </div>

        <div className="drp-foot">
          <span className="drp-and">{mode === 'since' ? 'Since' : 'Between'}</span>
          <DateField key={`s${start}`} value={start} label="Start date" onCommit={v => clampOk(v) && commitStart(v)} />
          {mode === 'since' ? (
            <span className="drp-and">to today</span>
          ) : (
            <>
              <span className="drp-and">and</span>
              <DateField key={`e${end}`} value={end} label="End date" onCommit={v => clampOk(v) && commitEnd(v)} />
            </>
          )}
        </div>
        <div className="drp-actions">
          <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!valid || anchor} onClick={() => onRange(start, end)}>Apply</button>
        </div>
      </div>
    </div>
  );
}
