import { bucketStart } from '../data/engine.js';
import { EVENT_KINDS, EVENT_SOURCES, eventImpact } from '../data/business.js';
import { CHANNEL_BY_ID } from '../data/catalog.js';
import { channelColor } from './channels.js';

/** Severity order, so a grouped dot never hides the worst thing on that date. */
const TONE_RANK = { critical: 5, serious: 4, warning: 3, good: 2, info: 1, neutral: 0 };

/**
 * Business events resolved into chart markers.
 *
 * Markers are matched to the chart's own buckets via `bucketStart`, so they
 * land correctly whether the axis is daily, weekly or monthly. Several events
 * can share a bucket, so they are grouped — otherwise the dots stack and only
 * the topmost is reachable.
 *
 * Display data (event type, channel names and colours, measured impact) is
 * resolved here so chart components stay free of business vocabulary.
 *
 * @param trend  chart points, each carrying `ts` and `label`
 * @param grain  'day' | 'week' | 'month' — must match how `trend` was built
 */
export function buildEventMarkers({ events = [], notes = [], companyId, channelId = 'all', trend = [], grain = 'day', impactLimit = 4 }) {
  if (!trend.length) return [];

  // Bucket key -> chart point, so an event maps to the point that contains it.
  const pointByBucket = new Map();
  for (const p of trend) {
    if (p.ts == null) continue;
    pointByBucket.set(bucketStart(p.ts, grain), p);
  }

  const groups = new Map();

  for (const e of [...events, ...notes]) {
    if (companyId !== 'all' && e.company !== companyId) continue;

    const impact = eventImpact(e);
    // Under a channel filter, only surface events that touched that channel.
    if (channelId !== 'all' && !impact.some(r => r.channel === channelId)) continue;

    const ts = new Date(e.date + 'T12:00:00').getTime();
    const point = pointByBucket.get(bucketStart(ts, grain));
    if (!point) continue;

    const kind = EVENT_KINDS[e.kind] ?? EVENT_KINDS.business;
    const src = EVENT_SOURCES[e.source] ?? EVENT_SOURCES.manual;
    const relevant = channelId === 'all' ? impact : impact.filter(r => r.channel === channelId);

    const item = {
      id: e.id,
      kindLabel: kind.label,
      tone: kind.tone,
      title: e.title,
      channels: relevant.slice(0, impactLimit).map(r => ({
        key: r.channel,
        name: CHANNEL_BY_ID[r.channel]?.name ?? r.channel,
        color: channelColor(r.channel),
        changePct: r.changePct,
        partial: r.partial,
        afterDays: r.afterDays,
      })),
      moreChannels: Math.max(0, relevant.length - impactLimit),
      source: src.capture === 'Manual'
        ? `Logged by ${e.author ?? 'CEO'}`
        : `Captured from ${src.label}`,
    };

    const key = point.label;
    if (!groups.has(key)) {
      groups.set(key, { id: key, label: point.label, value: point.value, tone: kind.tone, items: [item] });
    } else {
      const g = groups.get(key);
      g.items.push(item);
      if ((TONE_RANK[kind.tone] ?? 0) > (TONE_RANK[g.tone] ?? 0)) g.tone = kind.tone;
    }
  }

  return [...groups.values()];
}
