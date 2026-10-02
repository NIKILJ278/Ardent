import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp, ArrowDown, Minus, Search, ChevronLeft, ChevronRight,
  ChevronsUpDown, X, Inbox, Check, AlertTriangle, AlertOctagon, Info,
} from 'lucide-react';

/* ── Delta ─────────────────────────────────────────────────────────────── */

export function Delta({ value, suffix = '%', invert = false, showIcon = true }) {
  if (value == null || Number.isNaN(value)) return <span className="delta flat">—</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.05;
  const cls = flat ? 'flat' : good ? 'up' : 'down';
  const Icon = flat ? Minus : value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`delta ${cls}`}>
      {showIcon && <Icon size={12} strokeWidth={2.5} />}
      {Math.abs(value).toFixed(1)}{suffix}
    </span>
  );
}

/* ── Status pill — always icon + label, never colour alone ─────────────── */

const TONE_ICON = {
  good: Check, warning: AlertTriangle, serious: AlertTriangle,
  critical: AlertOctagon, info: Info, neutral: Minus,
};

export function Pill({ tone = 'neutral', children, icon = true }) {
  const Icon = TONE_ICON[tone] ?? Info;
  return (
    <span className={`pill ${tone}`}>
      {icon && <Icon size={11} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

export function Dot({ tone = 'neutral' }) {
  return <span className={`dot ${tone}`} />;
}

/* ── Cards ─────────────────────────────────────────────────────────────── */

export function Card({ title, subtitle, actions, children, flush = false, className = '' }) {
  return (
    <div className={`card2 ${className}`}>
      {(title || actions) && (
        <div className="card2-head">
          <div style={{ minWidth: 0 }}>
            {title && <div className="card2-title">{title}</div>}
            {subtitle && <div className="card2-sub">{subtitle}</div>}
          </div>
          {actions && <div className="hstack" style={{ marginLeft: 'auto' }}>{actions}</div>}
        </div>
      )}
      <div className={`card2-body${flush ? ' flush' : ''}`}>{children}</div>
    </div>
  );
}

/* ── Progress ──────────────────────────────────────────────────────────── */

export function Track({ value, tone = 'accent', markerAt }) {
  return (
    <div className="track">
      <div className={`fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      {markerAt != null && <div className="marker" style={{ left: `${Math.min(100, markerAt)}%` }} />}
    </div>
  );
}

/* ── Segmented control ─────────────────────────────────────────────────── */

export function Segmented({ options, value, onChange, size }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(o => {
        const id = typeof o === 'string' ? o : o.id;
        const label = typeof o === 'string' ? o : o.label;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={value === id}
            className={value === id ? 'on' : ''}
            style={size === 'sm' ? { padding: '3px 9px', fontSize: 12 } : undefined}
            onClick={() => onChange(id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Popover ───────────────────────────────────────────────────────────── */

export function Popover({ trigger, children, align = 'left', width }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="pop-wrap" ref={ref}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div className={`pop${align === 'right' ? ' right' : ''}`} style={width ? { width } : undefined}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}

/* ── Modal ─────────────────────────────────────────────────────────────── */

export function Modal({ title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  // A modal is a boundary, not a child of whatever opened it.
  //
  // Moving it to a portal is not enough on its own: React bubbles events up the
  // component tree regardless of where the node was placed in the document. So
  // a modal opened from inside a clickable table row would send every click and
  // keystroke in the form back to that row's handler and open a second panel
  // behind it. Stopping propagation here is what actually severs that. The
  // portal still earns its place — it keeps the overlay out of scrolling and
  // stacking contexts that would otherwise clip it.
  const seal = (e) => e.stopPropagation();

  const markup = (
    <div
      className="modal-wrap"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); seal(e); }}
      onClick={seal}
      onKeyDown={seal}
      onKeyUp={seal}
      onChange={seal}
      onInput={seal}
      onFocus={seal}
      onPointerDown={seal}
    >
      <div className={`modal2${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal2-head">
          <div className="card2-title" style={{ fontSize: 15 }}>{title}</div>
          <button className="btn btn-ghost btn-icon btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="modal2-body">{children}</div>
        {footer && <div className="modal2-foot">{footer}</div>}
      </div>
    </div>
  );

  // No document during server rendering — fall back to rendering in place.
  return typeof document === 'undefined' ? markup : createPortal(markup, document.body);
}

/* ── Empty state ───────────────────────────────────────────────────────── */

export function Empty({ icon: Icon = Inbox, title = 'Nothing here yet', children }) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.5} />
      <h4>{title}</h4>
      {children && <p>{children}</p>}
    </div>
  );
}

/* ── Data table — search, sort, paginate ───────────────────────────────── */

export function DataTable({
  columns, rows, initialSort, pageSize = 12, searchable = true,
  searchKeys, onRowClick, tools, emptyText = 'No rows for this selection',
  dense = false,
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const keys = searchKeys ?? columns.filter(c => c.searchable !== false).map(c => c.key);
    const needle = q.toLowerCase();
    return rows.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(needle)));
  }, [rows, q, columns, searchKeys]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const { key, dir } = sort;
    const col = columns.find(c => c.key === key);
    const get = col?.sortValue ?? (r => r[key]);
    return [...filtered].sort((a, b) => {
      const av = get(a), bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
      return dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const view = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const toggleSort = (key) => {
    setPage(0);
    setSort(s => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return (
    <div>
      {(searchable || tools) && (
        <div className="table-tools">
          {searchable && (
            <div className="search-box">
              <Search size={14} />
              <input
                className="input" placeholder="Search…" value={q}
                onChange={e => { setQ(e.target.value); setPage(0); }}
              />
            </div>
          )}
          {tools}
          <div style={{ marginLeft: 'auto' }} className="tiny muted">
            {sorted.length.toLocaleString('en-IN')} {sorted.length === 1 ? 'row' : 'rows'}
          </div>
        </div>
      )}

      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              {columns.map(c => (
                <th
                  key={c.key}
                  className={`${c.align === 'right' ? 'num' : ''} ${c.sortable !== false ? 'sortable' : ''}`}
                  style={c.width ? { width: c.width } : undefined}
                  onClick={c.sortable !== false ? () => toggleSort(c.key) : undefined}
                >
                  <span className="hstack" style={{ gap: 4, justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start' }}>
                    {c.label}
                    {c.sortable !== false && sort?.key === c.key && (
                      sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                    )}
                    {c.sortable !== false && sort?.key !== c.key && <ChevronsUpDown size={11} style={{ opacity: 0.35 }} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r, i) => (
              <tr
                key={r.id ?? r.key ?? i}
                className={onRowClick ? 'clickable' : ''}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                style={dense ? { fontSize: 12.5 } : undefined}
              >
                {columns.map(c => (
                  <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={columns.length}><div className="empty" style={{ padding: 30 }}>{emptyText}</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="pager">
          <span>Page {safePage + 1} of {pages}</span>
          <div className="hstack" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-icon" disabled={safePage === 0} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
              <ChevronLeft size={14} />
            </button>
            <button className="btn btn-sm btn-icon" disabled={safePage >= pages - 1} onClick={() => setPage(p => p + 1)} aria-label="Next page">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Horizontal contribution bars — always directly labelled ───────────── */

export function BarList({ items, max, onItemClick, formatValue }) {
  const peak = max ?? Math.max(...items.map(i => i.value), 1);
  return (
    <div className="vstack" style={{ gap: 9 }}>
      {items.map((it, i) => (
        <div
          key={it.key ?? i}
          className="bar-row"
          onClick={onItemClick ? () => onItemClick(it) : undefined}
          style={onItemClick ? { cursor: 'pointer' } : undefined}
        >
          <span className="bl" title={it.label}>{it.label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.max(1.5, (it.value / peak) * 100)}%`, background: it.color ?? 'var(--series-1)' }}
            />
          </div>
          <span className="bv">{formatValue ? formatValue(it.value) : it.value}</span>
        </div>
      ))}
    </div>
  );
}
