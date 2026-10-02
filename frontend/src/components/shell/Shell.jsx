import { useState, useMemo, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutGrid, TrendingUp, Wallet, Target, Users, FileText, Settings2,
  CircleHelp, Scale, Boxes, UserRound, Megaphone, Sparkles, Plug,
  PanelLeftClose, PanelLeft, Menu, Sun, Moon, Bell, ChevronDown, Check,
  Download, Calendar, Building2, Store, Barcode, Receipt, Eye, LogOut,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { useSession } from '../../state/Session.jsx';
import { CHANNELS, CHANNEL_BY_ID, COMPANY_BY_ID, channelsFor } from '../../data/catalog.js';
import { PERIOD_PRESETS, COMPARISON_MODES, DATA_RANGE } from '../../data/engine.js';
import { QUICK_EXPORTS, buildExport, canExport } from '../../data/exports.js';
import { live } from '../../data/live.js';
import { exportCsv, exportMeta } from '../../lib/csv.js';
import { channelColor } from '../../lib/channels.js';
import { Popover } from '../ui/index.jsx';
import { ROLES, PERM } from '../../state/permissions.js';
import { fmtDate, iso, periodRange, num, relativeTime } from '../../lib/format.js';

const NAV = [
  { group: null, items: [{ to: '/overview', icon: LayoutGrid, label: 'Overview' }] },
  {
    group: 'Performance',
    items: [
      { to: '/sales',     icon: TrendingUp, label: 'Sales' },
      { to: '/ads',       icon: Megaphone,  label: 'Ads' },
      { to: '/finance',   icon: Wallet,     label: 'Finance' },
      { to: '/goals',     icon: Target,     label: 'Goals & Targets' },
      { to: '/watchlist', icon: Eye,        label: 'Watchlist' },
      { to: '/people',    icon: Users,      label: 'People & HR' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/reconciliation', icon: Scale,    label: 'Reconciliation' },
      { to: '/inventory',      icon: Boxes,    label: 'Inventory' },
      { to: '/sku-master',     icon: Barcode,  label: 'SKU Master' },
      { to: '/sources',        icon: Plug,     label: 'Data Sources' },
      { to: '/gst',            icon: Receipt,  label: 'GST Reports', perm: PERM.COMPANY_FINANCIALS },
      { to: '/reports',        icon: FileText, label: 'Reports' },
    ],
  },
  {
    group: 'Coming soon',
    items: [
      { to: '/customers', icon: UserRound, label: 'Customers',   soon: true },
      { to: '/insights',  icon: Sparkles,  label: 'AI Insights', soon: true },
    ],
  },
];

const initials = (s) => (s || '?')
  .split(/[\s@._-]+/).filter(Boolean).slice(0, 2)
  .map(w => w[0].toUpperCase()).join('');

/* ── Sidebar ───────────────────────────────────────────────────────────── */

function Sidebar({ collapsed, onToggle }) {
  const { companyId, sidebarOpen, setSidebarOpen, can } = useApp();
  const { user } = useSession();
  const brand = COMPANY_BY_ID[companyId];
  const person = user?.full_name || user?.email || '';

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}${sidebarOpen ? ' mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark">A</span>
        {!collapsed && <span className="brand-word">ARDENT</span>}
        <button
          className="btn btn-ghost btn-icon btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      <div className="sidebar-nav">
        {NAV.map((section, si) => (
          <div key={si}>
            {section.group && !collapsed && <div className="nav-group-label">{section.group}</div>}
            {section.items.filter(i => !i.perm || can(i.perm)).map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={16} strokeWidth={1.9} />
                {!collapsed && <span>{item.label}</span>}
                {!collapsed && item.soon && <span className="soon">Soon</span>}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="pop-sep" style={{ margin: '10px 6px' }} />
        <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={collapsed ? 'Settings' : undefined}>
          <Settings2 size={16} strokeWidth={1.9} />{!collapsed && <span>Settings</span>}
        </NavLink>
        <NavLink to="/help" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} title={collapsed ? 'Help' : undefined}>
          <CircleHelp size={16} strokeWidth={1.9} />{!collapsed && <span>Help</span>}
        </NavLink>
      </div>

      <div className="sidebar-foot">
        {collapsed ? (
          <div className="avatar" title={person}>{initials(person)}</div>
        ) : (
          <>
            <div className="nav-group-label" style={{ padding: '0 2px 6px' }}>Brand</div>
            <div className="who">
              <span className="avatar">{initials(brand?.name)}</span>
              <span className="who-meta">
                <span className="who-name">{brand?.name ?? 'No brand'}</span>
                <span className="who-role">{person}</span>
              </span>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

/* ── Brand selector ────────────────────────────────────────────────────── */

function BrandSelector() {
  const { companyId } = useApp();
  const { brands, selectBrand } = useSession();
  const label = brands.find(b => b.id === companyId)?.name ?? 'Brand';

  return (
    <Popover
      width={252}
      trigger={({ toggle }) => (
        <button className="btn" onClick={toggle}>
          <Building2 size={14} />
          <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          <ChevronDown size={13} style={{ opacity: 0.6 }} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="pop-label">Your brands</div>
          {brands.map(b => (
            <button key={b.id} className={`pop-item${companyId === b.id ? ' on' : ''}`} onClick={() => { selectBrand(b.id); close(); }}>
              <span className="avatar" style={{ width: 22, height: 22, fontSize: 9.5 }}>{initials(b.name)}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 500 }}>{b.name}</span>
                <span className="tiny muted">{b.role}</span>
              </span>
              {companyId === b.id && <Check size={14} />}
            </button>
          ))}
          <div className="pop-sep" />
          <NavLink to="/settings" className="pop-item" onClick={close}>
            <Settings2 size={14} /> Manage brands
          </NavLink>
        </>
      )}
    </Popover>
  );
}

/* ── Channel filter ────────────────────────────────────────────────────── */

function ChannelSelector() {
  const { channelId, setChannelId, companyId } = useApp();
  // Only channels the brand's connected stores actually report.
  const available = CHANNELS.filter(c => channelsFor(companyId).includes(c.id));
  const active = channelId !== 'all';
  const current = CHANNEL_BY_ID[channelId];

  if (!available.length) {
    return (
      <button className="btn" disabled title="Channels appear once a store is connected and synced">
        <Store size={14} /><span>No channels yet</span>
      </button>
    );
  }

  return (
    <Popover
      width={236}
      trigger={({ toggle }) => (
        <button
          className="btn"
          onClick={toggle}
          title="Filter the dashboard to one sales channel"
          style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
        >
          {active ? <span className="swatch" style={{ background: channelColor(channelId) }} /> : <Store size={14} />}
          <span>{active ? current?.name : 'All channels'}</span>
          <ChevronDown size={13} style={{ opacity: 0.6 }} />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="pop-label">Sales channel</div>
          <button className={`pop-item${channelId === 'all' ? ' on' : ''}`} onClick={() => { setChannelId('all'); close(); }}>
            <Store size={15} />
            <span style={{ flex: 1 }}>All channels<span className="tiny muted" style={{ display: 'block' }}>Brand total</span></span>
            {channelId === 'all' && <Check size={14} />}
          </button>
          <div className="pop-sep" />
          {available.map(c => (
            <button key={c.id} className={`pop-item${channelId === c.id ? ' on' : ''}`} onClick={() => { setChannelId(c.id); close(); }}>
              <span className="swatch" style={{ background: channelColor(c.id), width: 10, height: 10 }} />
              <span style={{ flex: 1 }}>{c.name}<span className="tiny muted" style={{ display: 'block' }}>{c.kind}</span></span>
              {channelId === c.id && <Check size={14} />}
            </button>
          ))}
        </>
      )}
    </Popover>
  );
}

/* ── Period + comparison ───────────────────────────────────────────────── */

/* Small helpers for the calendar */
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function calDays(year, month) {
  // returns array of Date objects for every cell in a 6-row calendar grid
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay()); // rewind to Sunday
  const cells = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(start));
    start.setDate(start.getDate() + 1);
  }
  return cells;
}

function toYMD(d) {
  // "2026-10-02" from a Date object
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function CalendarMonth({ year, month, rangeStart, rangeEnd, hovered, onDay, onHover, minDate, maxDate }) {
  const cells = useMemo(() => calDays(year, month), [year, month]);
  return (
    <div className="dp-month">
      <div className="dp-grid dp-dow">
        {DAYS.map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="dp-grid dp-cells">
        {cells.map((d, i) => {
          const ymd = toYMD(d);
          const inMonth = d.getMonth() === month;
          const isStart = ymd === rangeStart;
          const isEnd = ymd === (rangeEnd || hovered);
          const effectiveEnd = rangeEnd || hovered;
          const lo = rangeStart && effectiveEnd ? (rangeStart < effectiveEnd ? rangeStart : effectiveEnd) : null;
          const hi = rangeStart && effectiveEnd ? (rangeStart < effectiveEnd ? effectiveEnd : rangeStart) : null;
          const inRange = lo && hi && ymd > lo && ymd < hi;
          const isRangeEdge = isStart || isEnd;
          const disabled = (minDate && ymd < minDate) || (maxDate && ymd > maxDate);
          const today = ymd === toYMD(new Date());

          return (
            <button
              key={i}
              className={[
                'dp-day',
                !inMonth && 'dp-out',
                isRangeEdge && 'dp-edge',
                inRange && 'dp-in-range',
                isStart && 'dp-start',
                isEnd && 'dp-end',
                today && !isRangeEdge && 'dp-today',
                disabled && 'dp-disabled',
              ].filter(Boolean).join(' ')}
              onClick={() => !disabled && onDay(ymd)}
              onMouseEnter={() => onHover(ymd)}
              disabled={disabled}
              tabIndex={inMonth ? 0 : -1}
              aria-label={d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              aria-pressed={isRangeEdge}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateRangePicker({ value, onChange, minDate, maxDate, onApply, onCancel, hint }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [hovered, setHovered] = useState(null);
  // picking: 'start' | 'end'
  const [picking, setPicking] = useState('start');
  const [local, setLocal] = useState(value ?? { start: '', end: '' });

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const handleDay = useCallback((ymd) => {
    if (picking === 'start' || (local.start && local.end)) {
      setLocal({ start: ymd, end: '' });
      setPicking('end');
    } else {
      // picking end
      const lo = ymd < local.start ? ymd : local.start;
      const hi = ymd < local.start ? local.start : ymd;
      setLocal({ start: lo, end: hi });
      setPicking('start');
    }
  }, [picking, local]);

  const next = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;

  const canApply = local.start && local.end;

  return (
    <div className="dp-root">
      {/* header */}
      <div className="dp-header">
        <button className="dp-nav" onClick={prevMonth} aria-label="Previous month">
          <ChevronLeft size={15} />
        </button>
        <span className="dp-month-label">{MONTHS[viewMonth]} {viewYear}</span>
        <span className="dp-month-sep">–</span>
        <span className="dp-month-label">{MONTHS[next]} {nextY}</span>
        <button className="dp-nav" onClick={nextMonth} aria-label="Next month">
          <ChevronRight size={15} />
        </button>
      </div>

      {/* two months side by side */}
      <div className="dp-panels">
        <CalendarMonth
          year={viewYear} month={viewMonth}
          rangeStart={local.start} rangeEnd={local.end}
          hovered={hovered}
          onDay={handleDay} onHover={setHovered}
          minDate={minDate} maxDate={maxDate}
        />
        <div className="dp-divider" />
        <CalendarMonth
          year={nextY} month={next}
          rangeStart={local.start} rangeEnd={local.end}
          hovered={hovered}
          onDay={handleDay} onHover={setHovered}
          minDate={minDate} maxDate={maxDate}
        />
      </div>

      {/* selected range pill */}
      <div className="dp-selection">
        <span className={`dp-sel-chip${picking === 'start' ? ' dp-sel-active' : ''}`}>
          <Calendar size={11} />
          {local.start ? local.start : <span className="dp-placeholder">Start date</span>}
        </span>
        <span className="dp-sel-arrow">→</span>
        <span className={`dp-sel-chip${picking === 'end' ? ' dp-sel-active' : ''}`}>
          <Calendar size={11} />
          {local.end ? local.end : <span className="dp-placeholder">End date</span>}
        </span>
      </div>

      {/* actions */}
      <div className="dp-actions">
        <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-primary btn-sm"
          disabled={!canApply}
          onClick={() => canApply && onApply(local)}
        >
          Apply range
        </button>
      </div>

      {hint && <div className="dp-hint">{hint}</div>}
    </div>
  );
}

function PeriodPicker() {
  const { periodId, setPeriodId, period, comparison, setComparison, customRange, setCustomRange } = useApp();
  const [showCal, setShowCal] = useState(false);
  const periodLabel = periodId === 'custom' && customRange
    ? `${fmtDate(period.start)} – ${fmtDate(period.end, 'long')}`
    : PERIOD_PRESETS.find(p => p.id === periodId)?.label ?? 'This Month';
  const rangeText = `${fmtDate(period.start)} – ${fmtDate(period.end, 'long')}`;

  const minDate = DATA_RANGE.start ? iso(DATA_RANGE.start) : undefined;
  const maxDate = DATA_RANGE.end ? iso(DATA_RANGE.end) : undefined;
  const first = live.meta.range?.first;

  return (
    <div className="hstack" style={{ gap: 6 }}>
      <Popover
        width={showCal ? 560 : 240}
        trigger={({ toggle }) => (
          <button className="btn" onClick={toggle}>
            <Calendar size={14} />
            <span className="period-btn">
              <span>{periodLabel}</span>
              {periodId !== 'custom' && <span className="tiny muted period-range">{rangeText}</span>}
            </span>
            <ChevronDown size={13} style={{ opacity: 0.6 }} />
          </button>
        )}
      >
        {({ close }) => (
          showCal ? (
            <DateRangePicker
              value={customRange}
              minDate={minDate}
              maxDate={maxDate}
              hint={first
                ? `Data available from ${fmtDate(`${first}T00:00:00`, 'long')} to today.`
                : 'No orders synced yet.'}
              onApply={(range) => { setCustomRange(range); setPeriodId('custom'); setShowCal(false); close(); }}
              onCancel={() => setShowCal(false)}
            />
          ) : (
            <>
              <div className="pop-label">Period</div>
              {PERIOD_PRESETS.filter(p => p.id !== 'custom').map(p => (
                <button key={p.id} className={`pop-item${periodId === p.id ? ' on' : ''}`} onClick={() => { setPeriodId(p.id); close(); }}>
                  <span style={{ flex: 1 }}>{p.label}</span>
                  {periodId === p.id && <Check size={14} />}
                </button>
              ))}
              <div className="pop-sep" />
              <button className="pop-item" onClick={() => setShowCal(true)}>
                <Calendar size={14} style={{ color: 'var(--ink-3)' }} />
                <span style={{ flex: 1 }}>Custom range…</span>
                {periodId === 'custom' && customRange && <Check size={14} />}
              </button>
            </>
          )
        )}
      </Popover>

      <Popover
        width={220}
        trigger={({ toggle }) => (
          <button className="btn" onClick={toggle} title="Comparison basis">
            <span className="muted" style={{ fontSize: 12 }}>vs</span>
            <span>{COMPARISON_MODES.find(m => m.id === comparison)?.label}</span>
            <ChevronDown size={13} style={{ opacity: 0.6 }} />
          </button>
        )}
      >
        {({ close }) => (
          <>
            <div className="pop-label">Compare against</div>
            {COMPARISON_MODES.map(m => (
              <button key={m.id} className={`pop-item${comparison === m.id ? ' on' : ''}`} onClick={() => { setComparison(m.id); close(); }}>
                <span style={{ flex: 1 }}>{m.label}</span>
                {comparison === m.id && <Check size={14} />}
              </button>
            ))}
          </>
        )}
      </Popover>
    </div>
  );
}

/* ── Export ────────────────────────────────────────────────────────────── */

export function ExportMenu({ compact = false }) {
  const { scope, period, companyId, can, goals } = useApp();
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(null);

  const ctx = { scope, period, can, goals, companyId };
  const companyName = COMPANY_BY_ID[companyId]?.name ?? 'Brand';

  const run = (id, label, close) => {
    setBusy(id);
    try {
      const built = buildExport(id, ctx);
      if (!built || built.rows.length === 0) {
        setDone(`No rows for ${periodRange(period)}`);
        return;
      }
      exportCsv({
        name: built.name,
        headers: built.headers,
        rows: built.rows,
        company: companyName,
        period,
        meta: exportMeta({
          title: built.name,
          company: companyName,
          period,
          channel: scope.channel ?? 'All channels',
          extra: { Rows: built.rows.length },
        }),
      });
      setDone(`${label} — ${num(built.rows.length)} rows`);
      close();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover
      align="right" width={288}
      trigger={({ toggle }) => (
        <button className={compact ? 'btn btn-icon' : 'btn'} onClick={toggle} title="Export">
          <Download size={14} />{!compact && <span>Export</span>}
        </button>
      )}
    >
      {({ close }) => (
        <>
          <div className="pop-label">Export data</div>
          <div className="tiny muted" style={{ padding: '0 10px 7px', lineHeight: 1.45 }}>
            {companyName} · {fmtDate(period.start, 'long')} to {fmtDate(period.end, 'long')}
            {scope.channel ? ` · ${CHANNEL_BY_ID[scope.channel]?.name ?? scope.channel}` : ''}
          </div>
          {QUICK_EXPORTS.filter(x => canExport(x.id, can)).map(x => (
            <button
              key={x.id} className="pop-item" disabled={busy === x.id}
              onClick={() => run(x.id, x.label, close)}
            >
              <span style={{ flex: 1 }}>{x.label}</span>
              <span className="tiny muted">{busy === x.id ? '…' : 'CSV'}</span>
            </button>
          ))}
          <div className="pop-sep" />
          <div style={{ padding: '2px 10px 8px' }} className="tiny muted">
            {done
              ? `Downloaded: ${done}`
              : 'Exports respect the current brand, period and channel filter.'}
          </div>
        </>
      )}
    </Popover>
  );
}

/* ── Notifications ─────────────────────────────────────────────────────── */

const DAY_MS = 24 * 3600 * 1000;

/** Only things that are true of the connected sources right now. */
function sourceAlerts() {
  const out = [];
  for (const c of live.meta.connections) {
    const name = c.platform === 'shopify' ? `Shopify · ${c.display_name || c.external_account_id}` : c.platform;
    if (c.status === 'error') {
      out.push({ id: `${c.id}-err`, tone: 'critical', title: `${name} sync failed`, body: c.last_error || 'Reconnect the store to resume syncing.' });
    } else if (!c.last_synced_at) {
      out.push({ id: `${c.id}-never`, tone: 'warning', title: `${name} has not synced yet`, body: 'Run the first sync from Data Sources.' });
    } else if (Date.now() - new Date(c.last_synced_at).getTime() > DAY_MS) {
      out.push({ id: `${c.id}-stale`, tone: 'warning', title: `${name} last synced ${relativeTime(c.last_synced_at)}`, body: 'Run a sync to bring figures up to date.' });
    }
  }
  if (live.status === 'ready' && !live.meta.connections.length) {
    out.push({ id: 'none', tone: 'info', title: 'No store connected', body: 'Connect Shopify on Data Sources to populate the dashboard.' });
  }
  if (live.status === 'error') {
    out.push({ id: 'load', tone: 'critical', title: 'Could not load your data', body: live.error });
  }
  return out;
}

function Notifications() {
  const { dataVersion } = useApp();
  const items = useMemo(() => sourceAlerts(), [dataVersion]);

  return (
    <Popover
      align="right" width={318}
      trigger={({ toggle }) => (
        <button className="btn btn-icon" onClick={toggle} aria-label="Notifications" style={{ position: 'relative' }}>
          <Bell size={15} />
          {items.length > 0 && (
            <span style={{
              position: 'absolute', top: 5, right: 6, width: 6, height: 6,
              borderRadius: '50%', background: 'var(--critical)',
            }} />
          )}
        </button>
      )}
    >
      <>
        <div className="pop-label">Notifications</div>
        {items.length === 0 ? (
          <div className="pop-item tiny muted" style={{ cursor: 'default' }}>Nothing needs attention.</div>
        ) : items.map(n => (
          <NavLink key={n.id} to="/sources" className="pop-item" style={{ alignItems: 'flex-start' }}>
            <span style={{ marginTop: 4 }}><span className={`dot ${n.tone}`} /></span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5 }}>{n.title}</span>
              <span className="tiny muted" style={{ display: 'block', lineHeight: 1.4 }}>{n.body}</span>
            </span>
          </NavLink>
        ))}
      </>
    </Popover>
  );
}

/* ── Topbar ────────────────────────────────────────────────────────────── */

function Topbar() {
  const { theme, setTheme, setSidebarOpen, roleId, setRoleId } = useApp();
  const { user, signOut } = useSession();
  const person = user?.full_name || user?.email || '';

  return (
    <header className="topbar">
      <button className="btn btn-ghost btn-icon d-lg-none" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">
        <Menu size={17} />
      </button>

      <BrandSelector />
      <ChannelSelector />

      <div className="topbar-spacer" />

      <div className="hstack" style={{ gap: 6 }}>
        <span className="d-none d-xl-flex"><PeriodPicker /></span>
        <ExportMenu />
        <Notifications />
        <button
          className="btn btn-icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme" title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <Popover
          align="right" width={220}
          trigger={({ toggle }) => (
            <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label="Profile">
              <span className="avatar" style={{ width: 25, height: 25, fontSize: 10 }}>{initials(person)}</span>
            </button>
          )}
        >
          <>
            <div style={{ padding: '7px 10px 9px' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.full_name || 'Signed in'}</div>
              <div className="tiny muted">{user?.email}</div>
            </div>
            <div className="pop-sep" />
            <div className="pop-label">Viewing as</div>
            {Object.values(ROLES).map(r => (
              <button
                key={r.id}
                className={`pop-item${roleId === r.id ? ' on' : ''}`}
                onClick={() => setRoleId(r.id)}
                title={r.blurb}
              >
                <span style={{ flex: 1 }}>
                  {r.label}
                  <span className="tiny muted" style={{ display: 'block' }}>{r.title}</span>
                </span>
                {roleId === r.id && <Check size={14} />}
              </button>
            ))}
            <div className="pop-sep" />
            <NavLink to="/settings" className="pop-item"><Settings2 size={14} /> Settings</NavLink>
            <NavLink to="/help" className="pop-item"><CircleHelp size={14} /> Help & support</NavLink>
            <button className="pop-item" onClick={signOut}><LogOut size={14} /> Sign out</button>
          </>
        </Popover>
      </div>
    </header>
  );
}

/* ── Shell ─────────────────────────────────────────────────────────────── */

export default function Shell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const { sidebarOpen, setSidebarOpen } = useApp();
  const { pathname } = useLocation();

  return (
    <div className="app">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      {sidebarOpen && (
        <div className="scrim d-lg-none" style={{ zIndex: 55 }} onClick={() => setSidebarOpen(false)} />
      )}
      <div className={`main${collapsed ? ' collapsed' : ''}`}>
        <Topbar />
        <main className="content" key={pathname}>{children}</main>
      </div>
    </div>
  );
}

export { PeriodPicker };
