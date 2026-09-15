import { useMemo, useState } from 'react';
import { Search, Link2, AlertTriangle, ChevronDown, Check, Store } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import {
  masterFor, mappingHealth, LISTING_FORMATS, LISTING_STATES, MASTER_STATUS, findBySku,
} from '../data/skuMaster.js';
import { CHANNEL_BY_ID, CHANNELS, channelsFor } from '../data/catalog.js';
import { inr, num, pct, fmtDate, asAt } from '../lib/format.js';
import { Card, Pill, DataTable, Modal, Track, Popover } from '../components/ui/index.jsx';
import { WatchButton } from '../components/watch/WatchButton.jsx';
import { channelColor } from '../lib/channels.js';

/** One SKU's full identity across every platform it sells on. */
function SkuDetail({ row, onClose }) {
  return (
    <Modal title={row.sku} onClose={onClose} wide>
      <div className="hstack" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Pill tone={MASTER_STATUS[row.status]?.tone ?? 'neutral'} icon={false}>
          {MASTER_STATUS[row.status]?.label ?? row.status}
        </Pill>
        <span className="small muted">{row.productName} · {row.variant}</span>
      </div>

      <div className="section-title">Master attributes</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(128px,1fr))', gap: 10, marginBottom: 20 }}>
        {[
          { l: 'Brand',       v: row.companyName },
          { l: 'Category',    v: row.category },
          { l: 'Subcategory', v: row.subcategory },
          { l: 'Variant',     v: row.variant },
          { l: 'EAN / Barcode', v: row.ean, mono: true },
          { l: 'HSN',         v: `${row.hsn} · ${row.gstPct}% GST` },
          { l: 'MRP',         v: inr(row.mrp) },
          { l: 'Selling price', v: inr(row.price) },
          { l: 'Weight',      v: `${row.weightGm} g` },
          row.launchedOn && { l: 'Launched', v: fmtDate(row.launchedOn, 'long') },
        ].filter(Boolean).map(f => (
          <div key={f.l} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '9px 11px', background: 'var(--surface-2)' }}>
            <div className="tiny muted">{f.l}</div>
            <div className={f.mono ? 'mono' : 'tnum'} style={{ fontWeight: 600, fontSize: 13.5, marginTop: 2 }}>{f.v}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Platform mapping</div>
      <table className="tbl">
        <thead>
          <tr><th>Platform</th><th>Identifier</th><th>Type</th><th>Seller SKU</th><th>Status</th></tr>
        </thead>
        <tbody>
          {Object.values(row.listings).map(l => {
            const fmt = LISTING_FORMATS[l.channel] ?? { label: 'ID' };
            const st = LISTING_STATES[l.state];
            return (
              <tr key={l.channel}>
                <td>
                  <span className="hstack" style={{ gap: 7 }}>
                    <span className="swatch" style={{ background: channelColor(l.channel) }} />
                    {CHANNEL_BY_ID[l.channel]?.name ?? l.channel}
                  </span>
                </td>
                <td>{l.id ? <span className="mono">{l.id}</span> : <span className="muted">— not created —</span>}</td>
                <td><span className="tiny muted" title={fmt.hint}>{fmt.label}</span></td>
                <td>{l.sellerSku ? <span className="mono tiny">{l.sellerSku}</span> : <span className="muted tiny">—</span>}</td>
                <td><Pill tone={st.tone}>{st.label}</Pill></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}

export default function SkuMaster() {
  const { companyId, today } = useApp();
  const [selected, setSelected] = useState(null);
  const [lookup, setLookup] = useState('');
  const [platform, setPlatform] = useState('all');   // which marketplace's view

  const rows = useMemo(() => masterFor(companyId), [companyId]);
  const health = useMemo(() => mappingHealth(companyId), [companyId]);
  const hit = useMemo(() => (lookup.trim() ? findBySku(lookup) : null), [lookup]);

  const channels = health.byChannel;

  // Only platforms this brand actually sells on, and fall back to the master
  // view if the brand is switched to one that does not carry the platform.
  const available = useMemo(
    () => CHANNELS.filter(c => channelsFor(companyId).includes(c.id)),
    [companyId]
  );
  const view = platform !== 'all' && !available.some(c => c.id === platform) ? 'all' : platform;
  const fmt = LISTING_FORMATS[view];

  const table = useMemo(() => rows
    .map(r => {
      const listing = view === 'all' ? null : (r.listings[view] ?? null);
      return {
        ...r,
        id: r.sku,
        listing,
        mapped: Object.values(r.listings).filter(l => l.state !== 'unmapped').length,
        listingCount: Object.values(r.listings).length,
        // Flattened so the table can sort and search on the platform's values.
        platformId: listing?.id ?? '',
        platformPrice: listing?.price ?? 0,
        fulfilment: listing?.fulfilment ?? '',
        platformCategory: listing?.platformCategory ?? '',
        listingState: listing?.state ?? 'unmapped',
      };
    })
    // A platform view only concerns SKUs that platform is meant to carry.
    .filter(r => view === 'all' || r.listing),
  [rows, view]);

  const masterColumns = [
    { key: 'sku', label: 'Internal SKU', render: r => <span className="mono" style={{ fontWeight: 600 }}>{r.sku}</span> },
    { key: 'productName', label: 'Product', render: r => (
      <span>
        <span style={{ fontWeight: 500 }}>{r.productName}</span>
        <span className="tiny muted" style={{ display: 'block' }}>{r.variant}</span>
      </span>
    )},
    { key: 'category', label: 'Category' },
    { key: 'subcategory', label: 'Subcategory' },
    { key: 'ean', label: 'EAN', render: r => <span className="mono tiny">{r.ean}</span> },
    { key: 'hsn', label: 'HSN', render: r => <span className="tnum">{r.hsn}</span> },
    { key: 'price', label: 'Price', align: 'right', render: r => inr(r.price) },
    { key: 'mapped', label: 'Mapped', align: 'right', render: r => (
      <span className="tnum" style={{ color: r.mapped < r.listingCount ? 'var(--warning-ink)' : 'var(--ink)', fontWeight: 600 }}>
        {r.mapped}/{r.listingCount}
      </span>
    )},
    { key: 'status', label: 'Status', render: r => (
      <Pill tone={MASTER_STATUS[r.status]?.tone ?? 'neutral'} icon={false}>
        {MASTER_STATUS[r.status]?.label ?? r.status}
      </Pill>
    )},
    { key: 'watch', label: '', align: 'right', sortable: false, searchable: false, render: r => (
      <WatchButton
        subject={{
          company: companyId, channel: view === 'all' ? undefined : view,
          category: r.category, subcategory: r.subcategory,
          product: r.productId, sku: r.variantId,
          title: `${r.productName} — ${r.variant}`,
        }}
        iconOnly
      />
    )},
  ];

  /** The platform view: same SKU identity, that marketplace's own attributes. */
  const platformColumns = [
    { key: 'sku', label: 'Internal SKU', render: r => <span className="mono" style={{ fontWeight: 600 }}>{r.sku}</span> },
    { key: 'productName', label: 'Product', render: r => (
      <span>
        <span style={{ fontWeight: 500 }}>{r.productName}</span>
        <span className="tiny muted" style={{ display: 'block' }}>{r.variant}</span>
      </span>
    )},
    { key: 'platformId', label: fmt?.label ?? 'Platform ID', render: r => (
      r.platformId
        ? <span className="mono" title={fmt?.hint}>{r.platformId}</span>
        : <span className="muted tiny">not created</span>
    )},
    { key: 'platformCategory', label: 'Platform category', render: r => (
      <span className="tiny muted">{r.platformCategory || '—'}</span>
    )},
    { key: 'fulfilment', label: 'Fulfilment', render: r => (
      r.fulfilment ? <Pill tone="neutral" icon={false}>{r.fulfilment}</Pill> : <span className="muted tiny">—</span>
    )},
    { key: 'price', label: 'Master price', align: 'right', render: r => <span className="muted">{inr(r.price)}</span> },
    { key: 'platformPrice', label: 'Listed price', align: 'right', render: r => {
      if (!r.listing?.price) return <span className="muted tiny">—</span>;
      const d = r.listing.price - r.price;
      return (
        <span className="tnum">
          {inr(r.listing.price)}
          {Math.abs(d) > 0 && (
            <span className="tiny" style={{ marginLeft: 5, color: d > 0 ? 'var(--good-ink)' : 'var(--critical-ink)' }}>
              {d > 0 ? '+' : '−'}{inr(Math.abs(d))}
            </span>
          )}
        </span>
      );
    }},
    { key: 'listingState', label: 'Listing', render: r => (
      <Pill tone={LISTING_STATES[r.listingState].tone}>{LISTING_STATES[r.listingState].label}</Pill>
    )},
  ];

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>SKU Master</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          One internal SKU per item, with every marketplace identifier mapped against it.
        </p>
        <p className="tiny muted" style={{ margin: '4px 0 0' }}>
          Catalogue state {asAt(today)} — a register, not a period report.
        </p>
      </div>

      {/* Coverage — the number that decides whether sales can be attributed */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(168px,1fr))' }}>
        {[
          { l: 'Internal SKUs',  v: num(health.skuCount) },
          { l: 'Platform listings', v: num(health.totalListings) },
          { l: 'Mapping coverage', v: pct(health.coverage), tone: health.coverage >= 95 ? 'good' : health.coverage >= 88 ? 'warning' : 'critical' },
          { l: 'Unmapped listings', v: num(health.totalUnmapped), tone: health.totalUnmapped > 0 ? 'warning' : 'good' },
          { l: 'ID conflicts',   v: num(health.conflicts.length), tone: health.conflicts.length ? 'critical' : 'good' },
        ].map(k => (
          <div className="kpi" key={k.l} style={{ cursor: 'default' }}>
            <span className="kpi-label">{k.l}</span>
            <span className="kpi-value tnum" style={{
              color: k.tone === 'critical' ? 'var(--critical-ink)' : k.tone === 'warning' ? 'var(--warning-ink)' : 'var(--ink)',
            }}>{k.v}</span>
          </div>
        ))}
      </div>

      {health.totalUnmapped > 0 && (
        <div className="hstack" style={{
          gap: 10, padding: '12px 14px', background: 'var(--warning-soft)',
          border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
          borderRadius: 'var(--radius)',
        }}>
          <AlertTriangle size={17} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--warning-ink)' }}>
              {health.totalUnmapped} listing{health.totalUnmapped === 1 ? '' : 's'} not mapped to an internal SKU
            </div>
            <div className="small" style={{ color: 'var(--warning-ink)', opacity: 0.9 }}>
              Sales arriving under an unmapped identifier cannot be attributed to a product, so they are missing from category and product reporting.
            </div>
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <Card title="Coverage by platform" subtitle="Share of this brand's SKUs with a live listing">
          <div className="vstack" style={{ gap: 12 }}>
            {channels.map(c => (
              <div key={c.channel}>
                <div className="spread" style={{ marginBottom: 5 }}>
                  <span className="hstack" style={{ gap: 7 }}>
                    <span className="swatch" style={{ background: channelColor(c.channel) }} />
                    <span className="small" style={{ fontWeight: 500 }}>{c.channelName}</span>
                  </span>
                  <span className="hstack" style={{ gap: 10 }}>
                    <span className="tiny muted">{c.active}/{c.total} live</span>
                    <span className="tnum small" style={{ fontWeight: 600 }}>{pct(c.coverage)}</span>
                  </span>
                </div>
                <Track value={c.coverage} tone={c.coverage >= 95 ? 'good' : c.coverage >= 85 ? 'warning' : 'critical'} />
                {(c.inactive > 0 || c.unmapped > 0) && (
                  <div className="tiny muted" style={{ marginTop: 3 }}>
                    {c.inactive > 0 && `${c.inactive} inactive`}
                    {c.inactive > 0 && c.unmapped > 0 && ' · '}
                    {c.unmapped > 0 && `${c.unmapped} never created`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Identifier lookup" subtitle="Resolve any marketplace ID, EAN or internal SKU back to the master">
          <div className="search-box" style={{ width: '100%' }}>
            <Search size={14} />
            <input
              className="input" style={{ width: '100%' }}
              placeholder="Paste an ASIN, FSN, style ID, EAN or internal SKU…"
              value={lookup} onChange={e => setLookup(e.target.value)}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            {!lookup.trim() ? (
              <div className="tiny muted">
                A settlement line usually carries only the marketplace identifier. This resolves it to the internal SKU.
              </div>
            ) : hit ? (
              <button className="pop-item" style={{ border: '1px solid var(--border)', width: '100%' }} onClick={() => setSelected(hit)}>
                <Link2 size={15} style={{ color: 'var(--good)' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="mono" style={{ display: 'block', fontWeight: 600 }}>{hit.sku}</span>
                  <span className="tiny muted">{hit.productName} · {hit.variant}</span>
                </span>
              </button>
            ) : (
              <div className="hstack" style={{ gap: 8, color: 'var(--critical-ink)' }}>
                <AlertTriangle size={14} />
                <span className="small">No master record carries that identifier.</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card
        title="Master catalogue"
        subtitle={view === 'all'
          ? 'Select a SKU to see every platform identifier mapped to it'
          : `${CHANNEL_BY_ID[view]?.name} listing detail — identifier, taxonomy, fulfilment and listed price`}
        flush
        actions={
          <Popover
            align="right" width={238}
            trigger={({ toggle }) => (
              <button className="btn btn-sm" onClick={toggle}>
                {view === 'all'
                  ? <><Store size={13} /> All platforms</>
                  : <><span className="swatch" style={{ background: channelColor(view) }} />{CHANNEL_BY_ID[view]?.name}</>}
                <ChevronDown size={13} style={{ opacity: 0.6 }} />
              </button>
            )}
          >
            {({ close }) => (
              <>
                <div className="pop-label">Show details for</div>
                <button className={`pop-item${view === 'all' ? ' on' : ''}`} onClick={() => { setPlatform('all'); close(); }}>
                  <Store size={15} />
                  <span style={{ flex: 1 }}>
                    All platforms
                    <span className="tiny muted" style={{ display: 'block' }}>Master attributes</span>
                  </span>
                  {view === 'all' && <Check size={14} />}
                </button>
                <div className="pop-sep" />
                {available.map(c => (
                  <button key={c.id} className={`pop-item${view === c.id ? ' on' : ''}`} onClick={() => { setPlatform(c.id); close(); }}>
                    <span className="swatch" style={{ background: channelColor(c.id), width: 10, height: 10 }} />
                    <span style={{ flex: 1 }}>
                      {c.name}
                      <span className="tiny muted" style={{ display: 'block' }}>{LISTING_FORMATS[c.id]?.label ?? 'Listing ID'}</span>
                    </span>
                    {view === c.id && <Check size={14} />}
                  </button>
                ))}
              </>
            )}
          </Popover>
        }
      >
        <DataTable
          pageSize={14}
          searchKeys={['sku', 'productName', 'category', 'subcategory', 'variant', 'ean', 'platformId', 'fulfilment']}
          columns={view === 'all' ? masterColumns : platformColumns}
          rows={table}
          initialSort={{ key: 'sku', dir: 'asc' }}
          onRowClick={setSelected}
          emptyText="No SKUs for this brand"
        />
      </Card>

      {health.gaps.length > 0 && (
        <Card title="Mapping gaps" subtitle="SKUs missing a listing on at least one platform" flush>
          <DataTable
            searchable={false} pageSize={8}
            columns={[
              { key: 'sku', label: 'Internal SKU', render: r => <span className="mono">{r.sku}</span> },
              { key: 'productName', label: 'Product' },
              { key: 'variant', label: 'Variant' },
              { key: 'missing', label: 'Missing on', sortable: false, render: r => (
                <span className="hstack" style={{ gap: 5, flexWrap: 'wrap' }}>
                  {r.missing.map(c => (
                    <span className="chan-chip" key={c}>
                      <span className="swatch" style={{ background: channelColor(c) }} />
                      {CHANNEL_BY_ID[c]?.name ?? c}
                    </span>
                  ))}
                </span>
              )},
            ]}
            rows={health.gaps.map(g => ({ ...g, id: g.sku }))}
            emptyText="Every SKU is mapped on every platform"
          />
        </Card>
      )}

      {selected && <SkuDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
