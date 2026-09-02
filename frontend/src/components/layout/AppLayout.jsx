import { useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import Spinner from '../ui/Spinner';

export default function AppLayout() {
  const { user, loading } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size="lg" /></div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="ardent-layout">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(p => !p)} />
      <div className={`ardent-main${collapsed ? ' sidebar-collapsed' : ''}`}>
        <Topbar />
        <main className="ardent-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
