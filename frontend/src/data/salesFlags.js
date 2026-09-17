import { PERM } from '../state/permissions.js';

/**
 * Thresholds behind the performance flags. Stated once so they stay auditable
 * and tunable, rather than scattered through the components.
 */
export const FLAG_CUTS = {
  returnHigh: 12,        // % of gross
  returnWatch: 9,
  cancelHigh: 6,
  cancelWatch: 4.5,
  discountHigh: 15,      // % of gross
  channelCostHigh: 28,   // % of net sales
  logisticsHigh: 4,      // % of net sales
  cm1Low: 22,            // % of net sales
  declineWatch: -3,      // % growth
  strongGrowth: 10,
  targetBehind: 90,      // % achievement
};

/**
 * Subtle indicators pointing at what is worth investigating. Deliberately few:
 * a flag on every row is a flag on nothing. Each carries the measured number
 * that triggered it, so it is never an unexplained warning.
 */
export function salesFlags(m, { growthPct, achievementPct, can } = {}) {
  const out = [];
  const add = (tone, label, detail) => out.push({ tone, label, detail });

  if (m.returnPct >= FLAG_CUTS.returnHigh)
    add('critical', 'High returns', `${m.returnPct.toFixed(1)}% of gross sales`);
  else if (m.returnPct >= FLAG_CUTS.returnWatch)
    add('warning', 'Returns climbing', `${m.returnPct.toFixed(1)}% of gross sales`);

  if (m.cancelPct >= FLAG_CUTS.cancelHigh)
    add('critical', 'High cancellations', `${m.cancelPct.toFixed(1)}% of gross sales`);
  else if (m.cancelPct >= FLAG_CUTS.cancelWatch)
    add('warning', 'Cancellations elevated', `${m.cancelPct.toFixed(1)}% of gross sales`);

  if (m.discountPct >= FLAG_CUTS.discountHigh)
    add('warning', 'Discount dependency', `${m.discountPct.toFixed(1)}% of gross sales`);

  // Cost-based flags need the cost to be known. A null would otherwise compare as
  // zero and raise — or silently clear — a flag on a figure nobody measured.
  if (m.channelCostPct != null && m.channelCostPct >= FLAG_CUTS.channelCostHigh)
    add('critical', 'Channel cost high', `${m.channelCostPct.toFixed(1)}% of net sales`);

  if (m.logisticsPct != null && m.logisticsPct >= FLAG_CUTS.logisticsHigh)
    add('warning', 'Logistics above norm', `${m.logisticsPct.toFixed(1)}% of net sales`);

  // Contribution health is only ever surfaced to a permitted viewer.
  if (can?.(PERM.CONTRIBUTION) && m.cm1Pct != null && m.cm1Pct < FLAG_CUTS.cm1Low)
    add('critical', 'Thin contribution', `CM1 ${m.cm1Pct.toFixed(1)}% of net sales`);

  if (growthPct != null) {
    if (growthPct <= FLAG_CUTS.declineWatch)
      add('warning', 'Sales declining', `${growthPct.toFixed(1)}% vs previous period`);
    else if (growthPct >= FLAG_CUTS.strongGrowth)
      add('good', 'Strong growth', `+${growthPct.toFixed(1)}% vs previous period`);
  }

  if (achievementPct != null && achievementPct < FLAG_CUTS.targetBehind)
    add('warning', 'Behind target', `${achievementPct.toFixed(0)}% of target`);

  // A genuinely clean read is worth stating too.
  if (!out.some(f => f.tone !== 'good') && m.returnPct < FLAG_CUTS.returnWatch && m.cancelPct < FLAG_CUTS.cancelWatch)
    add('good', 'Healthy returns & cancellations', `${m.returnPct.toFixed(1)}% returns · ${m.cancelPct.toFixed(1)}% cancellations`);

  return out;
}

/** The single worst flag on a row, for compact table cells. */
export function worstFlag(flags) {
  const rank = { critical: 3, warning: 2, good: 1 };
  return [...flags].sort((a, b) => (rank[b.tone] ?? 0) - (rank[a.tone] ?? 0))[0] ?? null;
}
