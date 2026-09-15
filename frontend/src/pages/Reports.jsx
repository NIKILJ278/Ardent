import { useMemo, useState } from 'react';
import { FileText, Download, Filter, Building2, Calendar, Lock } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { REPORT_CATALOG } from '../data/business.js';
import { COMPANY_BY_ID } from '../data/catalog.js';
import { DATA_RANGE } from '../data/engine.js';
import { buildExport, canExport } from '../data/exports.js';
import { exportCsv, exportMeta } from '../lib/csv.js';
import { fmtDate, periodLabel, periodRange, periodDays, num } from '../lib/format.js';
import { Card, Pill, DataTable, Segmented } from '../components/ui/index.jsx';
import { PeriodPicker } from '../components/shell/Shell.jsx';

const GROUPS = ['All', 'Sales', 'Finance', 'Reconciliation', 'Goals', 'Source Reports'];

export default function Reports() {
  const { companyId, period, scope, can, goals } = useApp();
  const [group, setGroup] = useState('All');
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const ctx = useMemo(
    () => ({ scope, period, can, goals, companyId }),
    [scope, period, can, goals, companyId]
  );

  const rows = useMemo(
    () => REPORT_CATALOG.filter(r => group === 'All' || r.group === group),
    [group]
  );

  // Row counts are what a download would actually contain for the current
  // period. An empty report should be visible before it is downloaded, not
  // discovered afterwards in a file holding nothing but a header row.
  const sizes = useMemo(() => {
    const out = {};
    for (const r of REPORT_CATALOG) {
      if (!canExport(r.id, can)) { out[r.id] = null; continue; }
      try { out[r.id] = buildExport(r.id, ctx)?.rows.length ?? 0; }
      catch { out[r.id] = 0; }
    }
    return out;
  }, [ctx, can]);

  const download = (r) => {
    setBusy(r.id);
    try {
      const built = buildExport(r.id, ctx);
      if (!built || built.rows.length === 0) {
        setNote(`${r.name} has no rows for ${periodRange(period)}. Widen the date range and try again.`);
        return;
      }
      exportCsv({
        name: built.name,
        headers: built.headers,
        rows: built.rows,
        company: COMPANY_BY_ID[companyId]?.name ?? companyId,
        period,
        meta: exportMeta({
          title: built.name,
          company: companyId === 'all' ? 'All brands' : COMPANY_BY_ID[companyId]?.name,
          period,
          channel: built.channel
            ? `${built.channel} only (source report)`
            : (scope.channel ?? 'All channels'),
          extra: { Rows: built.rows.length },
        }),
      });
      setNote(`${built.name} downloaded — ${num(built.rows.length)} rows covering ${periodRange(period)}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Reports</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            Ardent's processed reports and the untouched source files from each platform.
          </p>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            Every download covers the period set here — {periodLabel(period)} ·{' '}
            {periodRange(period)} · {periodDays(period)} days.
          </p>
        </div>
        {/* The same period control as the header, put where the downloading
            happens so the range never has to be set on another screen. */}
        <PeriodPicker />
      </div>

      <div className="hstack" style={{
        gap: 9, padding: '10px 13px', background: 'var(--surface-2)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)', flexWrap: 'wrap',
      }}>
        <Filter size={14} className="muted" />
        <span className="small muted">Exports apply</span>
        <Pill tone="info" icon={false}>
          <Building2 size={11} />
          {companyId === 'all' ? 'All Brands' : COMPANY_BY_ID[companyId]?.name}
        </Pill>
        <Pill tone="neutral" icon={false}>
          <Calendar size={11} />
          {fmtDate(period.start, 'long')} — {fmtDate(period.end, 'long')}
        </Pill>
        {scope.channel && <Pill tone="neutral" icon={false}>{scope.channel}</Pill>}
        <span className="small muted">
          and any filters set on the page you exported from. Data available{' '}
          {fmtDate(DATA_RANGE.start, 'long')} to {fmtDate(DATA_RANGE.end, 'long')}.
        </span>
      </div>

      {note && (
        <div className="hstack" style={{
          gap: 9, padding: '9px 13px', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', background: 'var(--surface)',
        }}>
          <Download size={14} className="muted" />
          <span className="small">{note}</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setNote(null)}>
            Dismiss
          </button>
        </div>
      )}

      <Segmented options={GROUPS.map(g => ({ id: g, label: g }))} value={group} onChange={setGroup} />

      <Card flush>
        <DataTable
          columns={[
            {
              key: 'name', label: 'Report',
              render: r => (
                <span className="hstack" style={{ gap: 10 }}>
                  <FileText size={15} style={{ color: r.origin === 'ardent' ? 'var(--accent)' : 'var(--ink-3)' }} />
                  <span>
                    <span className="small" style={{ fontWeight: 500, display: 'block' }}>{r.name}</span>
                    <span className="tiny muted">
                      {r.origin === 'ardent' ? 'Generated by Ardent' : `Source file · ${r.origin}`}
                    </span>
                  </span>
                </span>
              ),
            },
            { key: 'group', label: 'Category', render: r => <Pill tone="neutral" icon={false}>{r.group}</Pill> },
            {
              key: 'covers', label: 'Covers', sortable: false,
              render: () => (
                <span className="tiny muted">
                  {fmtDate(period.start)} – {fmtDate(period.end, 'long')}
                </span>
              ),
            },
            {
              key: 'size', label: 'Rows', align: 'right',
              sortValue: r => sizes[r.id] ?? -1,
              render: r => (
                sizes[r.id] == null
                  ? (
                    <span className="tiny muted hstack" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <Lock size={10} /> restricted
                    </span>
                  )
                  : (
                    <span className="tnum" style={{ color: sizes[r.id] ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {sizes[r.id] ? num(sizes[r.id]) : 'none'}
                    </span>
                  )
              ),
            },
            {
              key: 'formats', label: 'Download', align: 'right', sortable: false,
              render: r => (
                <span className="hstack" style={{ gap: 5, justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-sm"
                    disabled={busy === r.id || sizes[r.id] == null || !sizes[r.id]}
                    title={
                      sizes[r.id] == null ? 'Your role cannot see these figures'
                        : !sizes[r.id] ? 'No rows in the selected date range'
                          : `Download ${num(sizes[r.id])} rows for ${periodRange(period)}`
                    }
                    onClick={e => { e.stopPropagation(); download(r); }}
                  >
                    <Download size={11} /> {busy === r.id ? '…' : 'CSV'}
                  </button>
                </span>
              ),
            },
          ]}
          rows={rows}
          pageSize={14}
          searchKeys={['name', 'group', 'origin']}
        />
      </Card>

      <p className="tiny muted" style={{ margin: 0 }}>
        Files open in Excel and Google Sheets. Each one starts with a header block naming the
        entity, the exact date range and the filters it was taken under, so the extract still
        explains itself once it has left Ardent.
      </p>
    </div>
  );
}
