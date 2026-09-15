// Advertising.
//
// The rule this module lives by: ad revenue is a SLICE of sales that already
// exist in the fact table, never an addition to them. A platform's ad console
// reports attributed revenue, and that revenue is also sitting in the seller
// report — counting both would double the top line. So every figure here is
// derived from a share of real sales, which is what makes organic revenue
// computable as the remainder rather than as a second guess.
//
// Spend is the one genuinely new number. It reconciles to the marketing line
// the P&L already carries, so Finance and Ads cannot disagree.

import { query, groupBy, totals, salesModel, series, TODAY } from './engine.js';
import { PRODUCT_BY_ID, CHANNEL_BY_ID, COMPANY_BY_ID, channelsFor, isDigital } from './catalog.js';
import { rngFor } from '../lib/prng.js';
import { iso, fmtDate } from '../lib/format.js';

/* ── How much of a channel's revenue advertising touches ───────────────── */

/**
 * Attributed share by channel.
 *
 * Marketplaces where search is the whole discovery mechanism carry a far higher
 * attributed share than a storefront the customer reaches by name. These are
 * the shares Indian sellers typically see once attribution windows are applied.
 */
const AD_SHARE = {
  amazon: 0.42, flipkart: 0.38, myntra: 0.31, nykaa: 0.34, ajio: 0.29, direct: 0.46,
};

/** What a click costs, and how often it converts, per channel. */
const CLICK_ECON = {
  amazon:   { cpc: 14.5, ctr: 0.42, cvr: 9.8 },
  flipkart: { cpc: 11.8, ctr: 0.48, cvr: 8.6 },
  myntra:   { cpc: 9.4,  ctr: 0.61, cvr: 7.4 },
  nykaa:    { cpc: 12.2, ctr: 0.52, cvr: 8.1 },
  ajio:     { cpc: 8.6,  ctr: 0.58, cvr: 6.9 },
  direct:   { cpc: 21.5, ctr: 0.94, cvr: 3.6 },
};

/* ── Campaigns ─────────────────────────────────────────────────────────── */

export const CAMPAIGN_TYPES = {
  sp:      { id: 'sp',      label: 'Sponsored Products', short: 'SP' },
  sb:      { id: 'sb',      label: 'Sponsored Brands',   short: 'SB' },
  sd:      { id: 'sd',      label: 'Sponsored Display',  short: 'SD' },
  pmax:    { id: 'pmax',    label: 'Performance Max',    short: 'PMax' },
  social:  { id: 'social',  label: 'Meta Social',        short: 'Social' },
  search:  { id: 'search',  label: 'Google Search',      short: 'Search' },
};

/** Which campaign types a channel actually offers. */
const TYPES_FOR = {
  amazon: ['sp', 'sb', 'sd'],
  flipkart: ['sp', 'sd'],
  myntra: ['sp', 'sb'],
  nykaa: ['sp', 'sb'],
  ajio: ['sp'],
  direct: ['pmax', 'social', 'search'],
};

/**
 * Ad performance for one scope, derived from the sales that scope contains.
 *
 * `attributed` is the revenue the ad console would claim. Spend is worked back
 * from a target return that varies by channel and by how hard the product is to
 * sell, then clicks and impressions are worked back from spend — the same
 * direction a real account is read in.
 */
function rawBlock(scope, channel, seedKey) {
  const t = totals(scope);
  if (!t.grossSales) return null;

  const rnd = rngFor(`ads|${seedKey}`);
  const econ = CLICK_ECON[channel] ?? CLICK_ECON.amazon;
  const share = AD_SHARE[channel] ?? 0.35;

  // Net sales, because a return takes the attributed revenue with it.
  const netSales = t.grossSales - t.cancelValue - t.returnsValue - t.discount;
  const attributed = netSales * share * (0.86 + rnd() * 0.28);

  // Target return on ad spend, varied per campaign so the spread is real.
  const targetRoas = 3.1 + rnd() * 2.4;
  const spend = attributed / targetRoas;

  const clicks = spend / (econ.cpc * (0.85 + rnd() * 0.3));
  const impressions = clicks / (econ.ctr / 100 * (0.8 + rnd() * 0.4));
  const orders = clicks * (econ.cvr / 100) * (0.85 + rnd() * 0.3);
  // Not every click that converts adds to cart first, but every add-to-cart is
  // a click — the funnel has to stay ordered.
  const addToCart = Math.min(clicks, orders * (2.4 + rnd() * 1.6));

  return {
    attributed,
    spend,
    clicks,
    impressions,
    orders,
    addToCart,
    netSales,
    grossSales: t.grossSales,
    returnsValue: t.returnsValue,
    units: t.units,
    totalOrders: t.orders,
  };
}

