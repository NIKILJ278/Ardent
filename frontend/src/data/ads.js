// Advertising.
//
// Spend, ROAS, clicks and attributed revenue have to come from the ad platforms
// themselves. None is connected, so nothing here models a campaign account.
// The revenue split reports all revenue as one bucket until attribution exists.

import { salesModel } from './engine.js';

export const ADS_CONNECTED = false;

/**
 * Where revenue comes from.
 *
 * Splitting organic from ad-driven revenue needs each order credited to a
 * campaign, which only the ad platforms can supply. Until one is connected the
 * honest split has a single bucket, with attribution marked as missing.
 */
export function revenueSplit(scope, prevScope) {
  const cur = salesModel(scope);
  const prev = prevScope ? salesModel(prevScope) : null;
  return {
    total: cur.netSales,
    prevTotal: prev?.netSales ?? null,
    rows: [{
      id: 'all',
      label: 'Net sales',
      blurb: 'All revenue — splitting organic from ad-driven needs an ad platform connected',
      value: cur.netSales,
      pct: 100,
      change: prev?.netSales ? ((cur.netSales - prev.netSales) / prev.netSales) * 100 : null,
      prevPct: prev ? 100 : null,
    }],
    adSpend: null,
    attributed: ADS_CONNECTED,
  };
}
