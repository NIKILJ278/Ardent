// CSV export.
//
// Every file carries a header block naming the entity, the exact date range and
// the filters it was taken under. A downloaded extract outlives the screen it
// came from, so a file that does not say what window it covers is worse than no
// file at all — someone will read it as current.

import { iso, fmtDate } from './format.js';

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Filename-safe date range, e.g. 2026-07-01_2026-09-30. */
export function rangeSlug(period) {
  if (!period?.start || !period?.end) return 'all-dates';
  return `${iso(period.start)}_${iso(period.end)}`;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** `ardent_revenue-by-channel_kosha_2026-07-01_2026-09-30.csv` */
export function exportFilename(name, { company, period, suffix = 'csv' } = {}) {
  return ['ardent', slug(name), company ? slug(company) : null, rangeSlug(period)]
    .filter(Boolean).join('_') + `.${suffix}`;
}

/**
 * Build the file. `meta` is rendered as a two-column preamble above the table,
 * so the range travels with the data rather than only with the download.
 */
export function toCsv({ headers, rows, meta = {} }) {
  const preamble = Object.entries(meta)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k, v].map(esc).join(','));
  const body = [
    ...preamble,
    '',
    headers.map(esc).join(','),
    ...rows.map(r => r.map(esc).join(',')),
  ];
  return body.join('\n');
}

/** Standard preamble for anything exported against the global period. */
export function exportMeta({ title, company, period, channel, extra = {} }) {
  return {
    Report: title,
    Entity: company ?? 'All brands',
    'Date range': period ? `${fmtDate(period.start, 'long')} to ${fmtDate(period.end, 'long')}` : 'All dates',
    'Range (ISO)': period ? `${iso(period.start)} to ${iso(period.end)}` : '',
    Days: period ? Math.round((period.end - period.start) / 86400000) + 1 : '',
    Channel: channel ?? 'All channels',
    'Generated on': iso(new Date()),
    ...extra,
  };
}

/** Write the file to the user's machine. */
export function downloadCsv(filename, content) {
  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Build and download in one call. */
export function exportCsv({ name, headers, rows, meta, company, period }) {
  downloadCsv(
    exportFilename(name, { company, period }),
    toCsv({ headers, rows, meta })
  );
}