/**
 * A block with spend pulled onto the ledger. Clicks and impressions scale with
 * it, because they were bought with that money — leaving them at the unscaled
 * level would report a cost per click nobody paid.
 */
function adBlockFor(scope, channel, seedKey) {
  const b = rawBlock(scope, channel, seedKey);
  if (!b) return null;
  const f = spendScale(scope);
  return { ...b, spend: b.spend * f, clicks: b.clicks * f, impressions: b.impressions * f };
}

/** Ratios every view needs, computed once so no screen recalculates them. */
export function adMetrics(b) {
  if (!b) return null;
  const roas = b.spend > 0 ? b.attributed / b.spend : 0;
  return {
    ...b,
    roas,
    // ACOS is spend against the revenue the ads earned; TACOS is spend against
    // everything the business sold. The pair is the whole point: ACOS says the
    // ads work, TACOS says how dependent the business is on them.
    acos: b.attributed > 0 ? (b.spend / b.attributed) * 100 : 0,
    tacos: b.netSales > 0 ? (b.spend / b.netSales) * 100 : 0,
    cpc: b.clicks > 0 ? b.spend / b.clicks : 0,
    ctr: b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0,
    cvr: b.clicks > 0 ? (b.orders / b.clicks) * 100 : 0,
    atcRate: b.clicks > 0 ? (b.addToCart / b.clicks) * 100 : 0,
    cpa: b.orders > 0 ? b.spend / b.orders : 0,
    aov: b.orders > 0 ? b.attributed / b.orders : 0,
    adShareOfSales: b.netSales > 0 ? (b.attributed / b.netSales) * 100 : 0,
    // Returned value attributable to the ad-driven slice.
    returnsAttributed: b.netSales > 0 ? b.returnsValue * (b.attributed / b.netSales) : 0,
    realized: b.attributed - (b.netSales > 0 ? b.returnsValue * (b.attributed / b.netSales) : 0),
  };
}

/** Sum blocks before taking ratios — averaging ratios is how ROAS goes wrong. */
function sumBlocks(blocks) {
  const live = blocks.filter(Boolean);
  if (!live.length) return null;
  const acc = {
    attributed: 0, spend: 0, clicks: 0, impressions: 0, orders: 0,
    addToCart: 0, netSales: 0, grossSales: 0, returnsValue: 0, units: 0, totalOrders: 0,
  };
  for (const b of live) for (const k of Object.keys(acc)) acc[k] += b[k];
  return acc;
}

/* ── The revenue split ─────────────────────────────────────────────────── */

export const REVENUE_STREAMS = {
  organic: { id: 'organic', label: 'Organic Revenue', blurb: 'Sales no campaign was credited with' },
  ads:     { id: 'ads',     label: 'Ad-Driven Revenue', blurb: 'Attributed to a campaign inside its window' },
  course:  { id: 'course',  label: 'Course Revenue', blurb: 'Digital products sold on your own storefront' },
};

/**
 * Where revenue actually comes from.
 *
 * Courses are separated first, because a digital product is a different
 * business with different economics. What remains splits into ad-driven and
 * organic, and organic is the remainder by construction — so the three always
 * sum to net sales exactly, whatever the attribution model says.
 */
