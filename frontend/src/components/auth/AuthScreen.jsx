import { useState } from 'react';
import { Loader2, WifiOff, Eye, EyeOff } from 'lucide-react';
import { useSession } from '../../state/Session.jsx';
import { API_BASE } from '../../lib/api.js';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 23 23">
      <path fill="#F35325" d="M1 1h10v10H1z"/>
      <path fill="#81BC06" d="M12 1h10v10H12z"/>
      <path fill="#05A6F0" d="M1 12h10v10H1z"/>
      <path fill="#FFBA08" d="M12 12h10v10H12z"/>
    </svg>
  );
}

function Frame({ title, subtitle, children }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">A</span>
          <span className="brand-word">ARDENT</span>
        </div>
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="auth-sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

/** Run an async action with a busy flag and a readable error. */
function useAction(action) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function AuthScreen() {
  const { signIn, socialSignIn, createAccount } = useSession();
  const [mode, setMode] = useState('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => !!localStorage.getItem('ardent_saved_email'));
  const [socialLoading, setSocialLoading] = useState(null);
  const [f, setF] = useState(() => ({
    fullName: '',
    email: localStorage.getItem('ardent_saved_email') || '',
    password: '',
    brandName: '',
  }));
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));

  const creating = mode === 'create';
  const { busy, error, run } = useAction(async () => {
    if (remember) {
      localStorage.setItem('ardent_saved_email', f.email.trim());
    } else {
      localStorage.removeItem('ardent_saved_email');
    }
    if (creating) {
      await createAccount({ ...f, email: f.email.trim() });
    } else {
      await signIn(f.email.trim(), f.password);
    }
  });

  const triggerSocialLogin = async (provider) => {
    setSocialLoading(provider);
    try {
      // Prompt for email / social account if email isn't entered in input yet
      let inputEmail = f.email.trim();
      if (!inputEmail) {
        const promptVal = window.prompt(`Enter your ${provider === 'google' ? 'Google' : 'Microsoft'} account email:`);
        if (!promptVal) {
          setSocialLoading(null);
          return;
        }
        inputEmail = promptVal.trim();
      }
      await socialSignIn({
        provider,
        email: inputEmail,
        fullName: f.fullName.trim() || undefined,
        brandName: f.brandName.trim() || undefined,
      });
    } catch (err) {
      alert(`Social login failed: ${err.message}`);
    } finally {
      setSocialLoading(null);
    }
  };

  const tooShort = creating && f.password.length > 0 && f.password.length < 8;
  const ready = f.email.trim() && f.password
    && (!creating || (f.password.length >= 8 && f.brandName.trim()));

  return (
    <Frame
      title={creating ? 'Create your account' : 'Sign in'}
      subtitle={creating
        ? 'Set up your account and brand, then connect your store.'
        : 'Your dashboard is built only from the stores you connect.'}
    >
      <div className="social-buttons">
        <button
          type="button"
          className="btn-social"
          disabled={busy || !!socialLoading}
          onClick={() => triggerSocialLogin('google')}
        >
          {socialLoading === 'google' ? <Loader2 size={16} className="spin" /> : <GoogleIcon />}
          <span>Continue with Google</span>
        </button>
        <button
          type="button"
          className="btn-social"
          disabled={busy || !!socialLoading}
          onClick={() => triggerSocialLogin('microsoft')}
        >
          {socialLoading === 'microsoft' ? <Loader2 size={16} className="spin" /> : <MicrosoftIcon />}
          <span>Continue with Microsoft</span>
        </button>
      </div>

      <div className="social-divider">
        <span>or continue with email</span>
      </div>

      <form className="vstack" style={{ gap: 12 }} onSubmit={run}>
        {creating && (
          <div>
            <label className="label" htmlFor="auth-name">Your name</label>
            <input id="auth-name" name="fullName" className="input" value={f.fullName} onChange={set('fullName')} autoComplete="name" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="auth-email">Email</label>
          <input id="auth-email" name="email" className="input" type="email" value={f.email} onChange={set('email')}
                 autoComplete="email" autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="auth-password">
            Password {creating && <span className="tiny muted">at least 8 characters</span>}
          </label>
          <div className="password-input-wrap">
            <input
              id="auth-password"
              name="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              value={f.password}
              onChange={set('password')}
              autoComplete={creating ? 'new-password' : 'current-password'}
            />
            <button
              type="button"
              className="eye-btn"
              title={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(s => !s)}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {tooShort && (
            <div className="tiny" style={{ color: 'var(--critical-ink)', marginTop: 4 }}>
              Use at least 8 characters.
            </div>
          )}
        </div>
        {creating && (
          <div>
            <label className="label" htmlFor="auth-brand">Brand name</label>
            <input id="auth-brand" name="brandName" className="input" value={f.brandName} onChange={set('brandName')} placeholder="Your brand" />
          </div>
        )}

        <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: -2 }}>
          <label className="hstack" style={{ gap: 6, cursor: 'pointer', fontSize: 12, color: 'var(--ink-2)' }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Remember email
          </label>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={!ready || busy}>
          {busy && <Loader2 size={14} className="spin" />}
          {creating ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <div className="auth-switch">
        {creating ? 'Already have an account?' : 'New to Ardent?'}
        <button type="button" onClick={() => setMode(creating ? 'signin' : 'create')}>
          {creating ? 'Sign in' : 'Create an account'}
        </button>
      </div>
    </Frame>
  );
}

export function CreateBrandScreen() {
  const { createBrand, signOut, user } = useSession();
  const [name, setName] = useState('');
  const { busy, error, run } = useAction(() => createBrand(name));

  return (
    <Frame
      title="Name your brand"
      subtitle={`Signed in as ${user?.email ?? 'you'}. A brand holds your connected stores and their data.`}
    >
      <form className="vstack" style={{ gap: 12 }} onSubmit={run}>
        <div>
          <label className="label">Brand name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Your brand" />
        </div>
        {error && <div className="auth-error">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={!name.trim() || busy}>
          {busy && <Loader2 size={14} className="spin" />}
          Create brand
        </button>
      </form>
      <div className="auth-switch">
        <button type="button" onClick={signOut}>Sign out</button>
      </div>
    </Frame>
  );
}

export function OfflineScreen() {
  const { retry, signOut } = useSession();
  return (
    <Frame title="Can't reach the Ardent server">
      <div className="vstack" style={{ gap: 12 }}>
        <div className="hstack" style={{ gap: 10, alignItems: 'flex-start' }}>
          <WifiOff size={18} style={{ color: 'var(--ink-3)', flexShrink: 0, marginTop: 2 }} />
          <p className="small" style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            The dashboard talks to the backend at <code>{API_BASE}</code>. Start it with
            {' '}<code>python run.py</code> from the project folder, then try again.
          </p>
        </div>
        <button className="btn btn-primary" onClick={retry}>Try again</button>
      </div>
      <div className="auth-switch">
        <button type="button" onClick={signOut}>Sign out</button>
      </div>
    </Frame>
  );
}

export function SplashScreen() {
  return (
    <div className="auth-wrap">
      <div className="hstack" style={{ gap: 10, color: 'var(--ink-2)' }}>
        <Loader2 size={18} className="spin" />
        <span className="small">Checking your session…</span>
      </div>
    </div>
  );
}
