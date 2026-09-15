import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutGrid, TrendingUp, Wallet, Target, Users, FileText, Settings2,
  CircleHelp, Scale, Boxes, UserRound, Megaphone, Sparkles, Plug,
  PanelLeftClose, PanelLeft, Menu, Sun, Moon, Bell, ChevronDown, Check,
  Download, Calendar, Building2, Store, Barcode, Receipt, Eye,
} from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { COMPANIES, CHANNELS, CHANNEL_BY_ID, channelsFor } from '../../data/catalog.js';
import { PERIOD_PRESETS, COMPARISON_MODES, DATA_RANGE } from '../../data/engine.js';
import { QUICK_EXPORTS, buildExport, canExport } from '../../data/exports.js';
import { exportCsv, exportMeta } from '../../lib/csv.js';
import { COMPANY_BY_ID } from '../../data/catalog.js';
import { Popover } from '../ui/index.jsx';
import { ROLES, PERM } from '../../state/permissions.js';
import { fmtDate, iso, periodRange, num } from '../../lib/format.js';

const NAV = [
  { group: null, items: [{ to: '/overview', icon: LayoutGrid, label: 'Overview' }] },
  {
    group: 'Performance',
    items: [
      { to: '/sales',   icon: TrendingUp, label: 'Sales' },
      { to: '/ads',     icon: Megaphone,  label: 'Ads' },
      { to: '/finance', icon: Wallet,     label: 'Finance' },
      { to: '/goals',   icon: Target,     label: 'Goals & Targets' },
      { to: '/watchlist', icon: Eye,      label: 'Watchlist' },
      { to: '/people',  icon: Users,      label: 'People & HR' },
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
      { to: '/customers', icon: UserRound,  label: 'Customers',   soon: true },
      { to: '/insights',  icon: Sparkles,   label: 'AI Insights', soon: true },
    ],
  },
];

/* ── Sidebar ───────────────────────────────────────────────────────────── */

function Sidebar({ collapsed, onToggle }) {
  const { companyId, sidebarOpen, setSidebarOpen, can } = useApp();
  const company = COMPANIES.find(c => c.id === companyId);

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
          <div className="avatar" title={company?.ceo}>VS</div>
        ) : (
          <>
            <div className="nav-group-label" style={{ padding: '0 2px 6px' }}>Company</div>
            <div className="who">
              <span className="avatar">{(company?.name ?? 'AB').slice(0, 2).toUpperCase()}</span>
              <span className="who-meta">
                <span className="who-name">{company?.name ?? 'All Brands'}</span>
                <span className="who-role">{company?.ceo ?? 'Vismay Shah'} · CEO</span>
              </span>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

/* ── Company selector ──────────────────────────────────────────────────── */

function CompanySelector() {
  const { companyId, setCompanyId } = useApp();
  const label = companyId === 'all' ? 'All Brands' : COMPANIES.find(c => c.id === companyId)?.name;

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
          <div className="pop-label">My Companies</div>
          {COMPANIES.map(c => (
            <button key={c.id} className={`pop-item${companyId === c.id ? ' on' : ''}`} onClick={() => { setCompanyId(c.id); close(); }}>
              <span className="avatar" style={{ width: 22, height: 22, fontSize: 9.5 }}>{c.name.slice(0, 2).toUpperCase()}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 500 }}>{c.name}</span>
                <span className="tiny muted">{c.sector}</span>
              </span>
              {companyId === c.id && <Check size={14} />}
            </button>
          ))}
          <div className="pop-sep" />
          <button className={`pop-item${companyId === 'all' ? ' on' : ''}`} onClick={() => { setCompanyId('all'); close(); }}>
            <LayoutGrid size={15} />
            <span style={{ flex: 1 }}>All Brands<span className="tiny muted" style={{ display: 'block' }}>Group roll-up</span></span>
            {companyId === 'all' && <Check size={14} />}
          </button>
        </>
      )}
    </Popover>
  );
}

/* ── Channel filter ────────────────────────────────────────────────────── */

const SERIES_VARS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];