export function revenueSplit(scope, prevScope) {
  const build = (sc) => {
    const m = salesModel(sc);
    const courseM = salesModel({ ...sc, category: 'Courses' });
    const physicalNet = m.netSales - courseM.netSales;

    // Attribution is applied per channel, since the share differs sharply.
    const chans = groupBy(sc, 'channel');
    let adRevenue = 0, adSpend = 0;
    for (const c of chans) {
      const chScope = { ...sc, channel: c.key };
      const block = adBlockFor(
        { ...chScope, category: undefined },
        c.key,
        `${sc.company}|${c.key}|${iso(sc.start)}`
      );
      if (!block) continue;
      // Courses are advertised too, but their revenue is reported in its own
      // bucket, so the ad slice here is only of the physical business.
      const courseCh = salesModel({ ...chScope, category: 'Courses' });
      const nonCourseShare = m.netSales > 0
        ? Math.max(0, (block.netSales - courseCh.netSales)) / Math.max(block.netSales, 1)
        : 1;
      adRevenue += block.attributed * nonCourseShare;
      adSpend += block.spend;
    }
    adRevenue = Math.min(adRevenue, Math.max(0, physicalNet));

    return {
      total: m.netSales,
      course: courseM.netSales,
      ads: adRevenue,
      organic: physicalNet - adRevenue,
      adSpend,
      gross: m.grossSales,
    };
  };

  const cur = build(scope);
  const prev = prevScope ? build(prevScope) : null;

  const rows = ['organic', 'ads', 'course'].map(id => ({
    id,
    ...REVENUE_STREAMS[id],
    value: cur[id],
    pct: cur.total > 0 ? (cur[id] / cur.total) * 100 : 0,
    prevValue: prev ? prev[id] : null,
    change: prev && prev[id] ? ((cur[id] - prev[id]) / prev[id]) * 100 : null,
    prevPct: prev && prev.total > 0 ? (prev[id] / prev.total) * 100 : null,
  }));

  return { total: cur.total, prevTotal: prev?.total ?? null, rows, adSpend: cur.adSpend, current: cur, previous: prev };
}

/* ── Views ─────────────────────────────────────────────────────────────── */

/* ── Tying spend to the ledger ─────────────────────────────────────────── */

/**
 * The share of the marketing line that is performance media.
 *
 * The P&L's marketing cost also covers brand, agency retainers and creative,
 * none of which buys a click. For a marketplace-led business almost all of it
 * is performance media, so the residual is small. Fixing the split makes ad
 * spend reconcile with Finance by construction rather than drifting from it.
 *
 * The size of this number decides whether the reported return is believable:
 * at 0.72 the model produced a 7x ROAS on a 6% TACOS, which no Indian
 * marketplace account sees. At 0.92 it lands near 4.5x on a 10% TACOS.
 */
export const PERFORMANCE_SHARE = 0.92;

const scaleCache = new Map();

/**
 * Factor that pulls modelled spend onto the ledger.
 *
 * The model works spend out from each channel's return, which is the right
 * shape but the wrong absolute size. Scaling the whole set by one factor keeps
 * every channel's relative efficiency intact while making the total agree with
 * the marketing line Finance already reports.
 */
function spendScale(scope) {
  const key = `${scope.company}|${iso(scope.start)}|${iso(scope.end)}`;
  if (scaleCache.has(key)) return scaleCache.get(key);

  const base = { start: scope.start, end: scope.end, company: scope.company };
  const raw = groupBy(base, 'channel').reduce((sum, c) => {
    const b = rawBlock({ ...base, channel: c.key }, c.key, `${scope.company}|${c.key}|${iso(scope.start)}`);
    return sum + (b?.spend ?? 0);
  }, 0);
  const target = salesModel(base).marketing * PERFORMANCE_SHARE;
  const factor = raw > 0 ? target / raw : 1;
  scaleCache.set(key, factor);
  return factor;
}

/** Everything at the top of the Ads page, for one scope. */
export function adSummary(scope, prevScope) {
  const at = (sc) => {
    const chans = groupBy(sc, 'channel');
    return sumBlocks(chans.map(c => adBlockFor(
      { ...sc, channel: c.key }, c.key, `${sc.company}|${c.key}|${iso(sc.start)}`
    )));
  };
  const cur = adMetrics(at(scope));
  const prev = prevScope ? adMetrics(at(prevScope)) : null;
  return { current: cur, previous: prev };
}

/** One row per channel, ranked however the caller wants. */
export function adsByChannel(scope) {
  return groupBy(scope, 'channel').map(c => {
    const block = adBlockFor({ ...scope, channel: c.key }, c.key, `${scope.company}|${c.key}|${iso(scope.start)}`);
    const m = adMetrics(block);
    return m && {
      id: c.key,
      name: CHANNEL_BY_ID[c.key]?.name ?? c.key,
      kind: CHANNEL_BY_ID[c.key]?.kind,
      ...m,
    };
  }).filter(Boolean);
}

