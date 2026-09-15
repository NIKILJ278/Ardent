import { useMemo, useState } from 'react';
import { FileText, Download, Info, AlertTriangle, CalendarRange } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { gstReturn, RETURN_TYPES } from '../data/gst.js';
import { adInvoices, ITC_STATES } from '../data/adInvoices.js';
import { inr, inrExact, num, pct, fmtDate, periodLabel, periodRange, periodDays, periodSlug } from '../lib/format.js';
import { Card, Pill, DataTable, Segmented } from '../components/ui/index.jsx';
import { channelColor } from '../lib/channels.js';

/**
 * Download a report as CSV. The period is written into the file itself, not
 * just the filename — a register that leaves its own coverage ambiguous stops
 * being usable as a filing record the moment it is emailed on.
 */
function toCsv(filename, headers, rows, meta = {}) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const preamble = [
    ['Report', meta.title ?? ''],
    ['Entity', meta.entity ?? ''],
    ['GSTIN', meta.gstin ?? ''],
    ['Period', meta.period ?? ''],
    ['Date range', meta.range ?? ''],
    ['Generated on', new Date().toISOString().slice(0, 10)],
    [],
  ].map(r => r.map(esc).join(','));
  const body = [...preamble, headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Figure({ label, value, sub, strong, tone }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', background: 'var(--surface-2)' }}>
      <div className="tiny muted">{label}</div>
      <div className="tnum" style={{
        fontWeight: strong ? 700 : 600, fontSize: strong ? 17 : 15, marginTop: 2,
        color: tone === 'critical' ? 'var(--critical-ink)' : tone === 'good' ? 'var(--good-ink)' : 'var(--ink)',
      }}>{value}</div>
      {sub && <div className="tiny muted" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Gst() {
  const { scope, companyId, period } = useApp();
  const [ret, setRet] = useState('gstr1');

  const g = useMemo(() => gstReturn(scope, companyId), [scope, companyId]);
  const ads = useMemo(() => adInvoices(scope, companyId), [scope, companyId]);
  const label = periodLabel(period);
  const range = periodRange(period);
  const slug = periodSlug(period);
  const active = RETURN_TYPES.find(r => r.id === ret);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>GST Reports</h1>
          <p className="muted small" style={{ margin: '3px 0 0' }}>
            {g.company?.name} · GSTIN <span className="mono">{g.gstin}</span> · {g.sellerStateName}
          </p>
        </div>
        <Segmented options={RETURN_TYPES.map(r => ({ id: r.id, label: r.label }))} value={ret} onChange={setRet} />
      </div>

      {/* Every report states the period it covers, unambiguously. */}
      <div className="hstack" style={{
        gap: 10, padding: '9px 13px', background: 'var(--surface-2)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)', flexWrap: 'wrap',
      }}>
        <CalendarRange size={15} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
        <span className="small" style={{ fontWeight: 600 }}>{label}</span>
        <span className="tiny muted">{range}</span>
        <span className="tiny muted">· {periodDays(period)} days</span>
        <span className="tiny muted" style={{ marginLeft: 'auto' }}>
          Exports carry this range in the filename and inside the file.
        </span>
      </div>

      <div className="hstack" style={{
        gap: 10, padding: '10px 13px', background: 'var(--accent-soft)',
        borderRadius: 'var(--radius)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
      }}>
        <Info size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="small" style={{ color: 'var(--accent)' }}>
          {active?.blurb}. Figures are computed from the same transactions as Sales and Finance —
          prices are GST-inclusive, so taxable value is the invoice divided by one plus the rate.
        </span>
      </div>

      {/* ── GSTR-1 ─────────────────────────────────────────────────────── */}
      {ret === 'gstr1' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
            <Figure label="Invoice value" value={inr(g.invoiceValue)} sub="inclusive of GST" />
            <Figure label="Taxable value" value={inr(g.taxableValue)} />
            <Figure label="GST on supplies" value={inr(g.totalTax)} />
            <Figure label="Credit notes" value={inr(g.creditTaxable)} sub={`${inr(g.creditTax)} tax reversed`} tone="critical" />
            <Figure label="Net taxable value" value={inr(g.netTaxable)} strong />
          </div>

          <Card
            title="HSN summary"
            subtitle="Mandatory in GSTR-1 — quantity, taxable value and tax by HSN code"
            flush
            actions={
              <button className="btn btn-sm" onClick={() => toCsv(
                `GSTR1-HSN-${companyId}-${slug}.csv`,
                ['HSN', 'Description', 'UQC', 'Quantity', 'Rate %', 'Taxable Value', 'Total Tax'],
                g.hsnSummary.map(h => [h.hsn, h.description, h.uqc, h.quantity, h.rate, h.taxable.toFixed(2), h.tax.toFixed(2)]),
                { title: 'GSTR-1 HSN Summary', entity: g.company?.name, gstin: g.gstin, period: label, range }
              )}>
                <Download size={13} /> CSV
              </button>
            }
          >
            <DataTable
              searchable={false} pageSize={12}
              columns={[
                { key: 'hsn', label: 'HSN', render: r => <span className="mono" style={{ fontWeight: 600 }}>{r.hsn}</span> },
                { key: 'description', label: 'Description', render: r => <span className="small">{r.description}</span> },
                { key: 'uqc', label: 'UQC', render: r => <span className="tiny muted">{r.uqc}</span> },
                { key: 'quantity', label: 'Quantity', align: 'right', render: r => num(r.quantity) },
                { key: 'rate', label: 'Rate', align: 'right', render: r => <Pill tone="neutral" icon={false}>{r.rate}%</Pill> },
                { key: 'taxable', label: 'Taxable value', align: 'right', render: r => inrExact(r.taxable) },
                { key: 'tax', label: 'Tax', align: 'right', render: r => <strong>{inrExact(r.tax)}</strong> },
              ]}
              rows={g.hsnSummary.map(h => ({ ...h, id: h.hsn }))}
              initialSort={{ key: 'taxable', dir: 'desc' }}
              emptyText="No supplies in this period"
            />
          </Card>

          <Card
            title="B2C supplies by place of supply"
            subtitle={`Home state is ${g.sellerStateName} — those supplies attract CGST + SGST, every other state attracts IGST`}
            flush
            actions={
              <button className="btn btn-sm" onClick={() => toCsv(
                `GSTR1-B2C-${companyId}-${slug}.csv`,
                ['State Code', 'Place of Supply', 'Taxable Value', 'CGST', 'SGST', 'IGST'],
                g.stateRows.map(r => [r.code, r.state, r.taxable.toFixed(2), r.cgst.toFixed(2), r.sgst.toFixed(2), r.igst.toFixed(2)]),
                { title: 'GSTR-1 B2C by Place of Supply', entity: g.company?.name, gstin: g.gstin, period: label, range }
              )}>
                <Download size={13} /> CSV
              </button>
            }
          >
            <DataTable
              searchable={false} pageSize={16}
              columns={[
                { key: 'state', label: 'Place of supply', render: r => (
                  <span className="hstack" style={{ gap: 8 }}>
                    <span className="mono tiny muted">{r.code}</span>
                    <span style={{ fontWeight: 500 }}>{r.state}</span>
                    {r.intra && <Pill tone="info" icon={false}>Intra-state</Pill>}
                  </span>
                )},
                { key: 'share', label: 'Share', align: 'right', render: r => pct(r.share) },
                { key: 'taxable', label: 'Taxable value', align: 'right', render: r => inrExact(r.taxable) },
                { key: 'cgst', label: 'CGST', align: 'right', render: r => r.cgst ? inrExact(r.cgst) : <span className="muted">—</span> },
                { key: 'sgst', label: 'SGST', align: 'right', render: r => r.sgst ? inrExact(r.sgst) : <span className="muted">—</span> },
                { key: 'igst', label: 'IGST', align: 'right', render: r => r.igst ? inrExact(r.igst) : <span className="muted">—</span> },
              ]}
              rows={g.stateRows.map(r => ({ ...r, id: r.code }))}
              initialSort={{ key: 'taxable', dir: 'desc' }}
              emptyText="No supplies in this period"
            />
          </Card>

          <Card title="Credit notes (CDNR)" subtitle="Returns and RTO reverse supplies already reported">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
              <Figure label="Credit note value" value={inr(g.creditInvoice)} sub="inclusive of GST" />
              <Figure label="Taxable reversed" value={inr(g.creditTaxable)} />
              <Figure label="Tax reversed" value={inr(g.creditTax)} tone="critical" />
              <Figure label="As % of supplies" value={pct(g.taxableValue ? (g.creditTaxable / g.taxableValue) * 100 : 0)} />
            </div>
            <div className="ladder-foot">
              Cancellations are excluded entirely — an order cancelled before dispatch is never a supply, so it never enters the return.
            </div>
          </Card>
        </>
      )}

      {/* ── GSTR-3B ────────────────────────────────────────────────────── */}
      {ret === 'gstr3b' && (
        <>
          <Card title="3.1(a) Outward taxable supplies" subtitle="Other than zero-rated, nil-rated and exempted">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
              <Figure label="Taxable value" value={inr(g.gstr3b.outwardTaxable)} strong />
              <Figure label="Integrated tax (IGST)" value={inr(g.gstr3b.integratedTax)} />
              <Figure label="Central tax (CGST)" value={inr(g.gstr3b.centralTax)} />
              <Figure label="State tax (SGST)" value={inr(g.gstr3b.stateTax)} />
            </div>
          </Card>

          <Card title="Liability summary" subtitle="What is payable after the credit collected by marketplace operators">
            <div className="vstack" style={{ gap: 0 }}>
              {[
                { l: 'Total GST on outward supplies', v: g.totalTax },
                { l: 'Less: tax reversed on credit notes', v: -g.creditTax },
                { l: 'Net GST liability', v: g.netTax, strong: true },
                { l: 'Less: TCS credit under s.52', v: -g.tcsTotal },
              ].map((r, i) => (
                <div className="spread" key={i} style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="small" style={{ fontWeight: r.strong ? 600 : 400, color: r.strong ? 'var(--ink)' : 'var(--ink-2)' }}>{r.l}</span>
                  <span className="tnum" style={{ fontWeight: r.strong ? 700 : 500, color: r.v < 0 ? 'var(--critical-ink)' : 'var(--ink)' }}>
                    {r.v < 0 ? '−' : ''}{inrExact(Math.abs(r.v))}
                  </span>
                </div>
              ))}
              <div className="spread" style={{ paddingTop: 12, marginTop: 4 }}>
                <span style={{ fontWeight: 700 }}>Net payable in cash</span>
                <span className="tnum" style={{ fontWeight: 700, fontSize: 17 }}>{inrExact(g.gstr3b.netPayable)}</span>
              </div>
            </div>
          </Card>

          <Card title="Rate-wise breakdown" subtitle="Supplies and reversals at each GST slab" flush>
            <DataTable
              searchable={false} pageSize={10}
              columns={[
                { key: 'rate', label: 'Rate', render: r => <Pill tone="neutral" icon={false}>{r.rate}%</Pill> },
                { key: 'taxable', label: 'Taxable value', align: 'right', render: r => inrExact(r.taxable) },
                { key: 'tax', label: 'Tax', align: 'right', render: r => inrExact(r.tax) },
                { key: 'creditTaxable', label: 'Credit notes', align: 'right', render: r => <span className="muted">−{inrExact(r.creditTaxable)}</span> },
                { key: 'net', label: 'Net taxable', align: 'right', sortValue: r => r.taxable - r.creditTaxable,
                  render: r => <strong>{inrExact(r.taxable - r.creditTaxable)}</strong> },
                { key: 'netTax', label: 'Net tax', align: 'right', sortValue: r => r.tax - r.creditTax,
                  render: r => <strong>{inrExact(r.tax - r.creditTax)}</strong> },
              ]}
              rows={g.rateSlabs.map(r => ({ ...r, id: r.rate }))}
              initialSort={{ key: 'taxable', dir: 'desc' }}
              emptyText="No supplies in this period"
            />
          </Card>
        </>
      )}

      {/* ── TCS ────────────────────────────────────────────────────────── */}
      {ret === 'tcs' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
            <Figure label="Net supply through operators" value={inr(g.tcsRows.reduce((s, r) => s + r.netSupply, 0))} />
            <Figure label="Taxable value" value={inr(g.tcsRows.reduce((s, r) => s + r.taxable, 0))} />
            <Figure label="TCS collected (1%)" value={inr(g.tcsTotal)} strong tone="good" />
            <Figure label="Operators" value={num(g.tcsRows.length)} />
          </div>

          <Card
            title="TCS by marketplace operator"
            subtitle="Collected under section 52 and credited to your electronic cash ledger — reconcile against each operator's GSTR-8"
            flush
            actions={
              <button className="btn btn-sm" onClick={() => toCsv(
                `TCS-s52-${companyId}-${slug}.csv`,
                ['Operator', 'Net Supply Value', 'Taxable Value', 'TCS @1%'],
                g.tcsRows.map(r => [r.channelName, r.netSupply.toFixed(2), r.taxable.toFixed(2), r.tcs.toFixed(2)]),
                { title: 'TCS collected under s.52', entity: g.company?.name, gstin: g.gstin, period: label, range }
              )}>
                <Download size={13} /> CSV
              </button>
            }
          >
            <DataTable
              searchable={false} pageSize={10}
              columns={[
                { key: 'channelName', label: 'Operator', render: r => (
                  <span className="hstack" style={{ gap: 8 }}>
                    <span className="swatch" style={{ background: channelColor(r.channel) }} />
                    <span style={{ fontWeight: 500 }}>{r.channelName}</span>
                  </span>
                )},
                { key: 'netSupply', label: 'Net supply value', align: 'right', render: r => inrExact(r.netSupply) },
                { key: 'taxable', label: 'Taxable value', align: 'right', render: r => inrExact(r.taxable) },
                { key: 'tcs', label: 'TCS @ 1%', align: 'right', render: r => <strong>{inrExact(r.tcs)}</strong> },
              ]}
              rows={g.tcsRows.map(r => ({ ...r, id: r.channel }))}
              initialSort={{ key: 'tcs', dir: 'desc' }}
              emptyText="No marketplace supplies in this period"
            />
          </Card>

          <Card title="How this is used">
            <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.6 }}>
              Marketplace operators collect 1% of the net value of taxable supplies made through them and
              report it in their GSTR-8. That amount appears in your electronic cash ledger and reduces the
              GST payable in cash. Returns are already netted off the supply value here, so this figure should
              agree with the operator statement before you claim it.
            </div>
          </Card>
        </>
      )}

      {/* ── Ad invoices & input tax credit ─────────────────────────────── */}
      {ret === 'itc' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
            <Figure label="Invoices" value={num(ads.count)} sub={`${ads.byPlatform.length} suppliers`} />
            <Figure label="Taxable value" value={inr(ads.taxable)} sub="ad spend, ex-GST" />
            <Figure label="GST charged" value={inr(ads.tax)} sub="18% on services" />
            <Figure label="ITC claimable" value={inr(ads.itcClaimable)} strong tone="good" />
            <Figure label="ITC blocked" value={inr(ads.itcBlocked)} tone={ads.itcBlocked > 0 ? 'critical' : undefined} sub="not yet in GSTR-2B" />
          </div>

          {ads.blockedRows.length > 0 && (
            <div className="hstack" style={{
              gap: 10, padding: '12px 14px', background: 'var(--warning-soft)',
              border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
              borderRadius: 'var(--radius)',
            }}>
              <AlertTriangle size={17} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--warning-ink)' }}>
                  {inr(ads.itcBlocked)} of input credit cannot be claimed yet
                </div>
                <div className="small" style={{ color: 'var(--warning-ink)', opacity: 0.9 }}>
                  {ads.blockedRows.length} invoice{ads.blockedRows.length === 1 ? '' : 's'} do not appear in GSTR-2B,
                  or the value does not agree. Credit may only be taken once the supplier has filed.
                </div>
              </div>
            </div>
          )}

          <Card title="By supplier" subtitle="Each platform bills separately and files its own return">
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
              {ads.byPlatform.map(p => (
                <div key={p.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 13px', background: 'var(--surface-2)' }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>{p.entity}</div>
                  <div className="mono tiny muted">{p.gstin}</div>
                  <div className="spread" style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border)' }}>
                    <span className="tiny muted">Taxable</span>
                    <span className="tnum small" style={{ fontWeight: 600 }}>{inr(p.taxable)}</span>
                  </div>
                  <div className="spread"><span className="tiny muted">GST</span><span className="tnum small">{inr(p.tax)}</span></div>
                  <div className="spread">
                    <span className="tiny muted">ITC claimable</span>
                    <span className="tnum small" style={{ fontWeight: 600, color: 'var(--good-ink)' }}>{inr(p.claimable)}</span>
                  </div>
                  {p.blocked > 0 && (
                    <div className="spread">
                      <span className="tiny muted">Blocked</span>
                      <span className="tnum small" style={{ fontWeight: 600, color: 'var(--critical-ink)' }}>{inr(p.blocked)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Purchase invoice register"
            subtitle={`Supplier invoices for the period · place of supply ${ads.buyerStateName}`}
            flush
            actions={
              <button className="btn btn-sm" onClick={() => toCsv(
                `Ad-Invoices-${companyId}-${slug}.csv`,
                ['Invoice No', 'Invoice Date', 'Supplier', 'Supplier GSTIN', 'Account', 'Taxable Value', 'Rate %', 'CGST', 'SGST', 'IGST', 'Invoice Total', 'Place of Supply', 'GSTR-2B Status', 'ITC Claimable'],
                ads.rows.map(r => [
                  r.invoiceNo, r.invoiceDate.toISOString().slice(0, 10), r.supplier, r.supplierGstin,
                  r.account, r.taxable.toFixed(2), r.rate, r.cgst.toFixed(2), r.sgst.toFixed(2),
                  r.igst.toFixed(2), r.total.toFixed(2), r.placeOfSupply,
                  ITC_STATES[r.itcState].label, r.itcClaimable.toFixed(2),
                ]),
                { title: 'Advertising Purchase Invoice Register', entity: g.company?.name, gstin: g.gstin, period: label, range }
              )}>
                <Download size={13} /> Register CSV
              </button>
            }
          >
            <DataTable
              pageSize={14}
              searchKeys={['invoiceNo', 'supplier', 'account', 'platformName']}
              columns={[
                { key: 'invoiceNo', label: 'Invoice No.', render: r => <span className="mono tiny">{r.invoiceNo}</span> },
                { key: 'invoiceDate', label: 'Date', sortValue: r => r.invoiceDate.getTime(), render: r => fmtDate(r.invoiceDate, 'long') },
                { key: 'supplier', label: 'Supplier', render: r => (
                  <span>
                    <span style={{ fontWeight: 500 }}>{r.platformName.split(' — ')[0]}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>{r.account}</span>
                  </span>
                )},
                { key: 'supplierGstin', label: 'GSTIN', render: r => <span className="mono tiny">{r.supplierGstin}</span> },
                { key: 'taxable', label: 'Taxable', align: 'right', render: r => inrExact(r.taxable) },
                { key: 'igst', label: 'IGST', align: 'right', render: r => r.igst ? inrExact(r.igst) : <span className="muted">—</span> },
                { key: 'cgst', label: 'CGST+SGST', align: 'right', sortValue: r => r.cgst + r.sgst,
                  render: r => (r.cgst + r.sgst) ? inrExact(r.cgst + r.sgst) : <span className="muted">—</span> },
                { key: 'total', label: 'Invoice total', align: 'right', render: r => <strong>{inrExact(r.total)}</strong> },
                { key: 'itcState', label: 'GSTR-2B', render: r => (
                  <Pill tone={ITC_STATES[r.itcState].tone}>{ITC_STATES[r.itcState].label}</Pill>
                )},
                { key: 'itcClaimable', label: 'ITC', align: 'right', render: r => (
                  r.itcClaimable
                    ? <span className="tnum" style={{ color: 'var(--good-ink)', fontWeight: 600 }}>{inrExact(r.itcClaimable)}</span>
                    : <span className="muted">—</span>
                )},
              ]}
              rows={ads.rows}
              initialSort={{ key: 'invoiceDate', dir: 'desc' }}
              emptyText="No advertising invoices in this period"
            />
          </Card>

          <Card title="How this ties together">
            <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.6 }}>
              The taxable value of these invoices is the marketing cost carried in the P&amp;L, so the register
              and the income statement cannot disagree. Suppliers bill from Karnataka against a
              {' '}{ads.buyerStateName} registration, which makes these inter-state supplies — the tax is IGST
              rather than CGST plus SGST. Advertising is not blocked under section 17(5), so the credit is
              available in full once the invoice appears in GSTR-2B.
            </div>
          </Card>
        </>
      )}

      <div className="hstack" style={{ gap: 8, color: 'var(--ink-3)' }}>
        <FileText size={13} />
        <span className="tiny">
          Prepared for filing review. Confirm against your books and the operator GSTR-8 statements before submission.
        </span>
      </div>
    </div>
  );
}
