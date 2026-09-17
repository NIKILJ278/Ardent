import { Link } from 'react-router-dom';
import { ArrowRight, Megaphone } from 'lucide-react';
import { Card } from '../components/ui/index.jsx';
import { NotConnected } from '../components/ui/NotConnected.jsx';

/* Advertising.
 *
 * Every figure this page used to show — spend, ROAS, ACOS, TACOS, impressions,
 * clicks, campaign performance, attributed revenue — can only come from the ad
 * platform that ran the campaign. None is derivable from order data, and a
 * modelled ROAS is worse than no ROAS: it looks measured.
 *
 * So the page states exactly what it would show, and what has to be connected
 * for it to be true.
 */

const WOULD_SHOW = [
  {
    title: 'General metrics',
    detail: 'Spend, ad revenue, ROAS, ACOS, TACOS, impressions, clicks, CTR, CPC and conversion rate.',
  },
  {
    title: 'Ad spend',
    detail: 'Spend by platform, campaign, category and product, against each one\'s share of revenue.',
  },
  {
    title: 'Analytics',
    detail: 'The funnel from impression to add-to-cart to order, and where it leaks.',
  },
  {
    title: 'Channel and product level',
    detail: 'Which channels and products the spend actually bought, and which quietly do not repay it.',
  },
  {
    title: 'Returns after ads',
    detail: 'ROAS restated after returns — the only version that reflects what you kept.',
  },
  {
    title: 'New products',
    detail: 'How launches perform in their first 30 days and the 30 after that.',
  },
];

export default function Ads() {
  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Ads</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Spend, return and what the advertising actually bought.
        </p>
      </div>

      <Card>
        <NotConnected
          title="No ad platform is connected"
          needs="Meta Ads, Google Ads or a marketplace ad account"
        >
          Spend and attributed revenue live inside the ad platform. Your store's orders record that
          a sale happened, never which campaign paid for it — so nothing on this page can be
          derived from the data Ardent holds today.
        </NotConnected>
      </Card>

      <Card title="What this page will show" subtitle="Once an ad account is connected">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
          {WOULD_SHOW.map(s => (
            <div key={s.title} className="hstack" style={{ gap: 11, alignItems: 'flex-start' }}>
              <span className="avatar" style={{ borderRadius: 8, background: 'var(--surface-3)', flex: 'none' }}>
                <Megaphone size={14} style={{ color: 'var(--ink-2)' }} />
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{s.title}</div>
                <div className="small muted" style={{ marginTop: 3, lineHeight: 1.5 }}>{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="ladder-foot">
          Until then, the Sales page reports total revenue as a single bucket rather than splitting
          it into organic and ad-driven — a split nobody has measured is a guess.
          {' '}<Link to="/sales" className="linkish">Open Sales <ArrowRight size={12} /></Link>
        </div>
      </Card>
    </div>
  );
}