function ChannelSelector() {
  const { channelId, setChannelId, companyId } = useApp();
  // Only offer channels the selected company actually sells on.
  const available = CHANNELS.filter(c => channelsFor(companyId).includes(c.id));
  const active = channelId !== 'all';
  const current = CHANNEL_BY_ID[channelId];

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
          {active
            ? <span className="swatch" style={{ background: SERIES_VARS[current?.slot % 5] }} />
            : <Store size={14} />}
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
            <span style={{ flex: 1 }}>All channels<span className="tiny muted" style={{ display: 'block' }}>Company total</span></span>
            {channelId === 'all' && <Check size={14} />}
          </button>
          <div className="pop-sep" />
          {available.map(c => (
            <button key={c.id} className={`pop-item${channelId === c.id ? ' on' : ''}`} onClick={() => { setChannelId(c.id); close(); }}>
              <span className="swatch" style={{ background: SERIES_VARS[c.slot % 5], width: 10, height: 10 }} />
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

/** The window the date inputs may select from. */
const MIN_DATE = iso(DATA_RANGE.start);
const MAX_DATE = iso(DATA_RANGE.end);

function PeriodPicker() {
  const { periodId, setPeriodId, period, comparison, setComparison, customRange, setCustomRange } = useApp();
  const [draft, setDraft] = useState(customRange ?? { start: '', end: '' });
  const periodLabel = periodId === 'custom' && customRange
    ? `${fmtDate(period.start)} – ${fmtDate(period.end, 'long')}`
    : PERIOD_PRESETS.find(p => p.id === periodId)?.label ?? 'This Month';
  // A preset name alone does not say which dates it resolved to.
  const rangeText = `${fmtDate(period.start)} – ${fmtDate(period.end, 'long')}`;

  return (
    <div className="hstack" style={{ gap: 6 }}>
      <Popover
        width={250}
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
          <>
            <div className="pop-label">Period</div>
            {PERIOD_PRESETS.filter(p => p.id !== 'custom').map(p => (
              <button key={p.id} className={`pop-item${periodId === p.id ? ' on' : ''}`} onClick={() => { setPeriodId(p.id); close(); }}>
                <span style={{ flex: 1 }}>{p.label}</span>
                {periodId === p.id && <Check size={14} />}
              </button>
            ))}
            <div className="pop-sep" />
            <div style={{ padding: '4px 9px 8px' }}>
              <label className="label">Custom range</label>
              <div className="hstack" style={{ gap: 6 }}>
                {/* Bounded to the window the fact table covers, so a range
                    outside it cannot be picked and read as a collapse in the
                    business rather than as missing history. */}
                <input
                  type="date" className="input" value={draft.start}
                  min={MIN_DATE} max={draft.end || MAX_DATE}
                  onChange={e => setDraft(d => ({ ...d, start: e.target.value }))}
                />
                <input
                  type="date" className="input" value={draft.end}
                  min={draft.start || MIN_DATE} max={MAX_DATE}
                  onChange={e => setDraft(d => ({ ...d, end: e.target.value }))}
                />
              </div>
              <button
                className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 8 }}
                disabled={!draft.start || !draft.end}
                onClick={() => { setCustomRange(draft); setPeriodId('custom'); close(); }}
              >
                Apply range
              </button>
              <div className="tiny muted" style={{ marginTop: 7, lineHeight: 1.45 }}>
                Data available {fmtDate(DATA_RANGE.start, 'long')} to {fmtDate(DATA_RANGE.end, 'long')}
                {' '}({DATA_RANGE.days} days). Dates outside this are pulled back to the edge.
              </div>
            </div>
          </>
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
  const companyName = companyId === 'all' ? 'All brands' : (COMPANY_BY_ID[companyId]?.name ?? companyId);

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
          {/* The range is named before the list, because the file that lands on
              disk is fixed to it and cannot be re-cut afterwards. */}
          <div className="tiny muted" style={{ padding: '0 10px 7px', lineHeight: 1.45 }}>
            {companyName} · {fmtDate(period.start, 'long')} to {fmtDate(period.end, 'long')}
            {scope.channel ? ` · ${scope.channel}` : ''}
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
              : 'Exports respect the current brand, period and channel filter. Full catalogue on the Reports page.'}
          </div>
        </>
      )}
    </Popover>
  );
}

/* ── Notifications ─────────────────────────────────────────────────────── */

function Notifications() {
  const items = [
    { id: 1, tone: 'critical', title: '₹7.4 L settlement unmatched', body: 'Flipkart cycle 38 is short against expected.', when: '2 hours ago' },
    { id: 2, tone: 'warning',  title: 'Bank statement is 4 days stale', body: 'Upload the latest HDFC statement to refresh reconciliation.', when: 'Today' },
    { id: 3, tone: 'warning',  title: 'Goal at risk — September Revenue', body: 'Forecast ₹1.30 Cr against a ₹1.37 Cr target.', when: 'Yesterday' },
    { id: 4, tone: 'good',     title: 'Plant Protein crossed ₹5 L', body: 'Nutreats launch SKU is ramping ahead of plan.', when: '2 days ago' },
  ];
  return (
    <Popover
      align="right" width={318}
      trigger={({ toggle }) => (
        <button className="btn btn-icon" onClick={toggle} aria-label="Notifications" style={{ position: 'relative' }}>
          <Bell size={15} />
          <span style={{
            position: 'absolute', top: 5, right: 6, width: 6, height: 6,
            borderRadius: '50%', background: 'var(--critical)',
          }} />
        </button>
      )}
    >
      <>
        <div className="pop-label">Notifications</div>
        {items.map(n => (
          <div key={n.id} className="pop-item" style={{ alignItems: 'flex-start', cursor: 'default' }}>
            <span style={{ marginTop: 4 }}><span className={`dot ${n.tone}`} /></span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 600, fontSize: 12.5 }}>{n.title}</span>
              <span className="tiny muted" style={{ display: 'block', lineHeight: 1.4 }}>{n.body}</span>
              <span className="tiny muted" style={{ display: 'block', marginTop: 2, opacity: 0.75 }}>{n.when}</span>
            </span>
          </div>
        ))}
      </>
    </Popover>
  );
}

/* ── Topbar ────────────────────────────────────────────────────────────── */

function Topbar() {
  const { theme, setTheme, setSidebarOpen, companyId, roleId, setRoleId } = useApp();
  const company = COMPANIES.find(c => c.id === companyId);

  return (
    <header className="topbar">
      <button className="btn btn-ghost btn-icon d-lg-none" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">
        <Menu size={17} />
      </button>

      <CompanySelector />
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
          align="right" width={210}
          trigger={({ toggle }) => (
            <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label="Profile">
              <span className="avatar" style={{ width: 25, height: 25, fontSize: 10 }}>VS</span>
            </button>
          )}
        >
          <>
            <div style={{ padding: '7px 10px 9px' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{company?.ceo ?? 'Vismay Shah'}</div>
              <div className="tiny muted">{ROLES[roleId]?.title ?? 'Chief Executive Officer'}</div>
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