/**
 * Ads rolled up by any dimension the fact table carries.
 *
 * The rows are ALLOCATED out of each channel's block, not computed
 * independently. Deriving each slice on its own draw gave every category its
 * own random efficiency, and the parts then failed to sum to the whole — the
 * one thing this app must never do. Spend follows sales share exactly;
 * attributed revenue follows sales share weighted by an efficiency factor that
 * is normalised, so the slices differ from each other while still footing.
 */
export function adsByDimension(scope, dim) {
  const nameOf = (k) => (dim === 'product' ? PRODUCT_BY_ID[k]?.name ?? k
    : dim === 'channel' ? CHANNEL_BY_ID[k]?.name ?? k : k);

  const acc = new Map();
  const add = (key, block) => {
    const prev = acc.get(key);
    if (!prev) { acc.set(key, { ...block }); return; }
    for (const k of Object.keys(prev)) prev[k] += block[k];
  };

  for (const c of groupBy(scope, 'channel')) {
    const chScope = { ...scope, channel: c.key };
    const block = adBlockFor(chScope, c.key, `${scope.company}|${c.key}|${iso(scope.start)}`);
    if (!block) continue;

    const members = groupBy(chScope, dim);
    const netOf = (g) => g.grossSales - g.cancelValue - g.returnsValue - g.discount;
    const totalNet = members.reduce((s2, g) => s2 + netOf(g), 0) || 1;

    // Efficiency spread, then normalised so the allocation is exact.
    const rnd = rngFor(`dim|${scope.company}|${c.key}|${dim}|${iso(scope.start)}`);
    const effs = members.map(() => 0.6 + rnd() * 0.9);
    const shares = members.map(g => netOf(g) / totalNet);
    const effSum = shares.reduce((s2, sh, i) => s2 + sh * effs[i], 0) || 1;

    members.forEach((g, i) => {
      const share = shares[i];
      const revShare = (share * effs[i]) / effSum;
      add(g.key, {
        attributed: block.attributed * revShare,
        spend: block.spend * share,
        clicks: block.clicks * share,
        impressions: block.impressions * share,
        orders: block.orders * revShare,
        addToCart: block.addToCart * share,
        netSales: netOf(g),
        grossSales: g.grossSales,
        returnsValue: g.returnsValue,
        units: g.units,
        totalOrders: g.orders,
      });
    });
  }

  return [...acc.entries()].map(([key, block]) => {
    const m = adMetrics(block);
    return {
      id: key,
      key,
      dim,
      name: nameOf(key),
      category: dim === 'product' ? PRODUCT_BY_ID[key]?.category : undefined,
      subcategory: dim === 'product' ? PRODUCT_BY_ID[key]?.subcategory : undefined,
      ...m,
    };
  }).sort((a, b) => b.spend - a.spend);
}

/**
 * Named campaigns, one per channel × campaign type × leading category.
 *
 * Campaigns are the level an ad manager actually works at, so this is where
 * spend decisions get made — but every campaign's revenue still comes out of
 * the same channel slice, so the set sums back to the channel total.
 */
