import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/shell/Shell.jsx';
import DrilldownPanel from './components/drill/DrilldownPanel.jsx';
import { useSession } from './state/Session.jsx';
import {
  AuthScreen, CreateBrandScreen, OfflineScreen, SplashScreen,
} from './components/auth/AuthScreen.jsx';

import Overview from './pages/Overview.jsx';
import Sales from './pages/Sales.jsx';
import Ads from './pages/Ads.jsx';
import Goals from './pages/Goals.jsx';
import DataSources from './pages/DataSources.jsx';
import Reports from './pages/Reports.jsx';
import Catalogue from './pages/Catalogue.jsx';
import Watchlist from './pages/Watchlist.jsx';
import Settings from './pages/Settings.jsx';
import Gst from './pages/Gst.jsx';
import {
  People, Insights, Customers, Marketing, Help, Finance, Reconciliation, Inventory,
} from './pages/Simple.jsx';

/**
 * Nothing renders from data until the session says who you are and which brand
 * you are looking at — there is no demo view to fall back on.
 */
export default function App() {
  const { phase } = useSession();

  if (phase === 'checking') return <SplashScreen />;
  if (phase === 'signed-out') return <AuthScreen />;
  if (phase === 'offline') return <OfflineScreen />;
  if (phase === 'no-brand') return <CreateBrandScreen />;

  return (
    <Shell>
      <Routes>
        <Route path="/"               element={<Navigate to="/overview" replace />} />
        <Route path="/overview"       element={<Overview />} />
        <Route path="/sales"          element={<Sales />} />
        <Route path="/ads"            element={<Ads />} />
        <Route path="/finance"        element={<Finance />} />
        <Route path="/goals"          element={<Goals />} />
        <Route path="/watchlist"      element={<Watchlist />} />
        <Route path="/people"         element={<People />} />
        <Route path="/reconciliation" element={<Reconciliation />} />
        <Route path="/sources"        element={<DataSources />} />
        <Route path="/inventory"      element={<Inventory />} />
        <Route path="/gst"            element={<Gst />} />
        <Route path="/sku-master"     element={<Catalogue />} />
        <Route path="/reports"        element={<Reports />} />
        <Route path="/settings"       element={<Settings />} />
        <Route path="/help"           element={<Help />} />
        <Route path="/customers"      element={<Customers />} />
        <Route path="/marketing"      element={<Marketing />} />
        <Route path="/insights"       element={<Insights />} />
        <Route path="*"               element={<Navigate to="/overview" replace />} />
      </Routes>
      <DrilldownPanel />
    </Shell>
  );
}
