import { now } from './clock.js';

/* Money is stated in the currency the connected store actually reports.
 *
 * Shopify converts every order into the shop's own currency at that order's
 * own rate, so the figures reaching us are already single-currency and exact.
 * This module only has to label and scale them — it never converts, because a
 * conversion would need exchange rates no connected source supplies.
 *
 * The active currency is module state rather than a prop. Every figure on
 * screen comes from one store, so threading a currency through a hundred call
 * sites would add ceremony without adding truth.
 */

let CURRENCY = 'INR';
let LOCALE = 'en-IN';
let SYMBOL = '₹';

/** Digit grouping differs by market: 12,34,567 in India, 1,234,567 elsewhere. */
const localeFor = (code) => (code === 'INR' ? 'en-IN' : 'en-US');

function symbolFor(code) {
  try {
    return new Intl.NumberFormat(localeFor(code), { style: 'currency', currency: code })
      .formatToParts(0).find(part => part.type === 'currency')?.value ?? code;
  } catch {
    // An unrecognised code is shown as itself rather than guessed at.
    return code;
  }
}

/**
 * Short scales, by convention rather than by arithmetic. A crore is not a
 * translation of ten million — an Indian reader expects "1.2 Cr" where an
 * American expects "12M", and showing the wrong one misreads at a glance.
 */
const INDIAN_STEPS  = [[1e7, 'Cr'], [1e5, 'L'], [1e3, 'k']];
const WESTERN_STEPS = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

const steps = () => (CURRENCY === 'INR' ? INDIAN_STEPS : WESTERN_STEPS);

/** Point every formatter at the store's currency. Called when facts load. */
export function setCurrency(code) {
  CURRENCY = code || 'INR';
  LOCALE = localeFor(CURRENCY);
  SYMBOL = symbolFor(CURRENCY);
}

export const currencyCode = () => CURRENCY;
export const currencySymbol = () => SYMBOL;

/** Compact money, e.g. ₹1.2 Cr or $1.2M. */
export function money(n, { compact = true, decimals } = {}) {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (!compact) return `${sign}${SYMBOL}${Math.round(abs).toLocaleString(LOCALE)}`;
  for (const [div, suffix] of steps()) {
    if (abs >= div) {
      const dp = decimals ?? (suffix === 'k' || suffix === 'K' ? 1 : suffix === 'L' ? 1 : 2);
      return `${sign}${SYMBOL}${(abs / div).toFixed(dp)}${suffix === 'Cr' || suffix === 'L' ? ' ' : ''}${suffix}`;
    }
  }
  return `${sign}${SYMBOL}${Math.round(abs)}`;
}

/** Whole units with local digit grouping — for tables and transaction rows. */
export function moneyExact(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}${SYMBOL}${Math.round(Math.abs(n)).toLocaleString(LOCALE)}`;
}

/** The scale suffix an axis should use for a given maximum. */
export function moneyScale(max) {
  const a = Math.abs(max || 0);
  for (const [div, suffix] of steps()) if (a >= div) return [div, suffix];
  return [1, ''];
}

export function num(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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

/**
 * Inclusive calendar-day count between two dates. Truncates to midnight
 * before diffing: a period's `start` is always midnight but its `end` carries
 * 23:59:59.999, so a raw millisecond diff comes out just under a full extra
 * day and rounds up — every caller that skipped this step was overcounting
 * by one day, silently (This Month 1–4 Oct read as 5 days, not 4; its
 * previous-period comparison pulled in an extra day for the same reason).
 */
export function daysInclusive(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start); a.setHours(0, 0, 0, 0);
  const b = new Date(end);   b.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/** Inclusive day count, for "covers N days" captions. */
export function periodDays(period) {
  if (!period?.start || !period?.end) return 0;
  return daysInclusive(period.start, period.end);
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
