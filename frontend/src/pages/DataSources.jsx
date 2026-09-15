import { useMemo, useState, useRef } from 'react';
import {
  UploadCloud, RefreshCw, Plug, FileSpreadsheet, CheckCircle2,
  AlertTriangle, Download, X,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { dataSources, SOURCE_STATUS, REPORT_CATALOG } from '../data/business.js';
import { num, relativeTime, fmtDate } from '../lib/format.js';
import { Card, Pill, Track } from '../components/ui/index.jsx';

const PIPELINE = ['Uploading', 'Processing', 'Validating', 'Duplicate check', 'Imported'];

/* ── Upload flow ───────────────────────────────────────────────────────── */

function UploadPanel() {
  const [over, setOver] = useState(false);
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState(-1);
  const [dupes, setDupes] = useState(null);
  const inputRef = useRef(null);

  const start = (f) => {
    if (!f) return;
    setFile(f);
    setDupes(null);
    setStage(0);
    // Walk the pipeline so the CEO can see exactly what happens to their file.
    let i = 0;
    const tick = () => {
      i += 1;
      if (i < PIPELINE.length) {
        setStage(i);
        // Pause at the duplicate-check step to surface a real decision.
        if (i === 3) {
          setTimeout(() => setDupes(342), 620);
          return;
        }
        setTimeout(tick, 620);
      }
    };
    setTimeout(tick, 620);
  };

  const proceed = () => {
    setDupes(null);
    setStage(PIPELINE.length - 1);
  };
  const reset = () => { setFile(null); setStage(-1); setDupes(null); };

  return (
    <Card title="Upload data" subtitle="For sources without an API — bank statements, marketplace exports">
      {stage < 0 ? (
        <div
          className={`drop${over ? ' over' : ''}`}
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); start(e.dataTransfer.files?.[0]); }}
        >
          <UploadCloud size={30} strokeWidth={1.5} style={{ color: 'var(--ink-3)' }} />
          <div style={{ fontWeight: 600, marginTop: 10, fontSize: 14 }}>Drag & drop your file here</div>
          <div className="small muted" style={{ margin: '4px 0 14px' }}>or</div>
          <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>Choose file</button>
          <input
            ref={inputRef} type="file" hidden accept=".csv,.xlsx,.xls,.pdf"
            onChange={e => start(e.target.files?.[0])}
          />
          <div className="tiny muted" style={{ marginTop: 14 }}>Supported: CSV · XLSX · PDF — up to 50 MB</div>
        </div>
      ) : (
        <div>
          <div className="spread" style={{ marginBottom: 14 }}>
            <span className="hstack" style={{ gap: 9 }}>
              <FileSpreadsheet size={18} style={{ color: 'var(--accent)' }} />
              <span>
                <span style={{ fontWeight: 600, fontSize: 13.5, display: 'block' }}>{file?.name}</span>
                <span className="tiny muted">{file ? `${(file.size / 1024).toFixed(0)} KB` : ''}</span>
              </span>
            </span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={reset} aria-label="Cancel"><X size={14} /></button>
          </div>

          <div className="steps">
            {PIPELINE.map((s, i) => (
              <span key={s} className="hstack" style={{ gap: 0 }}>
                <span className={`step${i < stage ? ' done' : i === stage ? ' active' : ''}`}>
                  <span className="bead">{i < stage ? <CheckCircle2 size={12} /> : i + 1}</span>
                  <span>{s}</span>
                </span>
                {i < PIPELINE.length - 1 && <span className="step-line" />}
              </span>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <Track value={((stage + 1) / PIPELINE.length) * 100} tone={stage >= PIPELINE.length - 1 ? 'good' : 'accent'} />
          </div>

          {dupes && (
            <div style={{
              marginTop: 14, padding: '12px 14px', borderRadius: 'var(--radius)',
              background: 'var(--warning-soft)',
              border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
            }}>
              <div className="hstack" style={{ gap: 9 }}>
                <AlertTriangle size={16} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--warning-ink)' }}>
                    Possible duplicate data detected
                  </div>
                  <div className="small" style={{ color: 'var(--warning-ink)', opacity: 0.9 }}>
                    {num(dupes)} transactions appear to already exist in Ardent. Importing again would double-count them.
                  </div>
                </div>
              </div>
              <div className="hstack" style={{ gap: 8, marginTop: 11 }}>
                <button className="btn btn-sm" onClick={proceed}>Review duplicates</button>
                <button className="btn btn-sm" onClick={proceed}>Skip duplicates & import</button>
                <button className="btn btn-ghost btn-sm" onClick={reset}>Cancel upload</button>
              </div>
            </div>
          )}

          {stage >= PIPELINE.length - 1 && !dupes && (
            <div className="hstack" style={{
              gap: 9, marginTop: 14, padding: '11px 13px',
              background: 'var(--good-soft)', borderRadius: 'var(--radius)',
            }}>
              <CheckCircle2 size={16} style={{ color: 'var(--good-ink)' }} />
              <span className="small" style={{ color: 'var(--good-ink)', fontWeight: 500 }}>
                Import complete — reconciliation and dashboards have been refreshed.
              </span>
              <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={reset}>Upload another</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function DataSources() {
  const { companyId } = useApp();
  const [syncing, setSyncing] = useState(null);
  const sources = useMemo(() => dataSources(companyId), [companyId]);
  const sourceReports = REPORT_CATALOG.filter(r => r.group === 'Source Reports');

  const sync = (id) => {
    setSyncing(id);
    setTimeout(() => setSyncing(null), 1100);
  };

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Data Sources</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Where every number in Ardent comes from, and how fresh it is.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        {sources.map(s => {
          const st = SOURCE_STATUS[s.status];
          return (
            <div className="card2" key={s.id}>
              <div className="card2-body">
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div className="hstack" style={{ gap: 10, minWidth: 0 }}>
                    <span className="avatar" style={{ borderRadius: 8, background: 'var(--surface-3)' }}>
                      <Plug size={14} style={{ color: 'var(--ink-2)' }} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.name}</div>
                      <div className="tiny muted">{s.kind} · {num(s.records)} records</div>
                    </div>
                  </div>
                  <Pill tone={st.tone}>{st.label}</Pill>
                </div>

                <div className="spread" style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
                  <span className="tiny muted">Last updated {relativeTime(s.lastSync)}</span>
                  <button className="btn btn-sm" onClick={() => sync(s.id)} disabled={syncing === s.id}>
                    <RefreshCw size={12} className={syncing === s.id ? 'spin' : ''} />
                    {syncing === s.id ? 'Syncing…' : 'Sync now'}
                  </button>
                </div>

                {s.message && (
                  <div className="tiny" style={{
                    marginTop: 9, color: `var(--${st.tone === 'critical' ? 'critical' : 'warning'}-ink)`,
                  }}>
                    {s.message}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <UploadPanel />

      <Card title="Source reports" subtitle="The original files each platform gives you — download them unchanged" flush>
        <div style={{ padding: 4 }}>
          {sourceReports.map(r => (
            <div className="spread" key={r.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <span className="hstack" style={{ gap: 10 }}>
                <FileSpreadsheet size={15} style={{ color: 'var(--ink-3)' }} />
                <span>
                  <span className="small" style={{ fontWeight: 500, display: 'block' }}>{r.name}</span>
                  <span className="tiny muted">Updated {fmtDate(r.updated + 'T12:00:00', 'long')}</span>
                </span>
              </span>
              <span className="hstack" style={{ gap: 5 }}>
                {r.formats.map(f => (
                  <button key={f} className="btn btn-sm"><Download size={11} /> {f}</button>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <style>{`.spin { animation: spin 0.8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
