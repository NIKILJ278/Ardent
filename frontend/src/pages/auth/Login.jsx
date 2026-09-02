import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import ThemeSwitcher from '../../components/ui/ThemeSwitcher';
import { Eye, EyeOff, LayoutDashboard } from 'lucide-react';

export default function Login() {
  const { loginUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const r = await login(form.email, form.password);
      const { user, access_token, refresh_token } = r.data.data;
      loginUser(user, access_token, refresh_token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div style={{ position: 'fixed', top: 16, right: 16 }}><ThemeSwitcher /></div>
      <div className="auth-card">
        <div className="auth-logo d-flex align-items-center justify-content-center gap-2">
          <LayoutDashboard size={28} />
          Ardent
        </div>
        <p className="auth-subtitle">D2C Analytics Dashboard</p>

        {error && (
          <div className="alert alert-danger py-2 px-3" style={{ fontSize: '0.875rem', borderRadius: 'var(--radius)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-3">
            <label className="form-label">Email</label>
            <input
              type="email" name="email" className="form-control"
              value={form.email} onChange={handleChange}
              placeholder="you@brand.com" required autoFocus
            />
          </div>
          <div className="mb-4">
            <label className="form-label">Password</label>
            <div className="input-group">
              <input
                type={showPw ? 'text' : 'password'} name="password" className="form-control"
                value={form.password} onChange={handleChange}
                placeholder="••••••••" required
              />
              <button type="button" className="btn btn-outline-secondary" onClick={() => setShowPw(p => !p)}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={loading}>
            {loading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-center mt-3" style={{ fontSize: '0.875rem', color: 'var(--color-muted-fg)' }}>
          No account?{' '}
          <Link to="/register" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Create one</Link>
        </p>
      </div>
    </div>
  );
}
