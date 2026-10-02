import { useState } from 'react';
import {
  RotateCcw, Plus, LogOut, Eye, EyeOff, ChevronUp, ChevronDown,
  Tag, Percent, IndianRupee, Layout, Layers, LayoutDashboard, Check,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useSession } from '../state/Session.jsx';
import { PERIOD_PRESETS, COMPARISON_MODES } from '../data/engine.js';
import { DIMENSION_BY_ID, HEALTH_SLOTS } from '../data/health.js';
import { DEFAULT_DASHBOARD_LAYOUTS } from '../state/AppState.jsx';
import { Card, Segmented, Pill, Modal } from '../components/ui/index.jsx';

/* ── Indian GST Slab & HSN master ──────────────────────────────────────── */

// Indian GST slabs
const GST_SLABS = [
  { id: '0', label: '0% (Exempt)', cgst: 0, sgst: 0, igst: 0 },
  { id: '5', label: '5%', cgst: 2.5, sgst: 2.5, igst: 5 },
  { id: '12', label: '12%', cgst: 6, sgst: 6, igst: 12 },
  { id: '18', label: '18%', cgst: 9, sgst: 9, igst: 18 },
  { id: '28', label: '28%', cgst: 14, sgst: 14, igst: 28 },
];

// Default categories with common Indian e-commerce HSN codes
const DEFAULT_GST_CATEGORIES = [
  { id: 'apparel', name: 'Apparel / Clothing', hsnCode: '6201', gstSlab: '12', state: 'Maharashtra' },
  { id: 'footwear', name: 'Footwear', hsnCode: '6401', gstSlab: '18', state: 'Maharashtra' },
  { id: 'electronics', name: 'Electronics', hsnCode: '8517', gstSlab: '18', state: 'Maharashtra' },
  { id: 'beauty', name: 'Beauty & Personal Care', hsnCode: '3304', gstSlab: '18', state: 'Maharashtra' },
  { id: 'food', name: 'Food & Grocery', hsnCode: '0401', gstSlab: '5', state: 'Maharashtra' },
  { id: 'home_decor', name: 'Home & Décor', hsnCode: '6912', gstSlab: '12', state: 'Maharashtra' },
  { id: 'bedding', name: 'Bedding & Linen', hsnCode: '6302', gstSlab: '12', state: 'Maharashtra' },
  { id: 'jewellery', name: 'Jewellery & Accessories', hsnCode: '7113', gstSlab: '3', state: 'Maharashtra' },
  { id: 'sports', name: 'Sports & Fitness', hsnCode: '9506', gstSlab: '12', state: 'Maharashtra' },
  { id: 'books', name: 'Books & Stationery', hsnCode: '4901', gstSlab: '0', state: 'Maharashtra' },
];

// Indian states for region-specific tax rates
const INDIA_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

/* ── Dashboard widget registry ─────────────────────────────────────────── */

const DASHBOARD_WIDGETS = {
  overview: [
    { id: 'status_banner', label: 'Business Status Banner', description: 'Phase & growth summary at the top' },
    { id: 'revenue_ladder', label: 'Revenue Ladder', description: 'GMV → Net Sales funnel' },
    { id: 'product_intelligence', label: 'Product Intelligence', description: 'Top sellers, rising, returning' },
    { id: 'market_mix', label: 'Market Mix (Multi-currency)', description: 'Only shown when multiple currencies' },
    { id: 'gmv_trend', label: 'GMV Performance Chart', description: 'Month-on-month revenue trend' },
    { id: 'financial_position', label: 'Financial Position', description: 'Gross Sales, Net Sales, COGS, Margin' },
    { id: 'company_health', label: 'Company Health Score', description: 'Composite health gauge' },
    { id: 'goals_timeline', label: 'Goals & Business Timeline', description: 'Targets + event log' },
    { id: 'data_sources', label: 'Data Sources Panel', description: 'Connected sources status' },
  ],
  sales: [
    { id: 'summary', label: 'Sales Summary', description: 'Key sales KPIs' },
    { id: 'by_channel', label: 'By Channel', description: 'Revenue breakdown by channel' },
    { id: 'by_product', label: 'By Product', description: 'Top products' },
    { id: 'by_category', label: 'By Category', description: 'Category performance' },
    { id: 'returns', label: 'Returns Analysis', description: 'Return rates and trends' },
  ],
  ads: [
    { id: 'summary', label: 'Ads Summary', description: 'Spend, Revenue, ROAS' },
    { id: 'by_platform', label: 'By Ad Platform', description: 'Meta, Google, etc.' },
    { id: 'roas_trend', label: 'ROAS Trend', description: 'Return on ad spend over time' },
    { id: 'spend_vs_revenue', label: 'Spend vs Revenue', description: 'Side-by-side comparison' },
  ],
};

