import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { series } from '../../data/engine.js';
import { TODAY } from '../../lib/clock.js';
import { CHANNEL_BY_ID, COMPANY_BY_ID } from '../../data/catalog.js';
import { money, num, fmtDate, iso, periodRange } from '../../lib/format.js';
import { exportCsv, exportMeta } from '../../lib/csv.js';
import { Card, DataTable, Term } from '../ui/index.jsx';

/**
 * Orders, one row per calendar day.
 *
 * Every day in the period is listed, including the ones with no orders: a
 * missing day is a real zero, and leaving it out would make a quiet week look
 * like a shorter one. Orders are distinct — an order with three products is one
 * order, not three — and days are the shop's own calendar days, so a 1 a.m.
 * sale lands on the day the store itself books it.
 */
function daysBetween(start, end) {
  const out = [];
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  const last = new Date(end); last.setHours(0, 0, 0, 0);
  while (d <= last && out.length < 800) {
    out.push(iso(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const weekday = (day) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });

export function DailyOrders({ scope }) {
  const { period, companyId, channelId } = useApp();

  const rows = useMemo(() => {
    const byDay = new Map(series(scope, 'day').map(d => [d.date, d]));
    // There are no orders from the future, so the list ends today.
    const end = period.end > TODAY ? TODAY : period.end;
    return daysBetween(period.start, end).map(day => {
      const d = byDay.get(day);
      const netSales = d ? d.grossSales - d.cancelValue - d.returnsValue - d.discount : 0;
      return {
        id: day, date: day,
        orders: d?.orders ?? 0,
        units: d?.units ?? 0,
        gross: d?.grossSales ?? 0,
        cancelled: d?.cancelValue ?? 0,
        returns: d?.returnsValue ?? 0,
        net: netSales,
        aov: d && d.orders ? netSales / d.orders : null,
      };
    });
  }, [scope, period]);

  const total = rows.reduce((s, r) => s + r.orders, 0);
  const active = rows.filter(r => r.orders > 0);
  const best = active.reduce((a, r) => (!a || r.orders > a.orders ? r : a), null);
  const peak = Math.max(...rows.map(r => r.orders), 1);

  const download = () => {
    const company = companyId === 'all' ? 'All brands' : (COMPANY_BY_ID[companyId]?.name ?? companyId);
    exportCsv({
      name: 'Daily orders',
      headers: ['Date', 'Day', 'Orders', 'Units', 'Gross sales', 'Cancelled', 'Returns', 'Net sales', 'AOV'],
      rows: rows.map(r => [
        r.date, weekday(r.date), r.orders, r.units,
        Math.round(r.gross * 100) / 100, Math.round(r.cancelled * 100) / 100,
        Math.round(r.returns * 100) / 100, Math.round(r.net * 100) / 100,
        r.aov == null ? '' : Math.round(r.aov * 100) / 100,
      ]),
      company, period,
      meta: exportMeta({
        title: 'Daily orders', company, period,
        channel: channelId === 'all' ? 'All channels' : (CHANNEL_BY_ID[channelId]?.name ?? channelId),
        extra: { 'Total orders': total, Days: rows.length },
      }),
    });
  };

  return (
    <div className="vstack" style={{ gap: 14 }}>
      <div className="ad-kpis">
        <div className="ad-kpi">
          <span className="ad-kpi-label"><Term>Orders in period</Term></span>
          <span className="ad-kpi-value tnum">{num(total)}</span>
          <span className="ad-kpi-sub muted">{periodRange(period)}</span>
        </div>
        <div className="ad-kpi">
          <span className="ad-kpi-label"><Term>Average per day</Term></span>
          <span className="ad-kpi-value tnum">{rows.length ? (total / rows.length).toFixed(1) : '—'}</span>
          <span className="ad-kpi-sub muted">{rows.length} day(s), {rows.length - active.length} with none</span>
        </div>
        <div className="ad-kpi">
          <span className="ad-kpi-label"><Term>Busiest day</Term></span>
          <span className="ad-kpi-value tnum">{best ? num(best.orders) : '—'}</span>
          <span className="ad-kpi-sub muted">{best ? `${weekday(best.date)} ${fmtDate(best.date, 'long')}` : 'no orders yet'}</span>
        </div>
      </div>

      <Card
        title="Orders by day"
        subtitle="Distinct orders — an order with several products counts once"
        flush
        actions={
          <button className="btn btn-sm" onClick={download}>
            <Download size={12} /> Download CSV
          </button>
        }
      >
        <DataTable
          searchable={false} pageSize={31}
          initialSort={{ key: 'date', dir: 'desc' }}
          rows={rows}
          emptyText="No days in this period"
          columns={[
            { key: 'date', label: 'Date', render: r => (
              <span>
                <span style={{ fontWeight: 500 }}>{fmtDate(r.date, 'long')}</span>
                <span className="tiny muted" style={{ marginLeft: 8 }}>{weekday(r.date)}</span>
              </span>
            )},
            { key: 'orders', label: 'Orders', align: 'right', render: r => (
              <span className="hstack" style={{ gap: 9, justifyContent: 'flex-end' }}>
                <span className="cat-rank" style={{ width: 54 }}>
                  <span className="cat-rank-fill" style={{ width: `${(r.orders / peak) * 100}%` }} />
                </span>
                <strong className="tnum" style={{ minWidth: 22, textAlign: 'right' }}>{num(r.orders)}</strong>
              </span>
            )},
            { key: 'units', label: 'Units', align: 'right', render: r => num(r.units) },
            { key: 'gross', label: 'Gross', align: 'right', render: r => money(r.gross) },
            { key: 'cancelled', label: 'Cancelled', align: 'right',
              render: r => (r.cancelled ? <span className="muted">{money(r.cancelled)}</span> : <span className="muted">—</span>) },
            { key: 'returns', label: 'Returns', align: 'right',
              render: r => (r.returns ? <span className="muted">{money(r.returns)}</span> : <span className="muted">—</span>) },
            { key: 'net', label: 'Net sales', align: 'right', render: r => <strong>{money(r.net)}</strong> },
            { key: 'aov', label: 'AOV', align: 'right', sortValue: r => r.aov ?? -1,
              render: r => (r.aov == null ? <span className="muted">—</span> : money(r.aov)) },
          ]}
        />
      </Card>
    </div>
  );
}
