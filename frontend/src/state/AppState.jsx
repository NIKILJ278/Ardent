import {
  createContext, useContext, useState, useEffect, useMemo, useCallback, useSyncExternalStore,
} from 'react';
import { resolvePeriod, comparisonWindow, TODAY, COMPARISON_MODES } from '../data/engine.js';
import { DEFAULT_HEALTH_CONFIG, normaliseConfig } from '../data/health.js';
import { newWatch } from '../data/watchlist.js';
import { channelsFor } from '../data/catalog.js';
import { live, subscribe } from '../data/live.js';
import { makeCan, DEFAULT_ROLE } from './permissions.js';
import { useSession } from './Session.jsx';
import { iso } from '../lib/format.js';

const Ctx = createContext(null);

/**
 * Browser-side preferences and the things you write down: goals, events,
 * notes and watches.
 *
 * Version 1 of this key held seeded demo rows tied to invented brands. They
 * are discarded rather than migrated — anything in them pointed at products
 * and brands that never existed.
 */
const KEY = 'ardent.state.v2';
const LEGACY_KEYS = ['ardent.state.v1'];

// Default layout for each dashboard — ordered array of widget IDs that are visible.
export const DEFAULT_DASHBOARD_LAYOUTS = {
  overview: [
    'status_banner',
    'revenue_ladder',
    'product_intelligence',
    'market_mix',
    'gmv_trend',
    'financial_position',
    'company_health',
    'goals_timeline',
    'data_sources',
  ],
  sales:    ['summary', 'by_channel', 'by_product', 'by_category', 'returns'],
  ads:      ['summary', 'by_platform', 'roas_trend', 'spend_vs_revenue'],
};

