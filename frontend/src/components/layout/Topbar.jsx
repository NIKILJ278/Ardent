import { useAuth } from '../../context/AuthContext';
import { useBrand } from '../../context/BrandContext';
import ThemeSwitcher from '../ui/ThemeSwitcher';
import { createBrand } from '../../api/brands';
import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';

export default function Topbar() {
  const { user } = useAuth();
  const { brands, activeBrand, switchBrand, setBrands } = useBrand();
  const [showBrandModal, setShowBrandModal] = useState(false);
  const [newBrand, setNewBrand] = useState({ name: '', industry: '', currency: 'INR' });
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const r = await createBrand(newBrand);
      const brand = r.data.data;
      setBrands(prev => [...prev, brand]);
      switchBrand(brand);
      setShowBrandModal(false);
      setNewBrand({ name: '', industry: '', currency: 'INR' });
    } catch { /* backend will show error */ }
    finally { setCreating(false); }
  };

  return (
    <>
      <header className="ardent-topbar">
        <div className="d-flex align-items-center gap-2" style={{ flex: 1 }}>
          {/* Brand switcher */}
          <div className="dropdown">
            <button
              className="btn btn-sm d-flex align-items-center gap-1"
              style={{ background: 'var(--color-muted)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 'var(--radius)' }}
              data-bs-toggle="dropdown"
            >
              <span style={{ fontWeight: 600, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeBrand?.name || 'Select Brand'}
              </span>
              <ChevronDown size={14} />
            </button>
            <ul className="dropdown-menu shadow" style={{ background: 'var(--color-card)', borderColor: 'var(--color-border)', minWidth: 200 }}>
              {brands.map(b => (
                <li key={b.id}>
                  <button
                    className="dropdown-item"
                    style={{ color: 'var(--color-text)', background: activeBrand?.id === b.id ? 'var(--color-muted)' : 'transparent' }}
                    onClick={() => switchBrand(b)}
                  >
                    {b.name}
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-muted-fg)', marginLeft: 6 }}>{b.industry}</span>
                  </button>
                </li>
              ))}
              <li><hr className="dropdown-divider" style={{ borderColor: 'var(--color-border)' }} /></li>
              <li>
                <button className="dropdown-item d-flex align-items-center gap-1" style={{ color: 'var(--color-primary)' }} onClick={() => setShowBrandModal(true)}>
                  <Plus size={14} /> New Brand
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="d-flex align-items-center gap-3">
          <ThemeSwitcher />
          <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
            {user?.full_name || user?.email}
          </div>
        </div>
      </header>

      {/* New Brand Modal */}
      {showBrandModal && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 2000 }} onClick={() => setShowBrandModal(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
              <div className="modal-header" style={{ borderColor: 'var(--color-border)' }}>
                <h5 className="modal-title" style={{ color: 'var(--color-text)' }}>Create New Brand</h5>
                <button className="btn-close" onClick={() => setShowBrandModal(false)} />
              </div>
              <form onSubmit={handleCreate}>
                <div className="modal-body d-flex flex-column gap-3">
                  <div>
                    <label className="form-label">Brand Name</label>
                    <input className="form-control" required value={newBrand.name} onChange={e => setNewBrand(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Paws & Co" />
                  </div>
                  <div>
                    <label className="form-label">Industry</label>
                    <select className="form-select" value={newBrand.industry} onChange={e => setNewBrand(p => ({ ...p, industry: e.target.value }))}>
                      <option value="">Select industry</option>
                      {['apparel','beauty','home_living','pet','food_beverage','health','jewellery'].map(i => (
                        <option key={i} value={i}>{i.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Currency</label>
                    <select className="form-select" value={newBrand.currency} onChange={e => setNewBrand(p => ({ ...p, currency: e.target.value }))}>
                      <option value="INR">INR ₹</option>
                      <option value="USD">USD $</option>
                    </select>
                  </div>
                </div>
                <div className="modal-footer" style={{ borderColor: 'var(--color-border)' }}>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowBrandModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>{creating ? 'Creating…' : 'Create Brand'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
