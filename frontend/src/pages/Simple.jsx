import { useMemo } from 'react';
import {
  Users, Boxes, UserRound, Megaphone, Sparkles, Construction,
  Mail, BookOpen, MessageSquare, Info,
} from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { departmentPerformance, insights } from '../data/business.js';
import { inr } from '../lib/format.js';
import { Card, Pill, Track, Empty, Delta } from '../components/ui/index.jsx';

/* ── People & HR — deliberately light until requirements are defined ───── */

export function People() {
  const { scope } = useApp();
  const depts = useMemo(() => departmentPerformance(scope), [scope]);
  const headcount = depts.reduce((s, d) => s + d.headcount, 0);

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>People & HR</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Team structure against departmental performance.
        </p>
      </div>

      <div className="hstack" style={{
        gap: 10, padding: '12px 14px', background: 'var(--accent-soft)',
        borderRadius: 'var(--radius)',
      }}>
        <Info size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className="small">
          HR requirements are still being defined. This section shows only what Ardent can
          derive today — headcount by department and how each team is tracking. Payroll,
          attendance and performance reviews will follow once the scope is agreed.
        </span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <div className="kpi" style={{ cursor: 'default' }}>
          <span className="kpi-label"><Users size={12} strokeWidth={2} />Total headcount</span>
          <span className="kpi-value tnum">{headcount}</span>
        </div>
        <div className="kpi" style={{ cursor: 'default' }}>
          <span className="kpi-label">Departments</span>
          <span className="kpi-value tnum">{depts.length}</span>
        </div>
        <div className="kpi" style={{ cursor: 'default' }}>
          <span className="kpi-label">Revenue per head</span>
          <span className="kpi-value tnum">
            {inr(depts.reduce((s, d) => s + d.actual, 0) / Math.max(1, headcount))}
          </span>
        </div>
        <div className="kpi" style={{ cursor: 'default' }}>
          <span className="kpi-label">Teams on track</span>
          <span className="kpi-value tnum">{depts.filter(d => d.tone === 'good').length} / {depts.length}</span>
        </div>
      </div>

      <Card title="Departments" subtitle="Headcount and attainment">
        <div className="vstack" style={{ gap: 15 }}>
          {depts.map(d => (
            <div key={d.name}>
              <div className="spread" style={{ marginBottom: 5 }}>
                <span className="hstack" style={{ gap: 9 }}>
                  <span className="small" style={{ fontWeight: 500 }}>{d.name}</span>
                  <span className="tiny muted">{d.headcount} people</span>
                </span>
                <span className="hstack" style={{ gap: 9 }}>
                  <span className="tnum small" style={{ fontWeight: 600 }}>{d.attainment}%</span>
                  <Pill tone={d.tone}>
                    {d.tone === 'good' ? 'On track' : d.tone === 'warning' ? 'At risk' : 'Behind'}
                  </Pill>
                </span>
              </div>
              <Track value={d.attainment} tone={d.tone} />
              <div className="tiny muted" style={{ marginTop: 4 }}>{d.basis}</div>
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

      <div className="hstack" style={{ gap: 10, padding: '12px 14px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <Sparkles size={16} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
        <span className="small muted">
          Ardent only states what the numbers support. If a cause is not measurable in your
          data, it is not claimed here.
        </span>
      </div>

      {!read ? (
        <Card><Empty icon={Sparkles} title="Not enough history">Select a longer period to compare against.</Empty></Card>
      ) : (
        <Card title="What changed this period">
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>{read.headline}</div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 16 }}>
            <div>
              <div className="section-title">Channel contribution</div>
              <div className="vstack" style={{ gap: 7 }}>
                {read.contributors.map(c => (
                  <div className="spread" key={c.key}>
                    <span className="small">{c.name}</span>
                    <span className="hstack" style={{ gap: 9 }}>
                      <span className="tiny muted tnum">{c.delta >= 0 ? '+' : '−'}{inr(Math.abs(c.delta))}</span>
                      <Delta value={c.change} />
                    </span>
                  </div>
                ))}
              </div>
            </div>

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

/* ── Generic "coming soon" ─────────────────────────────────────────────── */

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
            This section is scoped but not implemented. The data model already carries what it needs.
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

export const Inventory = () => (
  <Soon
    icon={Boxes} title="Inventory"
    blurb="Stock position, cover and reorder points across warehouses and marketplaces."
    planned={['Stock on hand by SKU and location', 'Days of cover and reorder alerts', 'Dead stock and ageing', 'Fulfilment split by warehouse']}
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
    { icon: BookOpen, title: 'How Ardent calculates each number', body: 'Every KPI opens a panel showing the exact lines that build it, down to source transactions.' },
    { icon: Boxes, title: 'Connecting a data source', body: 'Marketplaces connect over API. Bank statements and any platform without an API are uploaded as CSV, XLSX or PDF.' },
    { icon: MessageSquare, title: 'Why a number looks wrong', body: 'Check the Data Sources page first — a stale or errored connection is the usual cause. The drill-down will show you which transactions are included.' },
    { icon: Construction, title: 'What is not built yet', body: 'Inventory, Customers, Marketing and People are scoped but not implemented. They are marked "Soon" in the sidebar.' },
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
          <button className="btn"><MessageSquare size={14} /> Start a chat</button>
        </div>
      </Card>
    </div>
  );
}
