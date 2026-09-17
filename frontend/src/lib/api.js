// Talking to the Ardent backend.
//
// Every figure in the dashboard now comes from the server, which holds the
// Shopify credentials and the synced orders. The browser never sees a store
// secret — it holds only the signed-in user's session token.

const BASE = (import.meta.env?.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const TOKEN_KEY = 'ardent.session';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable — the session lasts until reload */ }
}

let onUnauthorized = null;

/** Called when the server rejects the token, so the app can sign out cleanly. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let resp;
  try {
    resp = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Cannot reach the Ardent server at ${BASE}. Start the backend and try again.`, 0);
  }

  let payload = null;
  try { payload = await resp.json(); } catch { /* empty or non-JSON body */ }

  if (!resp.ok) {
    if (resp.status === 401 && token && onUnauthorized) onUnauthorized();
    const message = payload?.error || payload?.message || payload?.msg || `Request failed (${resp.status})`;
    throw new ApiError(message, resp.status);
  }
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  del: (path) => request('DELETE', path),
};

export { BASE as API_BASE };
