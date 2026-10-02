import { CHANNEL_BY_ID } from '../data/catalog.js';

/**
 * The validated categorical series colours, in fixed slot order.
 * Assigned per channel identity — never by rank — so a channel keeps the same
 * colour in every chart, legend, chip and tooltip regardless of how it sorts.
 */
export const SERIES_VARS = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)',
  'var(--series-4)', 'var(--series-5)', 'var(--series-6)',
];

export function channelColor(channelId) {
  const slot = CHANNEL_BY_ID[channelId]?.slot ?? 0;
  return SERIES_VARS[slot % SERIES_VARS.length];
}
