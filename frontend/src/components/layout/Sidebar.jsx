import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, BarChart2, ShoppingBag, Globe, MessageSquare,
  FileText, Bell, Settings, LogOut, ChevronLeft, ChevronRight,
  TrendingUp, Users, Package, Map
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBrand } from '../../context/BrandContext';

const NAV = [
  { section: 'Overview' },
  { to: '/dashboard',         icon: LayoutDashboard, label: 'Dashboard' },
  { section: 'Analytics' },
  { to: '/analytics/channels',   icon: BarChart2,    label: 'Channels' },
  { to: '/analytics/waterfall',  icon: TrendingUp,   label: 'P&L Waterfall' },
  { to: '/analytics/skus',       icon: Package,      label: 'SKU Pareto' },
  { to: '/analytics/rto',        icon: Map,          label: 'RTO by State' },
  { to: '/analytics/campaigns',  icon: Globe,        label: 'Campaigns' },
  { to: '/analytics/customers',  icon: Users,        label: 'Customers' },
  { to: '/analytics/inventory',  icon: ShoppingBag,  label: 'Inventory' },
  { section: 'Integrations' },
  { to: '/connectors',           icon: Settings,     label: 'Connectors' },
  { section: 'Tools' },
  { to: '/ai',                   icon: MessageSquare, label: 'Ask Analyst' },
  { to: '/reports',              icon: FileText,      label: 'Reports' },
  { to: '/alerts',               icon: Bell,          label: 'Alerts' },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { logout } = useAuth();
  const { activeBrand } = useBrand();

  return (
    <nav className={`ardent-sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-brand">
        <LayoutDashboard size={20} />
        {!collapsed && <span>Ardent</span>}
        <button
          onClick={onToggle}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.6)', padding: 0 }}
          aria-label="Toggle sidebar"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {!collapsed && activeBrand && (
        <div style={{ padding: '0.5rem 1rem 0.75rem', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Active Brand</div>
          <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.875rem', marginTop: 2 }}>{activeBrand.name}</div>
        </div>
      )}

      <div style={{ flex: 1, paddingTop: '0.5rem' }}>
        {NAV.map((item, i) => {
          if (item.section) {
            return collapsed ? null : (
              <div key={i} className="nav-section-label">{item.section}</div>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <item.icon size={18} style={{ flexShrink: 0 }} />
              {!collapsed && <span className="sidebar-label">{item.label}</span>}
            </NavLink>
          );
        })}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,.1)', padding: '0.5rem' }}>
        <button
          onClick={logout}
          className="nav-link w-100"
          style={{ background: 'none', border: 'none', textAlign: 'left', color: 'var(--color-sidebar-text)' }}
        >
          <LogOut size={18} style={{ flexShrink: 0 }} />
          {!collapsed && <span className="sidebar-label">Logout</span>}
        </button>
      </div>
    </nav>
  );
}
