import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { resolvePeriod, comparisonWindow, TODAY } from '../data/engine.js';
import { DEFAULT_HEALTH_CONFIG, normaliseConfig } from '../data/health.js';
import { SEED_GOALS, SEED_EVENTS, SEED_NOTES } from '../data/business.js';
import { SEED_WATCHES, newWatch } from '../data/watchlist.js';
import { channelsFor } from '../data/catalog.js';
import { makeCan, DEFAULT_ROLE } from './permissions.js';
import { iso } from '../lib/format.js';

const Ctx = createContext(null);
const KEY = 'ardent.state.v1';

/**
 * Bump whenever the shape of a seeded goal/event/note changes. Without this a
 * stale localStorage copy shadows the new fields and the UI silently renders
 * half-populated rows.
 */
const SEED_VERSION = 4;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}

/**
 * Seeded rows are reference data owned by the code; anything the CEO adds is
 * owned by the browser. On a seed-version change we refresh the seeded rows and
 * keep the user's own additions.
 */
function hydrate(savedRows, seedRows, seedIsStale) {
  if (!Array.isArray(savedRows)) return seedRows;
  if (!seedIsStale) return savedRows;
  const seedIds = new Set(seedRows.map(r => r.id));
  return [...seedRows, ...savedRows.filter(r => !seedIds.has(r.id))];
}

export function AppStateProvider({ children }) {
  const saved = useMemo(load, []);

  const [theme, setTheme]           = useState(saved.theme ?? 'light');
  const [companyId, setCompanyId]   = useState(saved.companyId ?? 'kosha');
  const [periodId, setPeriodId]     = useState(saved.periodId ?? 'month');
  const [customRange, setCustomRange] = useState(saved.customRange ?? null);
  const [comparison, setComparison] = useState(saved.comparison ?? 'previous');
  const [channelId, setChannelId] = useState(saved.channelId ?? 'all');
  const [roleId, setRoleId] = useState(saved.roleId ?? DEFAULT_ROLE);
  // Which five business dimensions this CEO reads, and in what order. Stored
  // rather than fixed, because the right five differ by business.
  const [healthConfig, setHealthConfig] = useState(
    () => normaliseConfig(saved.healthConfig ?? DEFAULT_HEALTH_CONFIG)
  );
  const seedIsStale = saved.seedVersion !== SEED_VERSION;
  const [goals, setGoals]           = useState(() => hydrate(saved.goals,  SEED_GOALS,  seedIsStale));
  const [events, setEvents]         = useState(() => hydrate(saved.events, SEED_EVENTS, seedIsStale));
  const [notes, setNotes]           = useState(() => hydrate(saved.notes,  SEED_NOTES,  seedIsStale));
  const [watches, setWatches]       = useState(() => hydrate(saved.watches, SEED_WATCHES, seedIsStale));
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Theme is stamped on <html> so tokens.css can key off it.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Companies sell on different channels. If the active filter is not one of
  // them, drop it — otherwise the dashboard would show an unexplained zero.
  useEffect(() => {
    if (channelId !== 'all' && !channelsFor(companyId).includes(channelId)) {
      setChannelId('all');
    }
  }, [companyId, channelId]);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        seedVersion: SEED_VERSION,
        theme, companyId, channelId, roleId, periodId, customRange, comparison, healthConfig, goals, events, notes, watches,
      }));
    } catch { /* storage may be unavailable — the app still works */ }
  }, [theme, companyId, channelId, roleId, periodId, customRange, comparison, healthConfig, goals, events, notes, watches]);

  // One permission gate, shared by every component that renders a metric.
  const can = useMemo(() => makeCan(roleId), [roleId]);

  const period = useMemo(
    () => resolvePeriod(periodId, customRange),
    [periodId, customRange]
  );
  const compareWindow = useMemo(
    () => comparisonWindow(period, comparison),
    [period, comparison]
  );

  /** The scope object every data call takes. */
  // `channelId` of 'all' means no channel filter — the key is left off the
  // scope entirely so `query()` does not have to special-case it.
  const channel = channelId === 'all' ? undefined : channelId;

  const scope = useMemo(
    () => ({ start: period.start, end: period.end, company: companyId, channel }),
    [period, companyId, channel]
  );
  const prevScope = useMemo(
    () => ({ start: compareWindow.start, end: compareWindow.end, company: companyId, channel }),
    [compareWindow, companyId, channel]
  );

  // Channel-free scopes, for figures that describe the whole company (cash,
  // runway, Company Health) and for the channel comparison strip.
  const companyScope = useMemo(
    () => ({ start: period.start, end: period.end, company: companyId }),
    [period, companyId]
  );
  const prevCompanyScope = useMemo(
    () => ({ start: compareWindow.start, end: compareWindow.end, company: companyId }),
    [compareWindow, companyId]
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
    setEvents(prev => [...prev, { ...e, id: `e${Date.now()}` }]);
  }, []);
  const addNote = useCallback((n) => {
    setNotes(prev => [...prev, { ...n, id: `n${Date.now()}`, kind: 'note', author: 'Vismay Shah' }]);
  }, []);
  const removeNote = useCallback((id) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  // Watchlist: a metric put under observation after a meeting, plus the
  // discussion and decision that go with it.
  const addWatch = useCallback((w) => {
    const row = newWatch({ ...w, id: `w${Date.now()}` });
    setWatches(prev => [row, ...prev]);
    return row;
  }, []);
  const updateWatch = useCallback((id, patch) => {
    setWatches(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)));
  }, []);
  const addWatchUpdate = useCallback((id, text, author = 'Vismay Shah') => {
    const date = iso(TODAY);
    setWatches(prev => prev.map(w => (
      w.id === id ? { ...w, updates: [...(w.updates ?? []), { date, author, text }] } : w
    )));
  }, []);
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
    companyId, setCompanyId,
    channelId, setChannelId,
    roleId, setRoleId, can,
    periodId, setPeriodId, customRange, setCustomRange,
    comparison, setComparison,
    period, compareWindow, scope, prevScope, companyScope, prevCompanyScope,
    healthConfig, setHealthConfig,
    goals, addGoal, updateGoal, removeGoal,
    events, addEvent,
    notes, addNote, removeNote,
    watches, addWatch, updateWatch, addWatchUpdate, closeWatch, reopenWatch, removeWatch,
    sidebarOpen, setSidebarOpen,
    today: TODAY,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppStateProvider>');
  return v;
}
