import { useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle, ChevronRight, Receipt } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import {
  reconciliation, settlementLines, RECON_STATES,
  chargeReconciliation, CHARGE_STATES,
} from '../data/business.js';
import { inr, inrExact, num, pct, fmtDate, periodLabel, periodRange, periodDays } from '../lib/format.js';
import { Card, Pill, DataTable, Track } from '../components/ui/index.jsx';
import { channelColor } from '../lib/channels.js';

export default function Reconciliation() {
  const { scope, period } = useApp();
  const [channel, setChannel] = useState(null);

  const recon = useMemo(() => reconciliation(scope), [scope]);
  const charges = useMemo(() => chargeReconciliation(scope), [scope]);
  const lines = useMemo(
    () => (channel ? settlementLines(scope, channel, 48) : []),
    [scope, channel]
  );

  const matchedPct = recon.expected ? (recon.received / recon.expected) * 100 : 0;

  if (channel) {
    const row = recon.detail.find(d => d.channel === channel);
    const byState = Object.keys(RECON_STATES).map(k => ({
      state: k,
      count: lines.filter(l => l.state === k).length,
      value: lines.filter(l => l.state === k).reduce((s, l) => s + l.expected, 0),
    })).filter(s => s.count > 0);

    return (
      <div className="vstack" style={{ gap: 18 }}>
        <div className="hstack" style={{ gap: 10 }}>
          <button className="btn btn-ghost btn-icon" onClick={() => setChannel(null)} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 style={{ fontSize: 20 }}>{row?.channelName} settlements</h1>
            <p className="muted small" style={{ margin: '3px 0 0' }}>
              Each line matches a marketplace payout against the bank credit.
            </p>
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
          {[
            { l: 'Sales',       v: inr(row?.sales) },
            { l: 'Expected',    v: inr(row?.expected) },
            { l: 'Received',    v: inr(row?.received) },
            { l: 'Outstanding', v: inr(row?.outstanding), tone: 'critical' },
            { l: 'Match rate',  v: pct(row?.matchRate ?? 0) },
          ].map(k => (
            <div className="kpi" key={k.l} style={{ cursor: 'default' }}>
              <span className="kpi-label">{k.l}</span>
              <span className="kpi-value tnum" style={k.tone ? { color: 'var(--critical-ink)' } : undefined}>{k.v}</span>
            </div>
          ))}
        </div>

        <Card title="Settlement status" subtitle="Where each payout stands">
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            {byState.map(s => (
              <div key={s.state} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
                <Pill tone={RECON_STATES[s.state].tone}>{RECON_STATES[s.state].label}</Pill>
                <div className="tnum" style={{ fontWeight: 600, fontSize: 16, marginTop: 7 }}>{inr(s.value)}</div>
                <div className="tiny muted">{s.count} settlement{s.count === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Charges deducted"
          subtitle="Each line against the contracted rate card"
          flush
        >
          <DataTable
            searchable={false}
            pageSize={12}
            columns={[
              {
                key: 'label', label: 'Charge',
                render: r => (
                  <span>
                    <span style={{ fontWeight: 500 }}>{r.label}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{r.basis}</span>
                  </span>
                ),
              },
              { key: 'contractedRate', label: 'Contracted', align: 'right', render: r => pct(r.contractedRate * 100, 2) },
              { key: 'effectiveRate',  label: 'Charged',    align: 'right', render: r => pct(r.effectiveRate * 100, 2) },
              { key: 'expected', label: 'Should be', align: 'right', render: r => inr(r.expected) },
              { key: 'actual',   label: 'Deducted',  align: 'right', render: r => <strong>{inr(r.actual)}</strong> },
              {
                key: 'variance', label: 'Variance', align: 'right',
                render: r => (
                  <span style={{
                    fontWeight: 600,
                    color: r.state === 'overcharged' ? 'var(--critical-ink)'
                         : r.state === 'undercharged' ? 'var(--accent)' : 'var(--ink-3)',
                  }}>
                    {r.variance > 0 ? '+' : r.variance < 0 ? '−' : ''}{inr(Math.abs(r.variance))}
                  </span>
                ),
              },
              { key: 'state', label: 'Status', sortable: false, render: r => <Pill tone={CHARGE_STATES[r.state].tone}>{CHARGE_STATES[r.state].label}</Pill> },
            ]}
            rows={charges.channels.find(c => c.channel === channel)?.lines ?? []}
            emptyText="No charge schedule for this marketplace"
          />
        </Card>

        <Card title="Settlement lines" flush>
          <DataTable
            columns={[
              { key: 'settlementId', label: 'Settlement', render: r => <span className="mono">{r.settlementId}</span> },
              { key: 'date',     label: 'Date',     render: r => fmtDate(r.date + 'T12:00:00', 'long') },
              { key: 'orders',   label: 'Orders',   align: 'right', render: r => num(r.orders) },
              { key: 'expected', label: 'Expected', align: 'right', render: r => inrExact(r.expected) },
              { key: 'received', label: 'Received', align: 'right', render: r => inrExact(r.received) },
              {
                key: 'variance', label: 'Variance', align: 'right',
                render: r => (
                  <span style={{ color: Math.abs(r.variance) < 1 ? 'var(--ink-3)' : r.variance < 0 ? 'var(--critical-ink)' : 'var(--good-ink)' }}>
                    {r.variance < 0 ? '−' : r.variance > 0 ? '+' : ''}{inrExact(Math.abs(r.variance))}
                  </span>
                ),
              },
              { key: 'utr',   label: 'Bank UTR', render: r => r.utr ? <span className="mono tiny">{r.utr}</span> : <span className="muted tiny">—</span> },
              { key: 'state', label: 'Status', render: r => <Pill tone={RECON_STATES[r.state].tone}>{RECON_STATES[r.state].label}</Pill> },
            ]}
            rows={lines}
            initialSort={{ key: 'date', dir: 'desc' }}
            pageSize={14}
            searchKeys={['settlementId', 'utr', 'state']}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Reconciliation</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          What the marketplaces owe you, against what actually reached the bank.
        </p>
        <p className="tiny muted" style={{ margin: '4px 0 0' }}>
          {periodLabel(period)} · {periodRange(period)} · {periodDays(period)} days
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        {[
          { l: 'Marketplace sales',   v: recon.sales },
          { l: 'Expected settlement', v: recon.expected },
          { l: 'Received in bank',    v: recon.received },
          { l: 'Outstanding',         v: recon.outstanding, tone: true },
        ].map(k => (
          <div className="kpi" key={k.l} style={{ cursor: 'default' }}>
            <span className="kpi-label">{k.l}</span>
            <span className="kpi-value tnum" style={k.tone ? { color: 'var(--critical-ink)' } : undefined}>{inr(k.v)}</span>
          </div>
        ))}
      </div>

      {recon.outstanding > 0 && (
        <div className="hstack" style={{
          gap: 10, padding: '12px 14px', background: 'var(--warning-soft)',
          border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
          borderRadius: 'var(--radius)',
        }}>
          <AlertTriangle size={17} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--warning-ink)' }}>
              {inr(recon.outstanding)} requires attention
            </div>
            <div className="small" style={{ color: 'var(--warning-ink)', opacity: 0.9 }}>
              {inr(recon.disputed)} disputed or short-paid · {inr(recon.inTransit)} still inside the settlement cycle.
            </div>
          </div>
        </div>
      )}

      <Card title="Overall match rate" subtitle="Money received as a share of money owed">
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="small muted">Received against expected</span>
          <span className="tnum" style={{ fontWeight: 600 }}>{pct(matchedPct)}</span>
        </div>
        <Track value={matchedPct} tone={matchedPct >= 95 ? 'good' : matchedPct >= 88 ? 'warning' : 'critical'} />
      </Card>

      <Card title="By marketplace" subtitle="Select a marketplace to see its settlement lines" flush>
        <DataTable
          searchable={false}
          pageSize={10}
          columns={[
            {
              key: 'channelName', label: 'Marketplace',
              render: r => (
                <span className="hstack" style={{ gap: 8 }}>
                  <span className="swatch" style={{ background: channelColor(r.channel) }} />
                  <span style={{ fontWeight: 500 }}>{r.channelName}</span>
                </span>
              ),
            },
            { key: 'sales',    label: 'Sales',    align: 'right', render: r => inr(r.sales) },
            { key: 'fees',     label: 'Fees',     align: 'right', render: r => <span className="muted">−{inr(r.fees)}</span> },
            { key: 'returns',  label: 'Returns',  align: 'right', render: r => <span className="muted">−{inr(r.returns)}</span> },
            { key: 'expected', label: 'Expected', align: 'right', render: r => inr(r.expected) },
            { key: 'received', label: 'Received', align: 'right', render: r => <strong>{inr(r.received)}</strong> },
            {
              key: 'outstanding', label: 'Outstanding', align: 'right',
              render: r => <span style={{ color: 'var(--critical-ink)', fontWeight: 600 }}>{inr(r.outstanding)}</span>,
            },
            {
              key: 'status', label: 'Status', sortable: false,
              render: r => <Pill tone={RECON_STATES[r.status].tone}>{RECON_STATES[r.status].label}</Pill>,
            },
            { key: 'go', label: '', sortable: false, align: 'right', render: () => <ChevronRight size={14} className="muted" /> },
          ]}
          rows={recon.detail.map(d => ({ ...d, id: d.channel }))}
          initialSort={{ key: 'outstanding', dir: 'desc' }}
          onRowClick={(r) => setChannel(r.channel)}
          emptyText="No marketplace activity in this period"
        />
      </Card>

      {charges.recoverable > 0 && (
        <div className="hstack" style={{
          gap: 10, padding: '12px 14px', background: 'var(--critical-soft)',
          border: '1px solid color-mix(in srgb, var(--critical) 35%, transparent)',
          borderRadius: 'var(--radius)',
        }}>
          <Receipt size={17} style={{ color: 'var(--critical-ink)', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--critical-ink)' }}>
              {inr(charges.recoverable)} deducted above the contracted rate
            </div>
            <div className="small" style={{ color: 'var(--critical-ink)', opacity: 0.9 }}>
              {charges.flagged} charge line{charges.flagged === 1 ? '' : 's'} exceed the rate card beyond tolerance. This is recoverable from the marketplace.
            </div>
          </div>
        </div>
      )}

      <Card
        title="Charge reconciliation"
        subtitle="Every deduction against the contracted rate card, rolled up across marketplaces"
        flush
        actions={
          <span className="tiny muted">
            Deducted {inr(charges.actual)} vs contracted {inr(charges.expected)}
          </span>
        }
      >
        <DataTable
          searchable={false}
          pageSize={10}
          columns={[
            {
              key: 'label', label: 'Charge type',
              render: r => (
                <span className="hstack" style={{ gap: 7 }}>
                  <span style={{ fontWeight: 500 }}>{r.label}</span>
                  {r.statutory && <Pill tone="neutral" icon={false}>Statutory</Pill>}
                </span>
              ),
            },
            { key: 'expected', label: 'Should be', align: 'right', render: r => inr(r.expected) },
            { key: 'actual',   label: 'Deducted',  align: 'right', render: r => <strong>{inr(r.actual)}</strong> },
            {
              key: 'variance', label: 'Variance', align: 'right',
              render: r => (
                <span style={{
                  fontWeight: 600,
                  color: r.state === 'overcharged' ? 'var(--critical-ink)'
                       : r.state === 'undercharged' ? 'var(--accent)' : 'var(--ink-3)',
                }}>
                  {r.variance > 0 ? '+' : r.variance < 0 ? '−' : ''}{inr(Math.abs(r.variance))}
                </span>
              ),
            },
            {
              key: 'variancePct', label: 'vs rate card', align: 'right',
              render: r => r.statutory
                ? <span className="muted">—</span>
                : <span className="tnum">{r.variancePct > 0 ? '+' : r.variancePct < 0 ? '−' : ''}{Math.abs(r.variancePct).toFixed(1)}%</span>,
            },
            {
              key: 'worst', label: 'Worst marketplace', sortable: false,
              render: r => {
                const w = [...r.channels].sort((a, b) => b.variance - a.variance)[0];
                if (!w || w.variance <= 0) return <span className="muted tiny">—</span>;
                return (
                  <span className="hstack" style={{ gap: 6 }}>
                    <span className="swatch" style={{ background: channelColor(w.channel) }} />
                    <span className="small">{w.channelName}</span>
                    <span className="tiny muted">+{inr(w.variance)}</span>
                  </span>
                );
              },
            },
            { key: 'state', label: 'Status', sortable: false, render: r => <Pill tone={CHARGE_STATES[r.state].tone}>{CHARGE_STATES[r.state].label}</Pill> },
          ]}
          rows={charges.charges}
          initialSort={{ key: 'variance', dir: 'desc' }}
          emptyText="No charges in this period"
        />
      </Card>

      <Card title="How reconciliation works" subtitle="The chain Ardent matches on your behalf">
        <div className="hstack" style={{ gap: 6, flexWrap: 'wrap' }}>
          {['Marketplace order', 'Settlement report', 'Charges vs rate card', 'Expected amount', 'Bank credit', 'Matched'].map((s, i, arr) => (
            <span key={s} className="hstack" style={{ gap: 6 }}>
              <span style={{
                border: '1px solid var(--border)', borderRadius: 999,
                padding: '5px 11px', fontSize: 12.5, background: 'var(--surface-2)',
              }}>{s}</span>
              {i < arr.length - 1 && <ChevronRight size={13} className="muted" />}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
