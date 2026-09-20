import { useMemo } from 'react';
import {
  Users, Boxes, UserRound, Megaphone, Sparkles, Construction,
  Mail, BookOpen, MessageSquare, Receipt, FileText,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { insights } from '../data/business.js';
import { financials } from '../data/engine.js';
import { money } from '../lib/format.js';
import { Card, Empty, Delta } from '../components/ui/index.jsx';
import { NotConnected } from '../components/ui/NotConnected.jsx';

/* ── Finance — what order data can answer, and what it cannot ───────────── */

export function Finance() {
  const { scope, prevScope } = useApp();
  const fin = useMemo(() => financials(scope), [scope]);
  const prev = useMemo(() => financials(prevScope), [prevScope]);

  const rows = [
    { l: 'Gross sales',   v: fin.grossSales, p: prev.grossSales },
    { l: 'Cancellations', v: -fin.cancelValue, p: -prev.cancelValue, cost: true },
    { l: 'Discounts',     v: -fin.discount, p: -prev.discount, cost: true },
    { l: 'Returns',       v: -fin.returnsValue, p: -prev.returnsValue, cost: true },
    { l: 'Net sales',     v: fin.netSales, p: prev.netSales, strong: true },
  ];
  if (fin.costComplete) {
    rows.push(
      { l: 'Cost of goods', v: -fin.cogs, p: -prev.cogs, cost: true },
      { l: 'Gross margin',  v: fin.grossProfit, p: prev.grossProfit, strong: true },
    );
  }

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Finance</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          The part of the P&amp;L your synced orders can actually build.
        </p>
      </div>

      <Card title="Sales to gross margin" subtitle="Summed from your orders, nothing assumed">
        <div className="vstack" style={{ gap: 0 }}>
          {rows.map((r, i) => (
            <div className="spread" key={r.l} style={{
              padding: '9px 0',
              borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span className={r.strong ? 'small' : 'small muted'} style={{ fontWeight: r.strong ? 600 : 400 }}>
                {r.l}
              </span>
              <span className="hstack" style={{ gap: 12 }}>
                <span className="tnum" style={{
                  fontWeight: r.strong ? 700 : 500,
                  color: r.cost ? 'var(--critical-ink)' : 'var(--ink)',
                }}>
                  {r.cost ? '−' : ''}{money(Math.abs(r.v))}
                </span>
                <Delta value={r.p ? ((r.v - r.p) / Math.abs(r.p)) * 100 : null} />
              </span>
            </div>
          ))}
        </div>
        {!fin.costComplete && (
          <div style={{ marginTop: 12 }}>
            <NotConnected
              title="Cost of goods and gross margin"
              needs="a cost per item on every product sold"
              compact
            >
              Shopify reports a unit cost only where you entered one. A partial figure would
              understate cost and overstate margin, so it is withheld rather than estimated.
            </NotConnected>
          </div>
        )}
      </Card>

      <Card title="The rest of the P&amp;L" subtitle="Each line needs a source of its own">
        <div className="vstack" style={{ gap: 10 }}>
          <NotConnected
            title="Operating expenses, EBITDA and net profit"
            needs="accounting (Tally, Zoho or Xero)"
          />
          <NotConnected
            title="Cash position, burn and runway"
            needs="bank statements"
          />
          <NotConnected
            title="Receivables, payables and overdues"
            needs="accounting and marketplace settlements"
          />
        </div>
      </Card>
    </div>
  );
}

/* ── Reconciliation ─────────────────────────────────────────────────────── */

export function Reconciliation() {
  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Reconciliation</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Money owed against money received.
        </p>
      </div>
      <Card>
        <NotConnected
          title="Settlement reconciliation"
          needs="marketplace settlement reports and bank statements"
        >
          Reconciliation compares what a platform says it owes you with what actually reached your
          bank. Both halves come from outside your store — Shopify's order data records the sale,
          never the payout.
        </NotConnected>
      </Card>
      <Card title="What this page will show" subtitle="Once settlements and a bank feed are connected">
        <div className="vstack" style={{ gap: 9 }}>
          {[
            ['Expected settlement', 'What each platform owes for orders it has shipped'],
            ['Received in bank', 'What actually landed, matched line by line'],
            ['Outstanding', 'The gap, split into in-transit, short-paid and disputed'],
            ['Fee variance', 'Where a platform charged more than its own rate card'],
          ].map(([t, d]) => (
            <div className="hstack" key={t} style={{ gap: 10, alignItems: 'flex-start' }}>
              <Receipt size={14} style={{ color: 'var(--ink-3)', marginTop: 2, flex: 'none' }} />
              <span>
                <span className="small" style={{ fontWeight: 500, display: 'block' }}>{t}</span>
                <span className="tiny muted">{d}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── GST ───────────────────────────────────────────────────────────────── */

export function Gst() {
  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>GST</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Output tax, input credit and what is payable.
        </p>
      </div>
      <Card>
        <NotConnected
          title="GST returns and input credit"
          needs="your GST portal filings and purchase invoices"
        >
          Output tax could eventually be derived from orders, but input credit depends on purchase
          invoices and the liability on what has actually been filed. Showing one half of a tax
          position is worse than showing none.
        </NotConnected>
      </Card>
      <Card title="What this page will show" subtitle="Once filings and invoices are connected">
        <div className="vstack" style={{ gap: 9 }}>
          {[
            ['Output tax', 'Collected on sales, split by rate and place of supply'],
            ['Input credit', 'Claimable on purchases, reconciled against GSTR-2B'],
            ['Net payable', 'What is actually due this period'],
            ['Filing status', 'GSTR-1 and GSTR-3B, filed or outstanding'],
          ].map(([t, d]) => (
            <div className="hstack" key={t} style={{ gap: 10, alignItems: 'flex-start' }}>
              <FileText size={14} style={{ color: 'var(--ink-3)', marginTop: 2, flex: 'none' }} />
              <span>
                <span className="small" style={{ fontWeight: 500, display: 'block' }}>{t}</span>
                <span className="tiny muted">{d}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── Inventory ─────────────────────────────────────────────────────────── */

export function Inventory() {
  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Inventory</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Stock position, cover and reorder points.
        </p>
      </div>
      <Card>
        <NotConnected
          title="Stock on hand"
          needs="Shopify inventory levels or a warehouse system"
        >
          Ardent syncs what sold, not what is left. Stock levels, days of cover and reorder points
          all rest on a current on-hand quantity, which no connected source reports yet.
        </NotConnected>
      </Card>
      <Card title="What this page will show" subtitle="Once stock levels are connected">
        <div className="vstack" style={{ gap: 9 }}>
          {[
            ['Stock on hand by SKU and location', 'Including what is in transit'],
            ['Days of cover and reorder alerts', 'Against each SKU\'s own rate of sale'],
            ['Dead stock and ageing', 'Capital sitting still'],
            ['Stock-outs', 'Days lost, and the revenue they cost'],
          ].map(([t, d]) => (
            <div className="hstack" key={t} style={{ gap: 10, alignItems: 'flex-start' }}>
              <Boxes size={14} style={{ color: 'var(--ink-3)', marginTop: 2, flex: 'none' }} />
              <span>
                <span className="small" style={{ fontWeight: 500, display: 'block' }}>{t}</span>
                <span className="tiny muted">{d}</span>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ── AI Insights — derived from data only ──────────────────────────────── */

export function Insights() {
  const { scope, prevScope } = useApp();
  const read = useMemo(() => insights(scope, prevScope)[0], [scope, prevScope]);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Insights</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Plain-language reads of what actually moved — computed from your data, never inferred.
        </p>
      </div>

      <div className="hstack" style={{
        gap: 10, padding: '12px 14px', background: 'var(--surface-2)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      }}>
        <Sparkles size={16} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
        <span className="small muted">
          Ardent only states what the numbers support. If a cause is not measurable in your data,
          it is not claimed here.
        </span>
      </div>

      {!read ? (
        <Card>
          <Empty icon={Sparkles} title="Not enough history">
            There is no previous period with sales to compare against yet. Select a longer range, or
            come back once more orders have synced.
          </Empty>
        </Card>
      ) : (
        <Card title="What changed this period">
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{read.headline}</div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
            {read.contributors.length > 0 && (
              <div>
                <div className="section-title">Channel contribution</div>
                <div className="vstack" style={{ gap: 7 }}>
                  {read.contributors.map(c => (
                    <div className="spread" key={c.key}>
                      <span className="small">{c.name}</span>
                      <span className="hstack" style={{ gap: 9 }}>
                        <span className="tiny muted tnum">{c.delta >= 0 ? '+' : '−'}{money(Math.abs(c.delta))}</span>
                        <Delta value={c.change} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {read.laggards.length > 0 && (
              <div>
                <div className="section-title">Largest declines</div>
                <div className="vstack" style={{ gap: 7 }}>
                  {read.laggards.map(p => (
                    <div className="spread" key={p.key}>
                      <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <Delta value={p.change} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {read.leaders.length > 0 && (
              <div>
                <div className="section-title">Largest gains</div>
                <div className="vstack" style={{ gap: 7 }}>
                  {read.leaders.map(p => (
                    <div className="spread" key={p.key}>
                      <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <Delta value={p.change} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Generic "not built yet" ───────────────────────────────────────────── */

function Soon({ icon: Icon, title, blurb, planned }) {
  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>{title}</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>{blurb}</p>
      </div>
      <Card>
        <div className="empty">
          <Icon size={32} strokeWidth={1.4} />
          <h4>Not built yet</h4>
          <p style={{ maxWidth: 420, margin: '0 auto' }}>
            This section is scoped but not implemented.
          </p>
          {planned && (
            <div className="vstack" style={{ gap: 7, maxWidth: 340, margin: '18px auto 0', textAlign: 'left' }}>
              {planned.map(p => (
                <div className="hstack" key={p} style={{ gap: 8 }}>
                  <span className="dot neutral" />
                  <span className="small">{p}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export const People = () => (
  <Soon
    icon={Users} title="People & HR"
    blurb="Team structure, payroll and performance."
    planned={['Headcount by department', 'Payroll against revenue per head', 'Attendance and leave', 'Performance reviews']}
  />
);

export const Customers = () => (
  <Soon
    icon={UserRound} title="Customers"
    blurb="Who buys, how often, and what they are worth over time."
    planned={['Repeat rate and cohort retention', 'Lifetime value by acquisition channel', 'RFM segmentation', 'Geographic concentration']}
  />
);

export const Marketing = () => (
  <Soon
    icon={Megaphone} title="Marketing"
    blurb="Spend, return and contribution by campaign and channel."
    planned={['Blended and channel ROAS', 'Customer acquisition cost against LTV', 'Campaign scale / cut decisions', 'Creative fatigue signals']}
  />
);

/* ── Help ──────────────────────────────────────────────────────────────── */

export function Help() {
  const items = [
    {
      icon: BookOpen, title: 'How Ardent calculates each number',
      body: 'Every figure is summed from the orders synced out of your connected stores. Click a KPI to see the exact lines that build it.',
    },
    {
      icon: Boxes, title: 'Connecting a data source',
      body: 'Shopify connects over OAuth on the Data Sources page. Marketplaces, ad platforms, banks and accounting are on the roadmap and are listed there as planned.',
    },
    {
      icon: MessageSquare, title: 'Why something says "not connected"',
      body: 'Because the source that would answer it is not wired up. Ardent leaves the gap visible rather than filling it with an assumed rate — a figure you cannot trace is worse than no figure.',
    },
    {
      icon: Construction, title: 'Why margin can be missing',
      body: 'Cost of goods needs a cost per item on every variant you sold. Where even one sold unit lacks it, margin is withheld instead of being understated.',
    },
  ];

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Help & support</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>How Ardent works, and where to get answers.</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' }}>
        {items.map(i => (
          <Card key={i.title}>
            <div className="hstack" style={{ gap: 11, alignItems: 'flex-start' }}>
              <span className="avatar" style={{ borderRadius: 8, background: 'var(--surface-3)' }}>
                <i.icon size={15} style={{ color: 'var(--ink-2)' }} />
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{i.title}</div>
                <div className="small muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{i.body}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card title="Still stuck?">
        <div className="hstack" style={{ gap: 9, flexWrap: 'wrap' }}>
          <a className="btn btn-primary" href="mailto:support@ardent.app"><Mail size={14} /> Email support</a>
        </div>
      </Card>
    </div>
  );
}