function load() {
  try {
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

const validComparison = (id) => (COMPARISON_MODES.some(m => m.id === id) ? id : 'previous');

export function AppStateProvider({ children }) {
  const saved = useMemo(load, []);
  const { brandId, selectBrand, user } = useSession();

  // Every figure re-derives when the live store changes. The version is folded
  // into each scope object, so every memo keyed on a scope recomputes with it.
  const dataVersion = useSyncExternalStore(subscribe, () => live.version, () => live.version);

  const [theme, setTheme]             = useState(saved.theme ?? 'light');
  const [periodId, setPeriodId]       = useState(saved.periodId ?? 'month');
  const [customRange, setCustomRange] = useState(saved.customRange ?? null);
  const [comparison, setComparisonRaw] = useState(() => validComparison(saved.comparison));
  const [channelId, setChannelId]     = useState(saved.channelId ?? 'all');
  const [roleId, setRoleId]           = useState(saved.roleId ?? DEFAULT_ROLE);
  const [healthConfig, setHealthConfig] = useState(
    () => normaliseConfig(saved.healthConfig ?? DEFAULT_HEALTH_CONFIG)
  );
  const [goals, setGoals]     = useState(saved.goals ?? []);
  const [events, setEvents]   = useState(saved.events ?? []);
  const [notes, setNotes]     = useState(saved.notes ?? []);
  const [watches, setWatches] = useState(saved.watches ?? []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dashboardLayout, setDashboardLayout] = useState(
    () => saved.dashboardLayout ?? DEFAULT_DASHBOARD_LAYOUTS
  );

  const setComparison = useCallback((id) => setComparisonRaw(validComparison(id)), []);

  // The active brand is the session's; switching brand is a session action.
  const companyId = brandId ?? 'none';
  const author = user?.full_name || user?.email || 'You';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Drop a channel filter the brand does not sell on — but only once its data
  // has loaded, or a saved filter would be cleared before the channels arrive.
  useEffect(() => {
    if (live.status !== 'ready') return;
    if (channelId !== 'all' && !channelsFor(companyId).includes(channelId)) {
      setChannelId('all');
    }
  }, [companyId, channelId, dataVersion]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        theme, channelId, roleId, periodId, customRange, comparison, healthConfig,
        goals, events, notes, watches, dashboardLayout,
      }));
    } catch { /* storage may be unavailable — the app still works */ }
  }, [theme, channelId, roleId, periodId, customRange, comparison, healthConfig, goals, events, notes, watches, dashboardLayout]);

  // Toggle a single widget on/off in a dashboard layout.
  const toggleWidget = useCallback((dashboard, widgetId) => {
    setDashboardLayout(prev => {
      const current = prev[dashboard] ?? DEFAULT_DASHBOARD_LAYOUTS[dashboard] ?? [];
      const next = current.includes(widgetId)
        ? current.filter(id => id !== widgetId)
        : [...current, widgetId];
      return { ...prev, [dashboard]: next };
    });
  }, []);

  // Move a widget up or down within a dashboard.
  const moveWidget = useCallback((dashboard, widgetId, direction) => {
    setDashboardLayout(prev => {
      const current = [...(prev[dashboard] ?? DEFAULT_DASHBOARD_LAYOUTS[dashboard] ?? [])];
      const idx = current.indexOf(widgetId);
      if (idx === -1) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= current.length) return prev;
      [current[idx], current[swapIdx]] = [current[swapIdx], current[idx]];
      return { ...prev, [dashboard]: current };
    });
  }, []);

  // Reset a dashboard back to its default layout.
  const resetLayout = useCallback((dashboard) => {
    setDashboardLayout(prev => ({ ...prev, [dashboard]: DEFAULT_DASHBOARD_LAYOUTS[dashboard] }));
  }, []);

  // One permission gate, shared by every component that renders a metric.
  const can = useMemo(() => makeCan(roleId), [roleId]);

  const period = useMemo(() => resolvePeriod(periodId, customRange), [periodId, customRange]);
  const compareWindow = useMemo(() => comparisonWindow(period, comparison), [period, comparison]);

  // `channelId` of 'all' means no channel filter — the key is left off the
  // scope entirely so `query()` does not have to special-case it.
  const channel = channelId === 'all' ? undefined : channelId;

  const scope = useMemo(
    () => ({ start: period.start, end: period.end, company: companyId, channel, v: dataVersion }),
    [period, companyId, channel, dataVersion]
  );
  const prevScope = useMemo(
    () => ({ start: compareWindow.start, end: compareWindow.end, company: companyId, channel, v: dataVersion }),
    [compareWindow, companyId, channel, dataVersion]
  );
  // Channel-free scopes, for figures that describe the whole brand.
  const companyScope = useMemo(
    () => ({ start: period.start, end: period.end, company: companyId, v: dataVersion }),
    [period, companyId, dataVersion]
  );
  const prevCompanyScope = useMemo(
    () => ({ start: compareWindow.start, end: compareWindow.end, company: companyId, v: dataVersion }),
    [compareWindow, companyId, dataVersion]
  );

  const addGoal = useCallback((g) => {
    setGoals(prev => [...prev, { ...g, id: `g${Date.now()}` }]);
  }, []);
  const updateGoal = useCallback((id, patch) => {
    setGoals(prev => prev.map(g => (g.id === id ? { ...g, ...patch } : g)));
  }, []);
  const removeGoal = useCallback((id) => {
    setGoals(prev => prev.filter(g => g.id !== id));
  }, []);

  const addEvent = useCallback((e) => {
    setEvents(prev => [...prev, { source: 'manual', author, ...e, id: `e${Date.now()}` }]);
  }, [author]);
  const addNote = useCallback((n) => {
    setNotes(prev => [...prev, { source: 'manual', ...n, id: `n${Date.now()}`, kind: 'note', author }]);
  }, [author]);
  const removeNote = useCallback((id) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);
  const removeEvent = useCallback((id) => {
    setEvents(prev => prev.filter(e => e.id !== id));
  }, []);

  // Watchlist: a metric put under observation after a meeting, plus the
  // discussion and decision that go with it.
  const addWatch = useCallback((w) => {
    const row = newWatch({ author, ...w, id: `w${Date.now()}` });
    setWatches(prev => [row, ...prev]);
    return row;
  }, [author]);
  const updateWatch = useCallback((id, patch) => {
    setWatches(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)));
  }, []);
  const addWatchUpdate = useCallback((id, text) => {
    const date = iso(TODAY);
    setWatches(prev => prev.map(w => (
      w.id === id ? { ...w, updates: [...(w.updates ?? []), { date, author, text }] } : w
    )));
  }, [author]);
  const closeWatch = useCallback((id, { outcome, closingNote }) => {
    setWatches(prev => prev.map(w => (
      w.id === id ? { ...w, closedOn: iso(TODAY), outcome, closingNote } : w
    )));
  }, []);
  const reopenWatch = useCallback((id) => {
    setWatches(prev => prev.map(w => {
      if (w.id !== id) return w;
      // Reopening drops the verdict entirely: a watch cannot be half-closed.
      const { closedOn: _c, outcome: _o, closingNote: _n, ...rest } = w;
      return rest;
    }));
  }, []);
  const removeWatch = useCallback((id) => {
    setWatches(prev => prev.filter(w => w.id !== id));
  }, []);

  const value = {
    theme, setTheme,
    companyId, setCompanyId: selectBrand,
    channelId, setChannelId,
    roleId, setRoleId, can,
    periodId, setPeriodId, customRange, setCustomRange,
    comparison, setComparison,
    period, compareWindow, scope, prevScope, companyScope, prevCompanyScope,
    healthConfig, setHealthConfig,
    goals, addGoal, updateGoal, removeGoal,
    events, addEvent, removeEvent,
    notes, addNote, removeNote,
    watches, addWatch, updateWatch, addWatchUpdate, closeWatch, reopenWatch, removeWatch,
    sidebarOpen, setSidebarOpen,
    dashboardLayout, setDashboardLayout, toggleWidget, moveWidget, resetLayout,
    dataVersion,
    author,
    today: TODAY,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppStateProvider>');
  return v;
}
