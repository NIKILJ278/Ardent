import { useState, useMemo } from 'react';
import {
  Barcode, Package, Link, Unlink, Edit3, Plus, Search, Tag, Layers, Check, Copy, Store, SlidersHorizontal, ArrowUpDown, Filter, AlertCircle
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { productsFor } from '../data/catalog.js';
import { num, money } from '../lib/format.js';
import { Card, DataTable, Empty, Pill, Modal, Segmented } from '../components/ui/index.jsx';

// Available sales channels for mapping
const ALL_CHANNELS = [
  { id: 'shopify', name: 'Shopify Storefront', icon: '🛍️' },
  { id: 'amazon', name: 'Amazon IN', icon: '📦' },
  { id: 'flipkart', name: 'Flipkart', icon: '🛒' },
  { id: 'woocommerce', name: 'WooCommerce', icon: '🌐' },
  { id: 'myntra', name: 'Myntra', icon: '👗' },
  { id: 'nykaa', name: 'Nykaa', icon: '💄' },
  { id: 'ajio', name: 'AJIO', icon: '🛍️' },
  { id: 'meesho', name: 'Meesho', icon: '🏬' },
];

/**
 * SKU Master & Channel Mapping Registry
 *
 * Dedicated master data view containing:
 * - Master SKU & Variant definitions
 * - Internal Category & Subcategory group hierarchy
 * - Shopify link & sync status
 * - Multi-channel mapping (Shopify, Amazon, Flipkart, WooCommerce, etc.)
 * - Unit Cost (COGS) tracking
 */
export default function Catalogue() {
  const { companyId, dataVersion } = useApp();

  // Extract products and variants from catalog
  const products = useMemo(() => productsFor(companyId), [companyId, dataVersion]);

  // Initial master SKU records built from catalog products
  const initialMasterSkus = useMemo(() => {
    const list = [];
    products.forEach((p, pIdx) => {
      (p.variants || []).forEach((v, vIdx) => {
        const isUnlinkedSample = (pIdx === 1 && vIdx === 1); // Sample unlinked variant for testing
        list.push({
          id: v.id || `sku-master-${p.id}-${vIdx}`,
          sku: v.sku || `SKU-${p.id.slice(-4)}-${vIdx + 1}`,
          productName: p.name || 'Untitled Product',
          productId: p.id,
          variantTitle: v.title || 'Default',
          internalCategory: p.category || 'Uncategorised',
          internalSubcategory: p.subcategory || 'General',
          shopifyLinked: !isUnlinkedSample,
          shopifyVariantId: !isUnlinkedSample ? (v.id || `gid://shopify/ProductVariant/${100 + list.length}`) : null,
          channels: isUnlinkedSample ? ['amazon', 'flipkart'] : ['shopify', 'amazon', 'flipkart'],
          unitCost: 450 + (list.length * 120),
          costed: true,
          updatedAt: new Date().toISOString().slice(0, 10),
        });
      });
    });
    return list;
  }, [products]);

  // Local state for interactive editing & adding new Master SKUs
  const [masterSkus, setMasterSkus] = useState(initialMasterSkus);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'linked' | 'unlinked' | 'channels'
  const [editingSku, setEditingSku] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [copiedSku, setCopiedSku] = useState(null);

  // New SKU form state
  const [newSkuForm, setNewSkuForm] = useState({
    sku: '',
    productName: '',
    variantTitle: 'Default',
    internalCategory: 'Apparel',
    internalSubcategory: 'Tops',
    shopifyLinked: true,
    shopifyVariantId: '',
    channels: ['shopify'],
    unitCost: '',
  });

  // Filtered rows based on tab
  const rows = useMemo(() => {
    if (activeTab === 'linked') return masterSkus.filter(s => s.shopifyLinked);
    if (activeTab === 'unlinked') return masterSkus.filter(s => !s.shopifyLinked);
    return masterSkus;
  }, [masterSkus, activeTab]);

  // Statistics summaries
  const stats = useMemo(() => {
    const total = masterSkus.length;
    const linked = masterSkus.filter(s => s.shopifyLinked).length;
    const unlinked = total - linked;
    const categories = new Set(masterSkus.map(s => s.internalCategory)).size;
    const costed = masterSkus.filter(s => s.costed && s.unitCost > 0).length;
    return {
      total,
      linked,
      unlinked,
      linkedPct: total ? Math.round((linked / total) * 100) : 0,
      categories,
      costedPct: total ? Math.round((costed / total) * 100) : 0,
    };
  }, [masterSkus]);

  // Copy helper
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedSku(text);
    setTimeout(() => setCopiedSku(null), 2000);
  };

  // Save SKU Mapping updates
  const handleSaveMapping = (updatedItem) => {
    setMasterSkus(prev => prev.map(s => s.id === updatedItem.id ? updatedItem : s));
    setEditingSku(null);
  };

  // Add new Master SKU
  const handleAddMasterSku = () => {
    if (!newSkuForm.sku.trim() || !newSkuForm.productName.trim()) return;
    const newItem = {
      id: `sku-master-custom-${Date.now()}`,
      sku: newSkuForm.sku.trim().toUpperCase(),
      productName: newSkuForm.productName.trim(),
      productId: `custom-prod-${Date.now()}`,
      variantTitle: newSkuForm.variantTitle.trim() || 'Default',
      internalCategory: newSkuForm.internalCategory.trim() || 'Uncategorised',
      internalSubcategory: newSkuForm.internalSubcategory.trim() || 'General',
      shopifyLinked: newSkuForm.shopifyLinked,
      shopifyVariantId: newSkuForm.shopifyLinked ? (newSkuForm.shopifyVariantId || `gid://shopify/ProductVariant/${Date.now()}`) : null,
      channels: newSkuForm.channels.length > 0 ? newSkuForm.channels : ['shopify'],
      unitCost: Number(newSkuForm.unitCost) || 0,
      costed: Boolean(newSkuForm.unitCost),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setMasterSkus(prev => [newItem, ...prev]);
    setIsAddModalOpen(false);
    setNewSkuForm({
      sku: '',
      productName: '',
      variantTitle: 'Default',
      internalCategory: 'Apparel',
      internalSubcategory: 'Tops',
      shopifyLinked: true,
      shopifyVariantId: '',
      channels: ['shopify'],
      unitCost: '',
    });
  };

  return (
    <div className="vstack" style={{ gap: 20 }}>
      {/* Page Header & Actions */}
      <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="hstack" style={{ gap: 10 }}>
            <h1 style={{ fontSize: 22, margin: 0, fontWeight: 700 }}>SKU Master & Channel Mapping</h1>
            <span className="pill neutral" style={{ fontWeight: 600 }}>{num(stats.total)} Master SKUs</span>
          </div>
          <p className="muted small" style={{ margin: '4px 0 0', maxWidth: 640, lineHeight: 1.45 }}>
            Central master registry of your product SKUs, internal group categories, channel mappings across Shopify & marketplaces, and Shopify sync status.
          </p>
        </div>
        <div className="hstack" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
            <Plus size={15} /> Add Master SKU
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <Card flush>
          <div style={{ padding: '14px 16px' }}>
            <div className="tiny muted uppercase" style={{ letterSpacing: '0.05em', fontWeight: 600 }}>Master SKUs Registered</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{num(stats.total)}</div>
            <div className="tiny muted" style={{ marginTop: 4 }}>Across {stats.categories} internal categories</div>
          </div>
        </Card>

        <Card flush>
          <div style={{ padding: '14px 16px' }}>
            <div className="tiny muted uppercase" style={{ letterSpacing: '0.05em', fontWeight: 600 }}>Linked to Shopify</div>
            <div className="hstack" style={{ gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 24, fontWeight: 700 }}>{num(stats.linked)}</span>
              <Pill tone="good" icon>{stats.linkedPct}% linked</Pill>
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>{stats.unlinked} SKU(s) pending sync</div>
          </div>
        </Card>

        <Card flush>
          <div style={{ padding: '14px 16px' }}>
            <div className="tiny muted uppercase" style={{ letterSpacing: '0.05em', fontWeight: 600 }}>Active Channels Mapped</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>Shopify + 3 Channels</div>
            <div className="tiny muted" style={{ marginTop: 4 }}>Amazon, Flipkart, WooCommerce</div>
          </div>
        </Card>

        <Card flush>
          <div style={{ padding: '14px 16px' }}>
            <div className="tiny muted uppercase" style={{ letterSpacing: '0.05em', fontWeight: 600 }}>Unit Cost (COGS) Coverage</div>
            <div className="hstack" style={{ gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 24, fontWeight: 700 }}>{stats.costedPct}%</span>
              <Pill tone={stats.costedPct >= 80 ? 'good' : 'warning'} icon>
                {stats.costedPct >= 80 ? 'Configured' : 'Incomplete'}
              </Pill>
            </div>
            <div className="tiny muted" style={{ marginTop: 4 }}>Master unit cost attached</div>
          </div>
        </Card>
      </div>

      {/* Main SKU Master Table Container */}
      <Card
        flush
        actions={
          <Segmented
            size="sm"
            value={activeTab}
            onChange={setActiveTab}
            options={[
              { id: 'all', label: `All SKUs (${stats.total})` },
              { id: 'linked', label: `Linked to Shopify (${stats.linked})` },
              { id: 'unlinked', label: `Unlinked (${stats.unlinked})` },
            ]}
          />
        }
      >
        <DataTable
          pageSize={15}
          searchKeys={['sku', 'productName', 'variantTitle', 'internalCategory', 'internalSubcategory']}
          columns={[
            {
              key: 'sku',
              label: 'Master SKU',
              render: r => (
                <div className="hstack" style={{ gap: 6 }}>
                  <span className="mono" style={{ fontWeight: 700, letterSpacing: '0.02em', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 4, fontSize: 13 }}>
                    {r.sku}
                  </span>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(r.sku); }}
                    title="Copy SKU code"
                    style={{ padding: 2, height: 22, width: 22 }}
                  >
                    {copiedSku === r.sku ? <Check size={12} style={{ color: 'var(--good)' }} /> : <Copy size={12} className="muted" />}
                  </button>
                </div>
              ),
            },
            {
              key: 'productName',
              label: 'Product & Variant',
              render: r => (
                <div>
                  <span style={{ fontWeight: 600, display: 'block', color: 'var(--ink)' }}>{r.productName}</span>
                  <span className="tiny muted" style={{ display: 'block', marginTop: 1 }}>
                    Variant: <strong style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{r.variantTitle}</strong>
                  </span>
                </div>
              ),
            },
            {
              key: 'internalGroup',
              label: 'Internal Group Mapping',
              render: r => (
                <div className="hstack" style={{ gap: 4, flexWrap: 'wrap' }}>
                  <span className="pill neutral" style={{ fontSize: 11, padding: '2px 7px' }}>
                    <Tag size={10} style={{ marginRight: 3, opacity: 0.7 }} />
                    {r.internalCategory}
                  </span>
                  <span className="muted tiny">›</span>
                  <span className="tiny muted" style={{ fontWeight: 500 }}>{r.internalSubcategory}</span>
                </div>
              ),
            },
            {
              key: 'shopifyLinked',
              label: 'Linked to Shopify',
              render: r => (
                <div>
                  {r.shopifyLinked ? (
                    <Pill tone="good" icon>
                      Linked to Shopify
                    </Pill>
                  ) : (
                    <Pill tone="warning" icon>
                      Unlinked / Pending
                    </Pill>
                  )}
                  {r.shopifyVariantId && (
                    <span className="mono tiny muted" style={{ display: 'block', marginTop: 2, fontSize: 10, opacity: 0.75 }}>
                      {r.shopifyVariantId.replace('gid://shopify/ProductVariant/', 'ID: ')}
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'channels',
              label: 'Channel Mappings',
              render: r => (
                <div className="hstack" style={{ gap: 4, flexWrap: 'wrap' }}>
                  {(r.channels || []).map(chId => {
                    const ch = ALL_CHANNELS.find(c => c.id === chId);
                    return (
                      <span
                        key={chId}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: chId === 'shopify' ? 'rgba(150, 191, 72, 0.12)' : 'var(--surface-2)',
                          color: chId === 'shopify' ? 'var(--good-ink)' : 'var(--ink-2)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <span>{ch?.icon || '🛍️'}</span>
                        <span>{ch?.name.split(' ')[0] || chId}</span>
                      </span>
                    );
                  })}
                </div>
              ),
            },
            {
              key: 'unitCost',
              label: 'Unit Cost (COGS)',
              align: 'right',
              render: r => (
                <span style={{ fontWeight: 600 }}>
                  {r.costed && r.unitCost > 0 ? money(r.unitCost) : <span className="tiny muted">Uncosted</span>}
                </span>
              ),
            },
            {
              key: 'actions',
              label: '',
              sortable: false,
              align: 'right',
              render: r => (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => { e.stopPropagation(); setEditingSku({ ...r }); }}
                  title="Edit SKU mappings"
                >
                  <Edit3 size={13} /> Edit
                </button>
              ),
            },
          ]}
          rows={rows}
          initialSort={{ key: 'sku', dir: 'asc' }}
        />
      </Card>

      {/* Edit SKU Mapping Modal */}
      {editingSku && (
        <Modal
          title={`Edit SKU Master — ${editingSku.sku}`}
          onClose={() => setEditingSku(null)}
          footer={
            <div className="hstack" style={{ justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <button className="btn" onClick={() => setEditingSku(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => handleSaveMapping(editingSku)}>
                Save Mappings
              </button>
            </div>
          }
        >
          <div className="vstack" style={{ gap: 16 }}>
            <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Master SKU Code</label>
                <input
                  className="input mono"
                  value={editingSku.sku}
                  onChange={e => setEditingSku({ ...editingSku, sku: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Variant Title</label>
                <input
                  className="input"
                  value={editingSku.variantTitle}
                  onChange={e => setEditingSku({ ...editingSku, variantTitle: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Product Name</label>
              <input
                className="input"
                value={editingSku.productName}
                onChange={e => setEditingSku({ ...editingSku, productName: e.target.value })}
              />
            </div>

            <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Internal Category</label>
                <input
                  className="input"
                  value={editingSku.internalCategory}
                  onChange={e => setEditingSku({ ...editingSku, internalCategory: e.target.value })}
                  placeholder="e.g. Apparel, Bedding"
                />
              </div>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Internal Subcategory</label>
                <input
                  className="input"
                  value={editingSku.internalSubcategory}
                  onChange={e => setEditingSku({ ...editingSku, internalSubcategory: e.target.value })}
                  placeholder="e.g. Tops, Bedsheets"
                />
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 8, border: '1px solid var(--border)' }}>
              <div className="hstack" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Shopify Linking & Sync</div>
                  <div className="tiny muted">Connect this Master SKU to your Shopify Storefront variant</div>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${editingSku.shopifyLinked ? 'btn-primary' : ''}`}
                  onClick={() => setEditingSku({
                    ...editingSku,
                    shopifyLinked: !editingSku.shopifyLinked,
                    shopifyVariantId: !editingSku.shopifyLinked ? `gid://shopify/ProductVariant/${Date.now()}` : null,
                  })}
                >
                  {editingSku.shopifyLinked ? <Link size={13} /> : <Unlink size={13} />}
                  {editingSku.shopifyLinked ? 'Linked to Shopify' : 'Mark as Linked'}
                </button>
              </div>

              {editingSku.shopifyLinked && (
                <div style={{ marginTop: 10 }}>
                  <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Shopify Variant ID / GID</label>
                  <input
                    className="input mono"
                    style={{ fontSize: 12 }}
                    value={editingSku.shopifyVariantId || ''}
                    onChange={e => setEditingSku({ ...editingSku, shopifyVariantId: e.target.value })}
                    placeholder="gid://shopify/ProductVariant/..."
                  />
                </div>
              )}
            </div>

            <div>
              <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Mapped Sales Channels</label>
              <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {ALL_CHANNELS.map(ch => {
                  const isChecked = (editingSku.channels || []).includes(ch.id);
                  return (
                    <label
                      key={ch.id}
                      className="hstack"
                      style={{
                        gap: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: isChecked ? 'var(--surface-3)' : 'transparent',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={e => {
                          const current = editingSku.channels || [];
                          const next = e.target.checked
                            ? [...current, ch.id]
                            : current.filter(id => id !== ch.id);
                          setEditingSku({ ...editingSku, channels: next });
                        }}
                      />
                      <span>{ch.icon}</span>
                      <span>{ch.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Unit Cost (COGS in ₹)</label>
              <input
                type="number"
                className="input"
                value={editingSku.unitCost || ''}
                onChange={e => setEditingSku({
                  ...editingSku,
                  unitCost: Number(e.target.value),
                  costed: Boolean(e.target.value),
                })}
                placeholder="0.00"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Add Master SKU Modal */}
      {isAddModalOpen && (
        <Modal
          title="Register New Master SKU"
          onClose={() => setIsAddModalOpen(false)}
          footer={
            <div className="hstack" style={{ justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              <button className="btn" onClick={() => setIsAddModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddMasterSku}>
                Create Master SKU
              </button>
            </div>
          }
        >
          <div className="vstack" style={{ gap: 14 }}>
            <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>SKU Code *</label>
                <input
                  className="input mono"
                  placeholder="e.g. TSHIRT-BLK-M"
                  value={newSkuForm.sku}
                  onChange={e => setNewSkuForm({ ...newSkuForm, sku: e.target.value })}
                />
              </div>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Variant Title</label>
                <input
                  className="input"
                  placeholder="e.g. Black / Medium"
                  value={newSkuForm.variantTitle}
                  onChange={e => setNewSkuForm({ ...newSkuForm, variantTitle: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Product Name *</label>
              <input
                className="input"
                placeholder="e.g. Classic Oversized Crewneck"
                value={newSkuForm.productName}
                onChange={e => setNewSkuForm({ ...newSkuForm, productName: e.target.value })}
              />
            </div>

            <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Internal Category</label>
                <input
                  className="input"
                  placeholder="Apparel"
                  value={newSkuForm.internalCategory}
                  onChange={e => setNewSkuForm({ ...newSkuForm, internalCategory: e.target.value })}
                />
              </div>
              <div>
                <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Internal Subcategory</label>
                <input
                  className="input"
                  placeholder="Tops"
                  value={newSkuForm.internalSubcategory}
                  onChange={e => setNewSkuForm({ ...newSkuForm, internalSubcategory: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="tiny muted uppercase" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Unit Cost (COGS ₹)</label>
              <input
                type="number"
                className="input"
                placeholder="e.g. 500"
                value={newSkuForm.unitCost}
                onChange={e => setNewSkuForm({ ...newSkuForm, unitCost: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

