import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api } from '../../lib/api.js';
import { downloadCsv, toCsv } from '../../lib/csv.js';
import { Card, DataTable } from '../ui/index.jsx';

/**
 * The SKU master's tax and category details, filled from a sheet.
 *
 * Nobody has every field for every SKU on day one, so every column is optional
 * and a blank cell leaves what is already saved alone. Bad cells are reported
 * by row and reason; the good rows are still applied.
 */
export function SkuSheet({ brandId, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const input = useRef(null);

  const load = useCallback(() => (
    api.get(`/api/brands/${brandId}/gst/skus`)
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e.message))
  ), [brandId]);

  useEffect(() => { load(); }, [load]);

  const template = () => {
    // Pre-filled with every SKU that has sold and what is already saved, so
    // the sheet only needs the gaps completed.
    const csv = toCsv({
      headers: ['SKU', 'Product', 'Category', 'HSN', 'GST rate (%)'],
      rows: (data?.skus ?? []).map(s => [
        s.sku, [s.name, s.variant].filter(Boolean).join(' — '), s.category ?? '', s.hsn ?? '', s.gstRate ?? '',
      ]),
    });
    downloadCsv('sku-master-template.csv', csv);
  };

  const send = async (file) => {
    if (!file) return;
    setBusy(true); setResult(null); setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      setResult(await api.upload(`/api/brands/${brandId}/gst/skus/import`, form));
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const total = data?.total ?? 0;
  return (
    <Card
      title="GST and category details"
      subtitle="Category, HSN and GST rate for each SKU — upload a sheet, fill only what you have"
      actions={(
        <span className="hstack" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={template} disabled={!data}><Download size={12} /> Download sheet</button>
          <button className="btn btn-sm btn-primary" onClick={() => input.current?.click()} disabled={busy}>
            <Upload size={12} /> {busy ? 'Uploading…' : 'Upload sheet'}
          </button>
          <input ref={input} type="file" accept=".csv,.xlsx,.xlsm" hidden onChange={e => send(e.target.files?.[0])} />
        </span>
      )}
    >
      <div className="vstack" style={{ gap: 12 }}>
        {error && <div role="alert" style={{ color: 'var(--critical, #c0392b)' }}>{error}</div>}

        {data && (
          <div className="small">
            <strong>{data.complete}</strong> of <strong>{total}</strong> SKUs have category, HSN and rate.
            {total > data.complete && <span className="muted"> The rest are estimated at your default rate on the GST page.</span>}
          </div>
        )}

        {result && (
          <div className="small" role="status" style={{ padding: '8px 10px', borderRadius: 'var(--radius)', background: 'var(--surface-2)' }}>
            Saved: <strong>{result.created}</strong> added, <strong>{result.updated}</strong> updated.
            {result.skippedCount > 0 && (
              <div style={{ marginTop: 6 }}>
                <strong>{result.skippedCount}</strong> row(s) not saved:
                <ul style={{ margin: '4px 0 0 18px' }}>
                  {result.skipped.slice(0, 8).map(s => <li key={`${s.row}-${s.sku}`}>Row {s.row} ({s.sku}): {s.reason}</li>)}
                </ul>
              </div>
            )}
            {result.notInOrders?.length > 0 && (
              <div className="muted" style={{ marginTop: 6 }}>
                Saved, but not seen on any order yet: {result.notInOrders.slice(0, 8).join(', ')}
                {result.notInOrdersCount > 8 && ` and ${result.notInOrdersCount - 8} more`}. Check for typos.
              </div>
            )}
          </div>
        )}

        <div className="tiny muted" style={{ lineHeight: 1.5 }}>
          Columns: <strong>SKU</strong> (required), <strong>Category</strong>, <strong>HSN</strong> (4, 6 or 8 digits),
          <strong> GST rate</strong> (18, 18% or 0.18 all mean 18%). A blank cell keeps what is already saved.
        </div>

        {data && total > 0 && (
          <DataTable
            searchable pageSize={10}
            rows={data.skus.map(s => ({ ...s, id: s.sku }))}
            columns={[
              { key: 'sku', label: 'SKU', term: false },
              { key: 'name', label: 'Product', term: false, render: r => [r.name, r.variant].filter(Boolean).join(' — ') || <span className="muted">—</span> },
              { key: 'category', label: 'Category', term: false, render: r => r.category ?? <span className="muted">not set</span> },
              { key: 'hsn', label: 'HSN', term: false, render: r => r.hsn ?? <span className="muted">not set</span> },
              { key: 'gstRate', label: 'GST rate', align: 'right', term: false,
                render: r => (r.gstRate == null ? <span className="muted">not set</span> : `${r.gstRate}%`) },
            ]}
          />
        )}
      </div>
    </Card>
  );
}
