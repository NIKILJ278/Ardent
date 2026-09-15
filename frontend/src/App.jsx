import { Routes, Route, Navigate } from 'react-router-dom';
import Shell from './components/shell/Shell.jsx';
import DrilldownPanel from './components/drill/DrilldownPanel.jsx';

import Overview from './pages/Overview.jsx';
import Sales from './pages/Sales.jsx';
import Ads from './pages/Ads.jsx';
import Finance from './pages/Finance.jsx';
import Goals from './pages/Goals.jsx';
import Reconciliation from './pages/Reconciliation.jsx';
import DataSources from './pages/DataSources.jsx';
import Reports from './pages/Reports.jsx';
import SkuMaster from './pages/SkuMaster.jsx';
import Gst from './pages/Gst.jsx';
import Inventory from './pages/Inventory.jsx';
import Watchlist from './pages/Watchlist.jsx';
import Settings from './pages/Settings.jsx';
import {
  People, Insights, Customers, Marketing, Help,
} from './pages/Simple.jsx';

export default function App() {
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
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/gst" element={<Gst />} />
        <Route path="/sku-master" element={<SkuMaster />} />
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
