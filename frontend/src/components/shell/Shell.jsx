import { useState, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutGrid, TrendingUp, Wallet, Target, Users, FileText, Settings2,
  CircleHelp, Scale, Boxes, UserRound, Megaphone, Sparkles, Plug,
  PanelLeftClose, PanelLeft, Menu, Sun, Moon, Bell, ChevronDown, Check,
  Download, Calendar, Building2, Store, Barcode, Receipt, Eye, LogOut,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { useSession } from '../../state/Session.jsx';
import { CHANNELS, CHANNEL_BY_ID, COMPANY_BY_ID, channelsFor } from '../../data/catalog.js';
import { PERIOD_PRESETS, COMPARISON_MODES, DATA_RANGE, comparisonExplainer } from '../../data/engine.js';
import { QUICK_EXPORTS, buildExport, canExport } from '../../data/exports.js';
import { live } from '../../data/live.js';
import { exportCsv, exportMeta } from '../../lib/csv.js';
import { channelColor } from '../../lib/channels.js';
import { Popover } from '../ui/index.jsx';
import { DatePanel } from './DateRangePicker.jsx';
import { ROLES, PERM } from '../../state/permissions.js';
import { fmtDate, iso, periodRange, num, relativeTime, daysInclusive } from '../../lib/format.js';

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

function PeriodPicker() {
  const { periodId, setPeriodId, period, comparison, setComparison, customRange, setCustomRange } = useApp();
  const periodLabel = periodId === 'custom' && customRange
    ? `${fmtDate(period.start)} – ${fmtDate(period.end, 'long')}`
    : PERIOD_PRESETS.find(p => p.id === periodId)?.label ?? 'This Month';
  // A preset name alone does not say which dates it resolved to.
  const rangeText = `${fmtDate(period.start)} – ${fmtDate(period.end, 'long')}`;

  // Bounded to what the synced orders cover, read at render so it follows syncs.
  const minDate = DATA_RANGE.start ? iso(DATA_RANGE.start) : undefined;

  // "Previous Year" on 4 days of October reads as "all of last October" —
  // spelled out and flagged so a dramatic swing isn't read as more than it is.
  const compareInfo = comparisonExplainer(period, comparison, periodId);

  return (
    <div className="hstack" style={{ gap: 6 }}>
      <Popover
        width={452}
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
          <DatePanel
            presets={PERIOD_PRESETS.filter(p => p.id !== 'custom')}
            periodId={periodId} period={period} minDate={minDate}
            onPreset={(id) => { setPeriodId(id); close(); }}
            onRange={(start, end) => { setCustomRange({ start, end }); setPeriodId('custom'); close(); }}
            onCancel={close}
          />
        )}
      </Popover>

      <Popover
        width={260}
        trigger={({ toggle }) => (
          <button className="btn" onClick={toggle} title="Comparison basis">
            {compareInfo.partial
              ? <AlertTriangle size={13} style={{ color: 'var(--warning-ink)' }} />
              : <span className="muted" style={{ fontSize: 12 }}>vs</span>}
            <span>{compareInfo.label}</span>
            <ChevronDown size={13} style={{ opacity: 0.6 }} />
          </button>
        )}
      >
        {({ close }) => (
          <>
            <div className="pop-label">Compare against</div>
            {COMPARISON_MODES.map(m => {
              // Each option's own explicit label, not just the active one's —
              // "Previous Year" needs the same caveat before it is picked.
              const info = comparisonExplainer(period, m.id, periodId);
              return (
                <button key={m.id} className={`pop-item${comparison === m.id ? ' on' : ''}`} onClick={() => { setComparison(m.id); close(); }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block' }}>{info.label}</span>
                    {info.detail && <span className="tiny muted" style={{ display: 'block' }}>{info.detail}</span>}
                  </span>
                  {comparison === m.id && <Check size={14} />}
                </button>
              );
            })}
            {compareInfo.partial && (
              <div className="tiny" style={{
                display: 'flex', gap: 7, alignItems: 'flex-start', margin: '6px 2px 2px',
                padding: '8px 9px', borderRadius: 'var(--radius-sm)',
                background: 'var(--warning-soft)', color: 'var(--warning-ink)',
              }}>
                <AlertTriangle size={13} style={{ flex: 'none', marginTop: 1 }} />
                <span>
                  {periodLabel} is only {daysInclusive(period.start, period.end)} day{daysInclusive(period.start, period.end) === 1 ? '' : 's'} into
                  the month — this compares against the same {daysInclusive(period.start, period.end)} days, not the full month.
                </span>
              </div>
            )}
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
