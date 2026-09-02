import { useEffect, useState } from 'react';
import { useBrand } from '../../context/BrandContext';
import { listReports, saveReport, runReport, deleteReport, exportReportUrl } from '../../api/reports';
import PageHeader from '../../components/ui/PageHeader';
import Spinner from '../../components/ui/Spinner';
import { FileText, Play, Trash2, Download, Plus, Star } from 'lucide-react';

const REPORT_TYPES = [
  { value: 'channel_profitability',  label: 'Channel Profitability' },
  { value: 'gross_to_net_waterfall', label: 'Gross-to-Net Waterfall' },
  { value: 'sku_profit_pareto',      label: 'SKU Profit Pareto' },
  { value: 'state_action_matrix',    label: 'RTO State Matrix' },
  { value: 'campaign_performance',   label: 'Campaign Performance' },
  { value: 'inventory_health',       label: 'Inventory Health' },
];

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function Reports() {
  const { activeBrand } = useBrand();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', report_type: 'channel_profitability', days: 30, is_favourite: false });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(null);

  const load = () => {
    if (!activeBrand) return;
    setLoading(true);
    listReports(activeBrand.id).then(r => setReports(r.data.data || [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, [activeBrand]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      await saveReport(activeBrand.id, {
        name: form.name || REPORT_TYPES.find(t => t.value === form.report_type)?.label,
        report_type: form.report_type,
        filters: { days: Number(form.days) },
        is_favourite: form.is_favourite,
      });
      setShowModal(false);
      setForm({ name: '', report_type: 'channel_profitability', days: 30, is_favourite: false });
      load();
    } catch { /* backend surfaces error */ }
  };

  const handleRun = async (id) => {
    setRunning(id);
    setResult(null);
    try {
      const r = await runReport(activeBrand.id, id);
      setResult(r.data.data);
    } catch { /* ignore */ } finally { setRunning(null); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this saved report?')) return;
    await deleteReport(activeBrand.id, id);
    if (result?.report?.id === id) setResult(null);
    load();
  };

  const download = (id) => {
    const token = localStorage.getItem('access_token');
    fetch(`${API_BASE}${exportReportUrl(activeBrand.id, id)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'report.csv'; a.click();
        window.URL.revokeObjectURL(url);
      });
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Save, run and export analytics snapshots"
        actions={<button className="btn btn-primary btn-sm d-flex align-items-center gap-1" onClick={() => setShowModal(true)}><Plus size={15} /> New Report</button>}
      />

      {loading ? <Spinner center /> : (
        <div className="row g-3">
          <div className="col-12 col-xl-5">
            <div className="card">
              <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Saved Reports</span></div>
              <div className="card-body p-0">
                {reports.length === 0 ? (
                  <div className="text-center py-5" style={{ color: 'var(--color-muted-fg)' }}>
                    <FileText size={36} style={{ marginBottom: 8 }} />
                    <p style={{ fontSize: '0.875rem' }}>No saved reports yet.</p>
                  </div>
                ) : reports.map(rep => (
                  <div key={rep.id} className="d-flex align-items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <FileText size={18} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {rep.name}
                        {rep.is_favourite && <Star size={13} fill="var(--color-accent)" color="var(--color-accent)" />}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-muted-fg)' }}>{rep.report_type}</div>
                    </div>
                    <button className="btn btn-outline-primary btn-sm py-0 px-2" onClick={() => handleRun(rep.id)} disabled={running === rep.id} title="Run"><Play size={13} /></button>
                    <button className="btn btn-outline-secondary btn-sm py-0 px-2" onClick={() => download(rep.id)} title="Export CSV"><Download size={13} /></button>
                    <button className="btn btn-outline-secondary btn-sm py-0 px-2" onClick={() => handleDelete(rep.id)} title="Delete"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col-12 col-xl-7">
            <div className="card">
              <div className="card-header"><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Result{result ? ` — ${result.report?.name}` : ''}</span></div>
              <div className="card-body">
                {!result ? (
                  <div className="text-center py-5" style={{ color: 'var(--color-muted-fg)', fontSize: '0.875rem' }}>Run a report to see results here.</div>
                ) : (
                  <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--color-text)', maxHeight: 460, overflow: 'auto', margin: 0, background: 'var(--color-muted)', padding: 12, borderRadius: 'var(--radius)' }}>
                    {JSON.stringify(result.results, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 2000 }} onClick={() => setShowModal(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
              <div className="modal-header" style={{ borderColor: 'var(--color-border)' }}>
                <h5 className="modal-title" style={{ color: 'var(--color-text)' }}>New Report</h5>
                <button className="btn-close" onClick={() => setShowModal(false)} />
              </div>
              <form onSubmit={handleSave}>
                <div className="modal-body d-flex flex-column gap-3">
                  <div>
                    <label className="form-label">Report Name</label>
                    <input className="form-control" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Optional custom name" />
                  </div>
                  <div>
                    <label className="form-label">Report Type</label>
                    <select className="form-select" value={form.report_type} onChange={e => setForm(p => ({ ...p, report_type: e.target.value }))}>
                      {REPORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Period (days)</label>
                    <input type="number" className="form-control" value={form.days} onChange={e => setForm(p => ({ ...p, days: e.target.value }))} min={1} />
                  </div>
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="fav" checked={form.is_favourite} onChange={e => setForm(p => ({ ...p, is_favourite: e.target.checked }))} />
                    <label className="form-check-label" htmlFor="fav" style={{ color: 'var(--color-text)', fontSize: '0.875rem' }}>Mark as favourite</label>
                  </div>
                </div>
                <div className="modal-footer" style={{ borderColor: 'var(--color-border)' }}>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm">Save Report</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