const DASHBOARD_LABELS = {
  overview: 'Overview Dashboard',
  sales: 'Sales Dashboard',
  ads: 'Ads Dashboard',
};

/* ── AddBrand modal ─────────────────────────────────────────────────────── */

function AddBrand({ onClose }) {
  const { createBrand } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await createBrand(name);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add a brand"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="brand-form" type="submit" disabled={!name.trim() || busy}>
            Create brand
          </button>
        </>
      }
    >
      <form id="brand-form" className="vstack" style={{ gap: 12 }} onSubmit={submit}>
        <div>
          <label className="label">Brand name</label>
          <input className="input" value={name} autoFocus onChange={e => setName(e.target.value)} />
          <div className="tiny muted" style={{ marginTop: 5 }}>
            A brand holds its own connected stores and their data. Nothing is shared between brands.
          </div>
        </div>
        {error && <div className="auth-error">{error}</div>}
      </form>
    </Modal>
  );
}

/* ── GST Category Manager ─────────────────────────────────────────────────── */

function GstCategoryManager() {
  const [categories, setCategories] = useState(DEFAULT_GST_CATEGORIES);
  const [editingCat, setEditingCat] = useState(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newCat, setNewCat] = useState({ name: '', hsnCode: '', gstSlab: '18', state: 'Maharashtra' });
  const [defaultState, setDefaultState] = useState('Maharashtra');

  const slab = (id) => GST_SLABS.find(s => s.id === id);

  const handleSave = () => {
    if (!editingCat) return;
    setCategories(prev => prev.map(c => c.id === editingCat.id ? editingCat : c));
    setEditingCat(null);
  };

  const handleAdd = () => {
    if (!newCat.name.trim()) return;
    setCategories(prev => [
      ...prev,
      { id: `cat-${Date.now()}`, ...newCat, state: defaultState },
    ]);
    setNewCat({ name: '', hsnCode: '', gstSlab: '18', state: defaultState });
    setAddingNew(false);
  };

  const handleRemove = (id) => {
    setCategories(prev => prev.filter(c => c.id !== id));
  };

  return (
    <Card
      title="Indian GST & Category Mapping"
      subtitle="Link internal product categories to HSN codes and GST slabs. Rates vary by destination state (intra-state CGST+SGST, inter-state IGST)."
      actions={
        <div className="hstack" style={{ gap: 8 }}>
          <div className="hstack" style={{ gap: 6 }}>
            <label className="tiny muted" style={{ whiteSpace: 'nowrap' }}>Default State:</label>
            <select
              className="input"
              style={{ width: 160, padding: '3px 8px', fontSize: 12 }}
              value={defaultState}
              onChange={e => setDefaultState(e.target.value)}
            >
              {INDIA_STATES.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setAddingNew(true)}>
            <Plus size={12} /> Add Category
          </button>
        </div>
      }
    >
      {/* Info banner about GST in India */}
      <div style={{
        background: 'rgba(80, 160, 230, 0.08)', border: '1px solid rgba(80, 160, 230, 0.25)',
        borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, lineHeight: 1.55,
      }}>
        <strong>Indian GST:</strong> For intra-state sales, CGST + SGST apply (split equally). For inter-state sales, IGST applies.
        HSN codes determine the applicable GST rate. Categories here map to your SKU Master internal groups.
      </div>

      {/* Category table */}
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Internal Category</th>
              <th>HSN Code</th>
              <th>GST Slab</th>
              <th className="num">CGST</th>
              <th className="num">SGST</th>
              <th className="num">IGST</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categories.map(cat => {
              const sl = slab(cat.gstSlab);
              return (
                <tr key={cat.id}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{cat.name}</span>
                  </td>
                  <td>
                    <span className="mono" style={{
                      background: 'var(--surface-2)', padding: '2px 7px',
                      borderRadius: 4, fontSize: 12,
                    }}>{cat.hsnCode || '—'}</span>
                  </td>
                  <td>
                    <span className="pill neutral" style={{ fontSize: 11 }}>
                      <Percent size={10} style={{ marginRight: 3 }} />
                      {sl?.label || cat.gstSlab + '%'}
                    </span>
                  </td>
                  <td className="num">
                    <span className="tnum small">{sl?.cgst ?? 0}%</span>
                  </td>
                  <td className="num">
                    <span className="tnum small">{sl?.sgst ?? 0}%</span>
                  </td>
                  <td className="num">
                    <span className="tnum small">{sl?.igst ?? 0}%</span>
                  </td>
                  <td>
                    <span className="tiny muted">{cat.state || defaultState}</span>
                  </td>
                  <td>
                    <div className="hstack" style={{ gap: 4 }}>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setEditingCat({ ...cat })}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ color: 'var(--critical)' }}
                        onClick={() => handleRemove(cat.id)}
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* Inline new-category form */}
            {addingNew && (
              <tr style={{ background: 'var(--surface-2)' }}>
                <td>
                  <input
                    className="input" style={{ fontSize: 12, padding: '4px 8px' }}
                    placeholder="Category name"
                    value={newCat.name}
                    onChange={e => setNewCat({ ...newCat, name: e.target.value })}
                    autoFocus
                  />
                </td>
                <td>
                  <input
                    className="input mono" style={{ fontSize: 12, padding: '4px 8px', width: 90 }}
                    placeholder="HSN code"
                    value={newCat.hsnCode}
                    onChange={e => setNewCat({ ...newCat, hsnCode: e.target.value })}
                  />
                </td>
                <td colSpan={4}>
                  <select
                    className="input" style={{ fontSize: 12, padding: '4px 8px' }}
                    value={newCat.gstSlab}
                    onChange={e => setNewCat({ ...newCat, gstSlab: e.target.value })}
                  >
                    {GST_SLABS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </td>
                <td colSpan={2}>
                  <div className="hstack" style={{ gap: 4 }}>
                    <button className="btn btn-sm btn-primary" onClick={handleAdd}>Add</button>
                    <button className="btn btn-sm" onClick={() => setAddingNew(false)}>Cancel</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="tiny muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
        Categories defined here are linked to SKU Master entries. When generating GST reports, each SKU's internal category
        determines the applicable HSN code and tax rate automatically.
      </div>

      {/* Edit modal */}
      {editingCat && (
        <Modal
          title={`Edit GST Mapping — ${editingCat.name}`}
          onClose={() => setEditingCat(null)}
          footer={
            <div className="hstack" style={{ justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <button className="btn" onClick={() => setEditingCat(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save Mapping</button>
            </div>
          }
        >
          <div className="vstack" style={{ gap: 14 }}>
            <div>
              <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category Name</label>
              <input className="input" value={editingCat.name} onChange={e => setEditingCat({ ...editingCat, name: e.target.value })} />
            </div>
            <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>HSN Code</label>
                <input
                  className="input mono"
                  placeholder="e.g. 6201"
                  value={editingCat.hsnCode}
                  onChange={e => setEditingCat({ ...editingCat, hsnCode: e.target.value })}
                />
              </div>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>GST Slab</label>
                <select
                  className="input"
                  value={editingCat.gstSlab}
                  onChange={e => setEditingCat({ ...editingCat, gstSlab: e.target.value })}
                >
                  {GST_SLABS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Home / Registration State</label>
              <select
                className="input"
                value={editingCat.state || defaultState}
                onChange={e => setEditingCat({ ...editingCat, state: e.target.value })}
              >
                {INDIA_STATES.map(st => <option key={st} value={st}>{st}</option>)}
              </select>
              <div className="tiny muted" style={{ marginTop: 5 }}>
                Intra-state sales (CGST + SGST) apply when the customer is in this state; IGST applies for all other states.
              </div>
            </div>
            {/* Preview computed rates */}
            {(() => {
              const sl = slab(editingCat.gstSlab);
              return sl ? (
                <div style={{
                  background: 'var(--surface-2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)',
                }}>
                  <div className="tiny muted uppercase" style={{ fontWeight: 600, marginBottom: 8 }}>Computed Tax Rates</div>
                  <div className="hstack" style={{ gap: 16, flexWrap: 'wrap' }}>
                    <div>
                      <div className="tiny muted">Intra-state (same state)</div>
                      <div style={{ fontWeight: 600 }}>CGST {sl.cgst}% + SGST {sl.sgst}%</div>
                    </div>
                    <div>
                      <div className="tiny muted">Inter-state (other states)</div>
                      <div style={{ fontWeight: 600 }}>IGST {sl.igst}%</div>
                    </div>
                  </div>
                </div>
              ) : null;
            })()}
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ── Dashboard Customiser ────────────────────────────────────────────────── */

function DashboardCustomiser() {
  const { dashboardLayout, toggleWidget, moveWidget, resetLayout } = useApp();
  const [activeDash, setActiveDash] = useState('overview');

  const widgets = DASHBOARD_WIDGETS[activeDash] ?? [];
  const layout = dashboardLayout[activeDash] ?? DEFAULT_DASHBOARD_LAYOUTS[activeDash] ?? [];

  // Build ordered widget list: show visible ones first (in layout order), then hidden
  const visible = layout.map(id => widgets.find(w => w.id === id)).filter(Boolean);
  const hidden = widgets.filter(w => !layout.includes(w.id));
  const orderedWidgets = [...visible, ...hidden];

  return (
    <Card
      title="Dashboard Layout Customisation"
      subtitle="Choose which sections appear on each dashboard and reorder them. Changes are saved to this browser."
      actions={
        <div className="hstack" style={{ gap: 8 }}>
          <Segmented
            size="sm"
            value={activeDash}
            onChange={setActiveDash}
            options={Object.keys(DASHBOARD_WIDGETS).map(k => ({ id: k, label: DASHBOARD_LABELS[k].split(' ')[0] }))}
          />
          <button
            className="btn btn-sm"
            onClick={() => resetLayout(activeDash)}
            title="Reset to default layout"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      }
    >
      <p className="tiny muted" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>
        <strong>{DASHBOARD_LABELS[activeDash]}</strong> — drag widgets into order using the arrows, or toggle visibility with the eye icon.
        Different teams (operations, finance, marketing) can save their preferred view.
      </p>

      <div className="vstack" style={{ gap: 6 }}>
        {orderedWidgets.map((widget, idx) => {
          const isVisible = layout.includes(widget.id);
          const visibleIdx = visible.findIndex(w => w.id === widget.id);
          return (
            <div
              key={widget.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px',
                borderRadius: 7,
                border: `1px solid ${isVisible ? 'var(--border)' : 'var(--border)'}`,
                background: isVisible ? 'var(--surface)' : 'var(--surface-2)',
                opacity: isVisible ? 1 : 0.55,
                transition: 'all 0.15s ease',
              }}
            >
              {/* Order number */}
              <span style={{
                minWidth: 20, height: 20, display: 'flex', alignItems: 'center',
                justifyContent: 'center', borderRadius: 4,
                background: isVisible ? 'var(--accent)' : 'var(--surface-3)',
                color: isVisible ? 'white' : 'var(--ink-3)',
                fontSize: 11, fontWeight: 700,
              }}>
                {isVisible ? visibleIdx + 1 : '—'}
              </span>

              {/* Label + description */}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: isVisible ? 600 : 400, fontSize: 13 }}>
                  {widget.label}
                </span>
                <span className="tiny muted" style={{ display: 'block' }}>{widget.description}</span>
              </span>

              {/* Reorder controls (only when visible) */}
              {isVisible && (
                <div className="hstack" style={{ gap: 2 }}>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    disabled={visibleIdx === 0}
                    onClick={() => moveWidget(activeDash, widget.id, 'up')}
                    title="Move up"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    disabled={visibleIdx === visible.length - 1}
                    onClick={() => moveWidget(activeDash, widget.id, 'down')}
                    title="Move down"
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              )}

              {/* Toggle visibility */}
              <button
                className={`btn btn-sm ${isVisible ? '' : 'btn-ghost'}`}
                onClick={() => toggleWidget(activeDash, widget.id)}
                title={isVisible ? 'Hide this section' : 'Show this section'}
                style={{ gap: 4 }}
              >
                {isVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                <span style={{ fontSize: 11 }}>{isVisible ? 'Visible' : 'Hidden'}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="tiny muted" style={{ marginTop: 12, padding: '8px 0', borderTop: '1px solid var(--border)', lineHeight: 1.5 }}>
        {visible.length} of {widgets.length} sections visible on {DASHBOARD_LABELS[activeDash]}.
        Hidden sections still run in the background — they are only removed from view.
      </div>
    </Card>
  );
}

/* ── Main Settings Page ─────────────────────────────────────────────────── */

export default function Settings() {
  const {
    theme, setTheme, companyId, setCompanyId, healthConfig, setHealthConfig,
    periodId, setPeriodId, comparison, setComparison,
  } = useApp();
  const { user, brands, signOut } = useSession();
  const [draft, setDraft] = useState(healthConfig.weights);
  const [adding, setAdding] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const total = healthConfig.dimensions.reduce((s, id) => s + (draft[id] ?? 0), 0);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div className="hstack" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Settings</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            Account, brands, appearance, Indian GST categories, and dashboard customisation.
          </p>
        </div>
        <Segmented
          value={settingsTab}
          onChange={setSettingsTab}
          options={[
            { id: 'general', label: 'General' },
            { id: 'gst', label: 'GST & Tax' },
            { id: 'dashboards', label: 'Dashboards' },
          ]}
        />
      </div>

      {settingsTab === 'general' && (
        <>
          <Card title="Account" subtitle="Who you are signed in as">
            <div className="spread" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="hstack" style={{ gap: 11 }}>
                <span className="avatar" style={{ borderRadius: 9 }}>
                  {(user?.full_name || user?.email || '?').slice(0, 2).toUpperCase()}
                </span>
                <span>
                  <span className="small" style={{ fontWeight: 600, display: 'block' }}>
                    {user?.full_name || 'Your account'}
                  </span>
                  <span className="tiny muted">{user?.email}</span>
                </span>
              </div>
              <button className="btn" onClick={signOut}><LogOut size={13} /> Sign out</button>
            </div>
          </Card>

          <Card
            title="Brands"
            subtitle="Each brand holds its own connected stores"
            actions={<button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={12} /> Add brand</button>}
          >
            <div className="vstack" style={{ gap: 2 }}>
              {brands.map(b => (
                <div className="spread" key={b.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="hstack" style={{ gap: 10 }}>
                    <span className="avatar" style={{ borderRadius: 7 }}>{b.name.slice(0, 2).toUpperCase()}</span>
                    <span>
                      <span className="small" style={{ fontWeight: 500, display: 'block' }}>{b.name}</span>
                      <span className="tiny muted">
                        {[b.industry, b.currency, b.role].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </span>
                  {companyId === b.id
                    ? <Pill tone="info">Active</Pill>
                    : <button className="btn btn-sm" onClick={() => setCompanyId(b.id)}>Switch</button>}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Appearance" subtitle="Applies to this browser">
            <div className="spread">
              <span className="small">Theme</span>
              <Segmented
                options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]}
                value={theme} onChange={setTheme}
              />
            </div>
          </Card>

          <Card title="Defaults" subtitle="What loads when you open Ardent">
            <div className="vstack" style={{ gap: 15 }}>
              <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
                <span className="small">Default period</span>
                <select className="input" style={{ width: 220 }} value={periodId} onChange={e => setPeriodId(e.target.value)}>
                  {PERIOD_PRESETS.filter(p => p.id !== 'custom').map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
                <span className="small">Default comparison</span>
                <select className="input" style={{ width: 220 }} value={comparison} onChange={e => setComparison(e.target.value)}>
                  {COMPARISON_MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>
          </Card>

          <Card
            title="Company Health weighting"
            subtitle={`How much each of your ${HEALTH_SLOTS} chosen indicators contributes to the overall score`}
            actions={
              <button
                className="btn btn-sm"
                onClick={() => {
                  const even = Math.round(100 / healthConfig.dimensions.length);
                  const reset = Object.fromEntries(healthConfig.dimensions.map(id => [id, even]));
                  setDraft(reset);
                  setHealthConfig({ ...healthConfig, weights: reset });
                }}
              >
                <RotateCcw size={12} /> Balance evenly
              </button>
            }
          >
            <p className="tiny muted" style={{ margin: '0 0 14px' }}>
              Which indicators appear is chosen on the Overview, under View health breakdown. An
              indicator whose data is not connected is left out of the score entirely, whatever weight
              it carries here.
            </p>
            <div className="vstack" style={{ gap: 14 }}>
              {healthConfig.dimensions.map(id => {
                const c = DIMENSION_BY_ID[id];
                if (!c) return null;
                return (
                  <div key={id}>
                    <div className="spread" style={{ marginBottom: 6 }}>
                      <span>
                        <span className="small" style={{ fontWeight: 500 }}>{c.label}</span>
                        <span className="tiny muted" style={{ display: 'block' }}>{c.basis}</span>
                      </span>
                      <span className="hstack" style={{ gap: 5 }}>
                        <input
                          type="range" min={0} max={60} step={5}
                          value={draft[id] ?? 20}
                          onChange={e => setDraft(d => ({ ...d, [id]: Number(e.target.value) }))}
                          style={{ width: 150, accentColor: 'var(--accent)' }}
                        />
                        <span className="tnum small" style={{ width: 34, textAlign: 'right', fontWeight: 600 }}>
                          {draft[id] ?? 20}%
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="spread" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <span className="hstack" style={{ gap: 9 }}>
                <span className="small muted">Total</span>
                <span className={`tnum small${total === 100 ? '' : ' delta down'}`} style={{ fontWeight: 600 }}>{total}%</span>
                {total === 100 && <Pill tone="good">Valid</Pill>}
              </span>
              <button
                className="btn btn-primary" disabled={total !== 100}
                onClick={() => setHealthConfig({ ...healthConfig, weights: draft })}
              >
                {total === 100 ? 'Save weighting' : 'Must total 100%'}
              </button>
            </div>
          </Card>
        </>
      )}

      {settingsTab === 'gst' && <GstCategoryManager />}

      {settingsTab === 'dashboards' && <DashboardCustomiser />}

      {adding && <AddBrand onClose={() => setAdding(false)} />}
    </div>
  );
}
