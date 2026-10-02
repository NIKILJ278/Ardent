import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, AlertTriangle } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { api } from '../lib/api.js';
import { computeGst } from '../data/gst.js';
import { COMPANY_BY_ID } from '../data/catalog.js';
import { money, moneyExact, iso } from '../lib/format.js';
import { exportCsv, exportMeta } from '../lib/csv.js';
import { Card, DataTable, Term } from '../components/ui/index.jsx';

const monthName = (m) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

const Note = ({ children, tone }) => (
  <div role="note" style={{
    display: 'flex', gap: 10, padding: '10px 12px', border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius)', background: 'var(--surface-2)', fontSize: 12.5, lineHeight: 1.5,
    ...(tone === 'warn' ? { borderColor: 'var(--warning, #b7791f)' } : {}),
  }}>
    <AlertTriangle size={15} style={{ flex: 'none', marginTop: 2 }} />
    <span>{children}</span>
  </div>
);

/** GSTIN and the fallback rate. Both optional; both checked by the server. */
function Setup({ brandId, settings, onSaved }) {
  const [gstin, setGstin] = useState(settings.gstin ?? '');
  const [rate, setRate] = useState(settings.defaultRate ?? '');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true); setErr(null); setSaved(false);
    try {
      await api.put(`/api/brands/${brandId}/gst/settings`, { gstin, defaultRate: rate === '' ? null : Number(rate) });
      setSaved(true);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Card title="Your GST details" subtitle="Both are optional — the report says what each one unlocks">
      <div className="vstack" style={{ gap: 10 }}>
        <div className="hstack" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="tiny muted">Business GSTIN — sets your home state for CGST/SGST vs IGST</span>
            <input className="input" style={{ width: 210, textTransform: 'uppercase' }} maxLength={15}
              placeholder="29ABCDE1234F1Z5" value={gstin} onChange={e => setGstin(e.target.value)} aria-label="GSTIN" />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="tiny muted">Default GST rate — for SKUs with no rate of their own</span>
            <span className="hstack" style={{ gap: 6 }}>
              <input className="input" type="number" min="0" max="40" step="0.5" style={{ width: 90 }}
                value={rate} onChange={e => setRate(e.target.value)} aria-label="Default GST rate" placeholder="e.g. 5" />
              <span className="tiny muted">%</span>
            </span>
          </label>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
        {settings.stateName && <div className="tiny muted">Home state: <strong>{settings.stateName}</strong> ({settings.stateCode})</div>}
        {err && <div role="alert" className="small" style={{ color: 'var(--critical, #c0392b)' }}>{err}</div>}
        {saved && !err && <div role="status" className="small">Saved.</div>}
      </div>
    </Card>
  );
}