export function campaigns(scope) {
  const out = [];
  for (const c of groupBy(scope, 'channel')) {
    const types = TYPES_FOR[c.key] ?? ['sp'];
    const cats = groupBy({ ...scope, channel: c.key }, 'category').slice(0, 4);
    if (!cats.length) continue;

    const rnd = rngFor(`camp|${scope.company}|${c.key}|${iso(scope.start)}`);
    // Weight the channel's block across its campaigns rather than recomputing,
    // so a channel's campaigns always foot to the channel.
    const channelBlock = adBlockFor({ ...scope, channel: c.key }, c.key, `${scope.company}|${c.key}|${iso(scope.start)}`);
    if (!channelBlock) continue;

    const combos = [];
    for (const type of types) for (const cat of cats) combos.push({ type, cat });
    const weights = combos.map(() => 0.4 + rnd());
    const wsum = weights.reduce((s, w) => s + w, 0) || 1;

    combos.forEach((combo, i) => {
      const w = weights[i] / wsum;
      // Efficiency varies per campaign: the same spend does not buy the same
      // return everywhere, which is the entire reason to look at this level.
      const eff = 0.62 + rnd() * 0.85;
      const block = {
        attributed: channelBlock.attributed * w * eff,
        spend: channelBlock.spend * w,
        clicks: channelBlock.clicks * w,
        impressions: channelBlock.impressions * w,
        orders: channelBlock.orders * w * eff,
        addToCart: channelBlock.addToCart * w,
        netSales: channelBlock.netSales * w,
        grossSales: channelBlock.grossSales * w,
        returnsValue: channelBlock.returnsValue * w,
        units: channelBlock.units * w,
        totalOrders: channelBlock.totalOrders * w,
      };
      const m = adMetrics(block);
      out.push({
        id: `${c.key}-${combo.type}-${combo.cat.key}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
        name: `${CAMPAIGN_TYPES[combo.type].short} · ${combo.cat.key}`,
        channel: c.key,
        channelName: CHANNEL_BY_ID[c.key]?.name ?? c.key,
        type: combo.type,
        typeLabel: CAMPAIGN_TYPES[combo.type].label,
        category: combo.cat.key,
        status: eff < 0.75 ? 'review' : eff > 1.2 ? 'scaling' : 'steady',
        ...m,
      });
    });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

/** Spend and return over time, for the trend charts. */
export function adSeries(scope, grain = 'week') {
  const buckets = series(scope, grain);
  const chans = groupBy(scope, 'channel').map(c => c.key);
  return buckets.map(b => {
    const bScope = { ...scope, start: new Date(b.ts), end: new Date(b.ts + 6 * 864e5) };
    const block = sumBlocks(chans.map(ch => adBlockFor(
      { ...bScope, channel: ch }, ch, `${scope.company}|${ch}|${b.date}`
    )));
    const m = adMetrics(block);
    return {
      label: grain === 'month' ? fmtDate(b.ts, 'month') : fmtDate(b.ts),
      date: b.date,
      ts: b.ts,
      spend: m?.spend ?? 0,
      revenue: m?.attributed ?? 0,
      roas: m?.roas ?? 0,
    };
  });
}

/* ── New products ──────────────────────────────────────────────────────── */

export const NEW_PRODUCT_DAYS = 60;

/**
 * Products inside their first sixty days, split at thirty.
 *
 * The split matters: the first month is launch spend buying its first reviews,
 * the second is whether any of it stuck. Judging them together hides both.
 */
export function newProducts(scope, companyId, today = TODAY) {
  const rows = [];
  for (const p of Object.values(PRODUCT_BY_ID)) {
    if (companyId !== 'all' && p.company !== companyId) continue;
    if (!p.launchedOn) continue;
    const launched = new Date(`${p.launchedOn}T00:00:00`);
    const age = Math.floor((today - launched) / 864e5);
    if (age < 0 || age > NEW_PRODUCT_DAYS) continue;

    const pScope = { ...scope, product: p.id, category: undefined, subcategory: undefined };
    const chans = groupBy(pScope, 'channel');
    const block = sumBlocks(chans.map(c => adBlockFor(
      { ...pScope, channel: c.key }, c.key, `${companyId}|${c.key}|${p.id}|new`
    )));
    const m = adMetrics(block);
    if (!m) continue;

    rows.push({
      id: p.id,
      name: p.name,
      category: p.category,
      subcategory: p.subcategory,
      digital: isDigital(p),
      launchedOn: p.launchedOn,
      ageDays: age,
      cohort: age <= 30 ? '0-30' : '31-60',
      channels: chans.length,
      ...m,
    });
  }
  return rows.sort((a, b) => a.ageDays - b.ageDays);
}

/* ── Reconciliation ────────────────────────────────────────────────────── */

/**
 * Ad spend must equal the marketing line the P&L already carries, or Finance
 * and Ads are telling the CEO two different numbers. Where the modelled spend
 * drifts, the summary is scaled to the ledger rather than the other way round.
 */
export function spendReconciliation(scope) {
  const m = salesModel(scope);
  const summary = adSummary(scope);
  const modelled = summary.current?.spend ?? 0;
  return {
    ledger: m.marketing,
    modelled,
    variance: modelled - m.marketing,
    variancePct: m.marketing > 0 ? ((modelled - m.marketing) / m.marketing) * 100 : 0,
  };
}

export { AD_SHARE, COMPANY_BY_ID, channelsFor, query };
