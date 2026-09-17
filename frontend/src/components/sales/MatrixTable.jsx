import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { attributeMatrix } from '../../data/matrix.js';
import { money, num, pct } from '../../lib/format.js';
import { Card, Segmented, Delta } from '../ui/index.jsx';
import { WatchButton } from '../watch/WatchButton.jsx';

/**
 * Attribute x period, read as blocks rather than a flat grid.
 *
 * The total sits at the top with its sales, returns and return rate stacked, so
 * the headline is settled before the eye moves on. Every attribute below repeats
 * that same three-line shape and opens on demand — collapsed you compare sales
 * across the range, expanded you see what each one is sending back.
 */
export function MatrixTable({ scope, title, subtitle }) {
  const [grain, setGrain] = useState('month');
  const [measure, setMeasure] = useState('value');
  const [open, setOpen] = useState(() => new Set());

  const m = useMemo(() => attributeMatrix({ scope, grain }), [scope, grain]);
  if (!m.rows.length || !m.columns.length) return null;

  const isOpen = (key) => open.has(key);
  const toggle = (key) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const allOpen = m.rows.every(r => isOpen(r.key));
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(m.rows.map(r => r.key)));

  const fmt = measure === 'value' ? money : num;
  const sales = (c) => (measure === 'value' ? c.value : c.units);
  const peak = Math.max(...m.rows.flatMap(r => r.cells.map(sales)), 1);

  // The two lines that sit under a block's sales line. Return % is coloured
  // against the parent's rate, so an attribute that runs hot is obvious.
  const metricRows = (totalReturns, returnPct, refPct) => [
    {
      id: 'returns',
      label: 'Returns',
      cell: (c) => <span className="muted">{money(c.returns)}</span>,
      total: <span className="muted">{money(totalReturns)}</span>,
    },
    {
      id: 'returnPct',
      label: 'Return %',
      cell: (c) => {
        const p = c.gross > 0 ? (c.returns / c.gross) * 100 : 0;
        return <span style={{ color: p > refPct * 1.15 ? 'var(--critical-ink)' : 'var(--ink-2)' }}>{pct(p)}</span>;
      },
      total: (
        <span style={{
          fontWeight: 600,
          color: returnPct > refPct * 1.25 ? 'var(--critical-ink)'
            : returnPct < refPct * 0.8 ? 'var(--good-ink)' : 'var(--ink)',
        }}>{pct(returnPct)}</span>
      ),
    },
  ];

  // The total block reuses the same cell shape as an attribute block.
  const grandCells = m.totals.map((t, i) => ({
    value: t.value, units: t.units,
    returns: m.returns[i].value, gross: m.returns[i].gross,
  }));

  const colSpan = m.columns.length + 3;

  // What a watch marked from this block would be pointed at. The row dimension
  // decides the depth, so a variant row marks that single SKU and a category
  // row marks the category.
  const subjectFor = (r) => {
    const base = { company: scope.company, channel: scope.channel, title: r.label };
    if (m.dim === 'variant') {
      return { ...base, category: scope.category, subcategory: scope.subcategory,
        product: scope.product, sku: r.key };
    }
    if (m.dim === 'product') {
      return { ...base, category: scope.category, subcategory: scope.subcategory, product: r.key };
    }
    if (m.dim === 'subcategory') return { ...base, category: scope.category, subcategory: r.key };
    return { ...base, category: r.key };
  };

  return (
    <Card
      title={title ?? `${m.label} performance`}
      subtitle={subtitle ?? `Sales, returns and return rate by ${grain === 'month' ? 'month' : 'week'}`}
      flush
      actions={
        <span className="hstack" style={{ gap: 8 }}>
          <button type="button" className="btn-ghost tiny" onClick={toggleAll}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
          <Segmented
            options={[{ id: 'value', label: 'Sales' }, { id: 'units', label: 'Units' }]}
            value={measure} onChange={setMeasure} size="sm"
          />
          <Segmented
            options={[{ id: 'month', label: 'Monthly' }, { id: 'week', label: 'Weekly' }]}
            value={grain} onChange={setGrain} size="sm"
          />
        </span>
      }
    >
      <div className="table-scroll">
        <table className="tbl matrix">
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>{m.label}</th>
              {m.columns.map(c => <th key={c.key} className="num">{c.label}</th>)}
              <th className="num">Total</th>
              <th className="num">Trend</th>
            </tr>
          </thead>

          {/* The headline block, always open. */}
          <tbody className="matrix-group is-total">
            <tr className="matrix-head">
              <td>
                <span className="matrix-total-label">Total</span>
                <span className="tiny muted matrix-code">Sales</span>
              </td>
              {m.totals.map(t => (
                <td key={t.key} className="num"><strong>{fmt(measure === 'value' ? t.value : t.units)}</strong></td>
              ))}
              <td className="num"><strong>{fmt(measure === 'value' ? m.grand.value : m.grand.units)}</strong></td>
              <td />
            </tr>
            {metricRows(m.grand.returns, m.grand.returnPct, m.grand.returnPct).map(mr => (
              <tr key={mr.id} className="matrix-metric">
                <td className="matrix-metric-label">{mr.label}</td>
                {grandCells.map((c, i) => <td key={i} className="num">{mr.cell(c)}</td>)}
                <td className="num">{mr.total}</td>
                <td />
              </tr>
            ))}
          </tbody>

          {/* One block per attribute, opened on demand. */}
          {m.rows.map(r => (
            <tbody key={r.key} className={`matrix-group${isOpen(r.key) ? ' is-open' : ''}`}>
              <tr className="matrix-head">
                <td>
                  <button
                    type="button"
                    className="matrix-toggle"
                    aria-expanded={isOpen(r.key)}
                    onClick={() => toggle(r.key)}
                  >
                    {isOpen(r.key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>{r.label}</span>
                  </button>
                  {r.code && <span className="tiny muted mono matrix-code">{r.code}</span>}
                  <span className="matrix-watch">
                    <WatchButton subject={subjectFor(r)} iconOnly />
                  </span>
                </td>
                {r.cells.map((c, i) => {
                  const v = sales(c);
                  return (
                    <td key={i} className="num matrix-cell">
                      <span
                        className="matrix-tint"
                        style={{ opacity: peak ? Math.min(0.18, (v / peak) * 0.18) : 0 }}
                      />
                      <span className="matrix-num">{v ? fmt(v) : <span className="muted">—</span>}</span>
                    </td>
                  );
                })}
                <td className="num"><strong>{fmt(measure === 'value' ? r.total : r.totalUnits)}</strong></td>
                <td className="num">{r.trend == null ? <span className="muted">—</span> : <Delta value={r.trend} />}</td>
              </tr>

              {isOpen(r.key) && metricRows(r.totalReturns, r.returnPct, m.grand.returnPct).map(mr => (
                <tr key={mr.id} className="matrix-metric">
                  <td className="matrix-metric-label">{mr.label}</td>
                  {r.cells.map((c, i) => <td key={i} className="num">{mr.cell(c)}</td>)}
                  <td className="num">{mr.total}</td>
                  <td />
                </tr>
              ))}
            </tbody>
          ))}

          <tbody>
            <tr>
              <td colSpan={colSpan} className="ladder-foot matrix-foot">
                Sales are net of cancellations, returns and discounts. Return % is returned value against
                gross sales for that {grain === 'month' ? 'month' : 'week'}. The blocks sum to the total on
                every column.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