export default function Gst() {
  const { companyId, period } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => (
    api.get(`/api/brands/${companyId}/gst`)
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message || 'Could not load GST data'))
  ), [companyId]);

  useEffect(() => { load(); }, [load]);

  const span = useMemo(() => ({ start: iso(period.start), end: iso(period.end) }), [period]);
  const rate = data?.settings.defaultRate ?? null;
  const g = useMemo(
    () => (data ? computeGst(data.rows, data.recorded, rate, span) : null),
    [data, rate, span],
  );

  const download = () => {
    const company = COMPANY_BY_ID[companyId]?.name ?? companyId;
    exportCsv({
      name: 'GST estimate',
      headers: ['Month', 'Taxable value', 'Estimated GST', 'CGST', 'SGST', 'IGST', 'Unallocated', 'Invoice value', 'Recorded by Shopify'],
      rows: g.months.map(m => [monthName(m.key), m.taxable, m.gst, m.cgst, m.sgst, m.igst, m.unallocated, m.invoice, m.recorded]),
      company, period,
      meta: exportMeta({
        title: 'GST estimate', company, period,
        extra: {
          'Default rate': rate == null ? 'none' : `${rate}%`,
          'SKUs on their own rate': `${g.coverage.ownRatePct.toFixed(0)}% of value`,
          Status: 'Estimate — not a filing',
        },
      }),
    });
  };

  const c = g?.coverage;
  const split = g && (g.total.cgst || g.total.sgst || g.total.igst);
  const statesPct = data?.orderCount ? Math.round((data.statesKnown / data.orderCount) * 100) : 0;

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>GST</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Output tax estimated from your orders and SKU Master — for planning, not for filing.
        </p>
      </div>

      {error && <Card><div role="alert">Couldn't load GST data: {error}</div></Card>}
      {!data && !error && <Card><div className="muted">Working out GST from your orders…</div></Card>}

      {data && <Setup key={`${data.settings.gstin}|${data.settings.defaultRate}`} brandId={companyId} settings={data.settings} onSaved={load} />}

      {data && rate == null && (
        <Note tone="warn">
          No default rate is set, so only SKUs with their own rate carry GST here.
          Set a default rate above (or fill rates in the <Link to="/sku-master">SKU Master</Link>) to estimate the rest.
        </Note>
      )}

      {g && c.total > 0 && (
        <Note tone={c.ownRatePct < 50 ? 'warn' : undefined}>
          <span>
            <strong>{c.ownRatePct.toFixed(0)}%</strong> of sales value uses a rate you provided for that SKU.
            {c.defaulted > 0 && <> <strong>{money(c.defaulted)}</strong> is estimated at the default {rate}%.</>}
            {c.unrated > 0 && <> <strong>{money(c.unrated)}</strong> has no rate at all and is not in the totals.</>}
            {data.unmappedSkuCount > 0 && <> {data.unmappedSkuCount} SKU(s) still need a rate — add them in the <Link to="/sku-master">SKU Master</Link>.</>}
            {data.noSkuValue !== 0 && <> {money(data.noSkuValue)} is on order lines with no SKU, which can't be matched.</>}
          </span>
        </Note>
      )}

      {data && (
        <Note>
          {data.settings.stateCode
            ? <>Home state <strong>{data.settings.stateName}</strong>. Customer state is known for <strong>{statesPct}%</strong> of orders{statesPct < 100 ? '; the rest sit under “Unallocated” until orders are re-synced with a ship-to state.' : '.'}</>
            : <>Add your GSTIN above to split GST into CGST + SGST (same state) and IGST (other states). Until then it is one total.</>}
          {' '}Input credit and filing status need purchase invoices and your GST portal, so they are not on this page.
        </Note>
      )}

      {g && (
        <>
          <div className="ad-kpis">
            <div className="ad-kpi">
              <span className="ad-kpi-label"><Term k="taxableValue">Taxable value</Term></span>
              <span className="ad-kpi-value tnum">{money(g.total.taxable)}</span>
              <span className="ad-kpi-sub muted">sales before GST, net of discounts and returns</span>
            </div>
            <div className="ad-kpi">
              <span className="ad-kpi-label"><Term k="estGst">Estimated GST</Term></span>
              <span className="ad-kpi-value tnum">{money(g.total.gst)}</span>
              <span className="ad-kpi-sub muted">{rate == null ? 'SKUs with their own rate only' : `SKU rates, else ${rate}%`}</span>
            </div>
            {split ? (
              <>
                <div className="ad-kpi">
                  <span className="ad-kpi-label"><Term k="cgstSgst">CGST + SGST</Term></span>
                  <span className="ad-kpi-value tnum">{money(g.total.cgst + g.total.sgst)}</span>
                  <span className="ad-kpi-sub muted">customers in {data.settings.stateName}</span>
                </div>
                <div className="ad-kpi">
                  <span className="ad-kpi-label"><Term k="igst">IGST</Term></span>
                  <span className="ad-kpi-value tnum">{money(g.total.igst)}</span>
                  <span className="ad-kpi-sub muted">customers in other states</span>
                </div>
              </>
            ) : null}
            {g.total.unallocated > 0 && (
              <div className="ad-kpi">
                <span className="ad-kpi-label"><Term k="unallocated">Unallocated</Term></span>
                <span className="ad-kpi-value tnum">{money(g.total.unallocated)}</span>
                <span className="ad-kpi-sub muted">state or GSTIN not known</span>
              </div>
            )}
            <div className="ad-kpi">
              <span className="ad-kpi-label"><Term k="recordedTax">Tax Shopify recorded</Term></span>
              <span className="ad-kpi-value tnum">{money(g.recordedTax)}</span>
              <span className="ad-kpi-sub muted">what the store itself charged</span>
            </div>
          </div>

          <Card
            title="By month" subtitle="GST is returned monthly, so this is the view a filing follows" flush
            actions={<button className="btn btn-sm" onClick={download}><Download size={12} /> Download CSV</button>}
          >
            <DataTable
              searchable={false} pageSize={24} initialSort={{ key: 'key', dir: 'desc' }}
              rows={g.months.map(m => ({ ...m, id: m.key }))}
              emptyText="No orders in this period"
              columns={[
                { key: 'key', label: 'Month', term: false, render: r => monthName(r.key) },
                { key: 'taxable', label: 'Taxable value', align: 'right', term: false, render: r => moneyExact(r.taxable) },
                { key: 'cgst', label: 'CGST', align: 'right', term: false, render: r => (r.cgst ? moneyExact(r.cgst) : <span className="muted">—</span>) },
                { key: 'sgst', label: 'SGST', align: 'right', term: false, render: r => (r.sgst ? moneyExact(r.sgst) : <span className="muted">—</span>) },
                { key: 'igst', label: 'IGST', align: 'right', term: false, render: r => (r.igst ? moneyExact(r.igst) : <span className="muted">—</span>) },
                { key: 'unallocated', label: 'Unallocated', align: 'right', term: false, render: r => (r.unallocated ? moneyExact(r.unallocated) : <span className="muted">—</span>) },
                { key: 'gst', label: 'Total GST', align: 'right', term: false, render: r => <strong>{moneyExact(r.gst)}</strong> },
                { key: 'recorded', label: 'Recorded by Shopify', align: 'right', term: false,
                  render: r => (r.recorded ? moneyExact(r.recorded) : <span className="muted">—</span>) },
              ]}
            />
          </Card>

          <Card title="HSN summary" subtitle="One line per HSN code and rate, as GSTR-1 asks. “Estimated” = the default rate was used." flush>
            <DataTable
              searchable={false} pageSize={20} initialSort={{ key: 'taxable', dir: 'desc' }}
              rows={g.hsn.map(h => ({ ...h, id: h.key }))}
              emptyText="No orders in this period"
              columns={[
                { key: 'hsn', label: 'HSN', term: false, render: r => r.hsn ?? <span className="muted">not set</span> },
                { key: 'rate', label: 'Rate', align: 'right', term: false,
                  render: r => <span>{r.rate}%{r.estimated && <span className="tiny muted"> estimated</span>}</span> },
                { key: 'taxable', label: 'Taxable value', align: 'right', term: false, render: r => moneyExact(r.taxable) },
                { key: 'gst', label: 'GST', align: 'right', term: false, render: r => <strong>{moneyExact(r.gst)}</strong> },
              ]}
            />
          </Card>

          <Card title="By category" subtitle="From your SKU Master where set, otherwise the store's product type" flush>
            <DataTable
              searchable={false} pageSize={20} initialSort={{ key: 'gst', dir: 'desc' }}
              rows={g.categories.map(x => ({ ...x, id: x.key }))}
              emptyText="No orders in this period"
              columns={[
                { key: 'key', label: 'Category', term: false },
                { key: 'taxable', label: 'Taxable value', align: 'right', term: false, render: r => moneyExact(r.taxable) },
                { key: 'gst', label: 'Estimated GST', align: 'right', term: false, render: r => <strong>{moneyExact(r.gst)}</strong> },
              ]}
            />
          </Card>

          {data.unmappedSkus.length > 0 && (
            <Card title="Biggest SKUs still without a rate" subtitle="Fill these first — they move the estimate most" flush>
              <DataTable
                searchable={false} pageSize={10}
                rows={data.unmappedSkus.map(s => ({ ...s, id: s.sku }))}
                columns={[
                  { key: 'sku', label: 'SKU', term: false },
                  { key: 'name', label: 'Product', term: false },
                  { key: 'net', label: 'Sales value', align: 'right', term: false, render: r => moneyExact(r.net) },
                ]}
              />
              <div className="tiny muted" style={{ padding: '8px 14px' }}>
                Add them in the <Link to="/sku-master">SKU Master</Link> by uploading a sheet.
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
