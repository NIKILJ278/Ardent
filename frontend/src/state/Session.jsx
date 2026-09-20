import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from '../lib/api.js';
import { clearLive, setBrands, setLive, setLiveStatus } from '../data/live.js';

const Ctx = createContext(null);
const BRAND_KEY = 'ardent.brand';

const readBrand = () => { try { return localStorage.getItem(BRAND_KEY); } catch { return null; } };
const writeBrand = (id) => {
  try { if (id) localStorage.setItem(BRAND_KEY, id); else localStorage.removeItem(BRAND_KEY); } catch { /* ignore */ }
};

/**
 * Who is signed in, which brand they are looking at, and that brand's data.
 *
 * `phase` drives the whole app:
 *   checking   — a stored token is being validated
 *   signed-out — show sign in / create account
 *   no-brand   — signed in, but no brand exists yet
 *   ready      — the dashboard, populated from the backend
 */
export function SessionProvider({ children }) {
  const [phase, setPhase] = useState(() => (getToken() ? 'checking' : 'signed-out'));
  const [user, setUser] = useState(null);
  const [brands, setBrandList] = useState([]);
  const [brandId, setBrandIdState] = useState(readBrand);

  const signOut = useCallback(() => {
    setToken(null);
    writeBrand(null);
    setUser(null);
    setBrandList([]);
    setBrandIdState(null);
    setBrands([]);
    clearLive();
    setPhase('signed-out');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  /** Validate the token and load the brands it can see. */
  const bootstrap = useCallback(async () => {
    const [me, list] = await Promise.all([api.get('/api/auth/me'), api.get('/api/brands')]);
    setUser(me);
    setBrandList(list);
    setBrands(list);
    if (!list.length) {
      setPhase('no-brand');
      return;
    }
    const stored = readBrand();
    const chosen = list.some(b => b.id === stored) ? stored : list[0].id;
    writeBrand(chosen);
    setBrandIdState(chosen);
    setPhase('ready');
  }, []);

  useEffect(() => {
    if (phase !== 'checking') return;
    bootstrap().catch((e) => {
      // A dead token signs out; an unreachable server keeps the token and says so.
      if (e instanceof ApiError && e.status === 0) setPhase('offline');
      else signOut();
    });
  }, [phase, bootstrap, signOut]);

  /** Pull the fact table for the active brand. */
  const loadFacts = useCallback(async (id = brandId) => {
    if (!id) return;
    setLiveStatus('loading');
    try {
      const data = await api.get(`/api/brands/${id}/facts`);
      setLive(data, id);
    } catch (e) {
      setLiveStatus('error', e.message);
    }
  }, [brandId]);

  useEffect(() => {
    if (phase === 'ready' && brandId) {
      clearLive();
      loadFacts(brandId);
    }
  }, [phase, brandId, loadFacts]);

  const signIn = useCallback(async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password });
    setToken(data.access_token);
    setPhase('checking');
  }, []);

  const createAccount = useCallback(async ({ fullName, email, password, brandName }) => {
    const data = await api.post('/api/auth/register', { full_name: fullName, email, password });
    setToken(data.access_token);
    if (brandName?.trim()) {
      await api.post('/api/brands', { name: brandName.trim() });
    }
    setPhase('checking');
  }, []);

  const createBrand = useCallback(async (name) => {
    await api.post('/api/brands', { name: name.trim() });
    setPhase('checking');
  }, []);

  const selectBrand = useCallback((id) => {
    writeBrand(id);
    setBrandIdState(id);
  }, []);

  const retry = useCallback(() => setPhase(getToken() ? 'checking' : 'signed-out'), []);

  const value = useMemo(() => ({
    phase, user, brands, brandId,
    signIn, createAccount, createBrand, signOut, selectBrand, loadFacts, retry,
  }), [phase, user, brands, brandId, signIn, createAccount, createBrand, signOut, selectBrand, loadFacts, retry]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
