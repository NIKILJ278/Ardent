import { Routes, Route, Navigate } from 'react-router-dom';

import AppLayout from './components/layout/AppLayout';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Dashboard from './pages/dashboard/Dashboard';
import ChannelProfitability from './pages/analytics/ChannelProfitability';
import Waterfall from './pages/analytics/Waterfall';
import SkuPareto from './pages/analytics/SkuPareto';
import RtoByState from './pages/analytics/RtoByState';
import Campaigns from './pages/analytics/Campaigns';
import Customers from './pages/analytics/Customers';
import Inventory from './pages/analytics/Inventory';
import Connectors from './pages/connectors/Connectors';
import AskAnalyst from './pages/ai/AskAnalyst';
import Reports from './pages/reports/Reports';
import Alerts from './pages/alerts/Alerts';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/analytics/channels" element={<ChannelProfitability />} />
        <Route path="/analytics/waterfall" element={<Waterfall />} />
        <Route path="/analytics/skus" element={<SkuPareto />} />
        <Route path="/analytics/rto" element={<RtoByState />} />
        <Route path="/analytics/campaigns" element={<Campaigns />} />
        <Route path="/analytics/customers" element={<Customers />} />
        <Route path="/analytics/inventory" element={<Inventory />} />
        <Route path="/connectors" element={<Connectors />} />
        <Route path="/ai" element={<AskAnalyst />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/alerts" element={<Alerts />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
