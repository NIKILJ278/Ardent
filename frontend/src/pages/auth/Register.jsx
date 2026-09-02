import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';
import ThemeSwitcher from '../../components/ui/ThemeSwitcher';
import { Eye, EyeOff, LayoutDashboard } from 'lucide-react';

export default function Register() {
  const { loginUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const handleSubmit = async e => {
    e.preventDefault();
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setError(''); setLoading(true);
    try {
      const r = await register(form.email, form.password, form.full_name);
      const { user, access_token, refresh_token } = r.data.data;
      loginUser(user, access_token, refresh_token);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed.');
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
        <p className="auth-subtitle">Create your founder account</p>

        {error && (
          <div className="alert alert-danger py-2 px-3" style={{ fontSize: '0.875rem', borderRadius: 'var(--radius)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-3">
            <label className="form-label">Full Name</label>
            <input type="text" name="full_name" className="form-control" value={form.full_name} onChange={handleChange} placeholder="Jane Doe" autoFocus />
          </div>
          <div className="mb-3">
            <label className="form-label">Email</label>
            <input type="email" name="email" className="form-control" value={form.email} onChange={handleChange} placeholder="you@brand.com" required />
          </div>
          <div className="mb-4">
            <label className="form-label">Password <span style={{ color: 'var(--color-muted-fg)', fontWeight: 400 }}>(min 8 chars)</span></label>
            <div className="input-group">
              <input
                type={showPw ? 'text' : 'password'} name="password" className="form-control"
                value={form.password} onChange={handleChange} placeholder="••••••••" required
              />
              <button type="button" className="btn btn-outline-secondary" onClick={() => setShowPw(p => !p)}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={loading}>
            {loading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
            {loading ? 'Creating account…' : 'Get Started'}
          </button>
        </form>

        <p className="text-center mt-3" style={{ fontSize: '0.875rem', color: 'var(--color-muted-fg)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
