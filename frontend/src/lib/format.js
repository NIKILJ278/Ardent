import { now } from './clock.js';
// Indian business number formatting — lakhs / crores.

export function inr(n, { compact = true, decimals } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (!compact) return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(decimals ?? 2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(decimals ?? 1)} L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(decimals ?? 1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

/** Full rupees with Indian digit grouping — for tables and transaction rows. */
export function inrExact(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
}

export function num(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function pct(n, decimals = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

/** Signed delta, e.g. "+12.0%" / "−4.2%". */
export function delta(n, decimals = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${Math.abs(n).toFixed(decimals)}%`;
}

export function changePct(current, previous) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(d, style = 'short') {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const day = date.getDate();
  const mon = MONTHS[date.getMonth()];
  if (style === 'short') return `${day} ${mon}`;
  if (style === 'long') return `${day} ${mon} ${date.getFullYear()}`;
  if (style === 'month') return `${mon} ${date.getFullYear()}`;
  return `${day} ${mon}`;
}

export function relativeTime(d, at = now()) {
  const date = d instanceof Date ? d : new Date(d);
  const mins = Math.round((at - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return fmtDate(date, 'short');
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();

/**
 * A friendly name for a reporting period. Never guesses: a period that is not
 * exactly a calendar month, quarter or year is shown as an explicit range,
 * because a quarterly report labelled with a single month is worse than one
 * with an ugly label.
 */
export function periodLabel(period) {
  if (!period?.start || !period?.end) return '—';
  const s = period.start, e = period.end;
  const sy = s.getFullYear(), ey = e.getFullYear();
  const sm = s.getMonth(),    em = e.getMonth();
  const sd = s.getDate(),     ed = e.getDate();

  const startsMonth = sd === 1;
  const endsMonth = ed === lastDayOf(ey, em);

  if (sy === ey && sm === em && sd === ed) return `${sd} ${MONTHS_LONG[sm]} ${sy}`;
  if (sy === ey && sm === em && startsMonth && endsMonth) return `${MONTHS_LONG[sm]} ${sy}`;

  if (sy === ey && startsMonth && endsMonth) {
    // Whole calendar quarter?
    if (sm % 3 === 0 && em === sm + 2) return `Q${Math.floor(sm / 3) + 1} ${sy} · ${MONTHS[sm]}–${MONTHS[em]}`;
    if (sm === 0 && em === 11) return `${sy}`;
    return `${MONTHS[sm]}–${MONTHS[em]} ${sy}`;
  }
  // Anything else is spelled out in full.
  return periodRange(period);
}

/** The unambiguous range. Always safe to print on a filing document. */
export function periodRange(period) {
  if (!period?.start || !period?.end) return '—';
  const s = period.start, e = period.end;
  const sameYear = s.getFullYear() === e.getFullYear();
  const left = sameYear ? `${s.getDate()} ${MONTHS[s.getMonth()]}` : fmtDate(s, 'long');
  return `${left} – ${fmtDate(e, 'long')}`;
}

/** Inclusive day count, for "covers N days" captions. */
export function periodDays(period) {
  if (!period?.start || !period?.end) return 0;
  const a = new Date(period.start); a.setHours(0, 0, 0, 0);
  const b = new Date(period.end);   b.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/** Filename-safe range, e.g. 2026-09-01_2026-09-30. */
export function periodSlug(period) {
  if (!period?.start || !period?.end) return 'period';
  return `${iso(period.start)}_${iso(period.end)}`;
}

/** For balances and registers that describe a moment, not a span. */
export function asAt(date) {
  return `as at ${fmtDate(date, 'long')}`;
}

/** ISO yyyy-mm-dd for a Date, in local time. */
export function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
