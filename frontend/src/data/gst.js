/* GST, worked out from order values and the rates the brand has provided.
 *
 * A SKU with its own rate uses it. A SKU without one is estimated at the
 * brand's default rate — and is counted, so the page can say how much of the
 * total rests on that guess instead of looking complete when it isn't.
 *
 *   prices include tax:   GST = value × r ÷ (1 + r)     taxable = value − GST
 *   prices exclude tax:   GST = value × r               taxable = value
 *
 * Place of supply, when the customer's state and the brand's are both known:
 * inside the state GST is half CGST, half SGST; across states it is IGST.
 * When either is unknown the tax is kept as a single "unallocated" amount —
 * never guessed into one bucket.
 */

const r2 = (n) => Math.round(n * 100) / 100;

/** GST on one value at a rate given in percent. */
export function gstOn(net, ratePct, inclusive) {
  const r = (Number(ratePct) || 0) / 100;
  const gst = inclusive ? (net * r) / (1 + r) : net * r;
  const taxable = inclusive ? net - gst : net;
  return { taxable, gst, invoice: taxable + gst };
}

const monthOf = (day) => day.slice(0, 7);
const blank = (key) => ({ key, taxable: 0, gst: 0, invoice: 0, cgst: 0, sgst: 0, igst: 0, unallocated: 0 });

function add(target, g, supply) {
  target.taxable += g.taxable; target.gst += g.gst; target.invoice += g.invoice;
  if (supply === 'intra') { target.cgst += g.gst / 2; target.sgst += g.gst / 2; }
  else if (supply === 'inter') target.igst += g.gst;
  else target.unallocated += g.gst;
}

/**
 * @param rows        /gst rows: { day, category, hsn, rate, inclusive, supply, net }
 * @param recorded    /gst recorded: { day, tax }
 * @param defaultRate percent applied to rows whose SKU has no rate (null = none set)
 * @param window      { start, end } as YYYY-MM-DD, inclusive
 */
export function computeGst(rows, recorded, defaultRate, { start, end } = {}) {
  const inWindow = (d) => !((start && d < start) || (end && d > end));
  const months = new Map();
  const categories = new Map();
  const hsns = new Map();
  const total = blank('total');
  const cover = { ownRate: 0, defaulted: 0, unrated: 0 }; // net value by where its rate came from
  let recordedTax = 0;

  for (const row of rows) {
    if (!inWindow(row.day)) continue;
    const own = row.rate != null;
    // No own rate and no default: the value is counted but carries no tax figure.
    const rate = own ? row.rate : defaultRate;
    if (rate == null) { if (row.category !== 'Shipping charged') cover.unrated += row.net; continue; }
    // Shipping has no SKU, so it says nothing about how well the SKUs are set up.
    if (row.category !== 'Shipping charged') cover[own ? 'ownRate' : 'defaulted'] += row.net;

    const g = gstOn(row.net, rate, row.inclusive);
    const bucket = (map, key) => { if (!map.has(key)) map.set(key, blank(key)); return map.get(key); };
    const m = bucket(months, monthOf(row.day));
    add(m, g, row.supply);
    add(bucket(categories, row.category), g, row.supply);
    add(total, g, row.supply);
    if (row.category !== 'Shipping charged') {
      // An HSN row is one code at one rate, as a GSTR-1 HSN summary is.
      const h = bucket(hsns, `${row.hsn ?? 'Not set'}|${rate}`);
      h.hsn = row.hsn; h.rate = rate; h.estimated = !own;
      add(h, g, row.supply);
    }
  }
  for (const r of recorded) {
    if (!inWindow(r.day)) continue;
    recordedTax += r.tax;
    const m = months.get(monthOf(r.day));
    if (m) m.recorded = (m.recorded ?? 0) + r.tax;
  }

  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]));
  const byKey = (a, b) => (a.key < b.key ? -1 : 1);
  const coverTotal = cover.ownRate + cover.defaulted + cover.unrated;
  return {
    total: round(total),
    recordedTax: r2(recordedTax),
    months: [...months.values()].sort(byKey).map(m => ({ ...round(m), recorded: m.recorded ?? 0 })),
    categories: [...categories.values()].sort((a, b) => b.gst - a.gst).map(round),
    hsn: [...hsns.values()].sort((a, b) => b.taxable - a.taxable).map(round),
    coverage: {
      ...round(cover),
      total: r2(coverTotal),
      ownRatePct: coverTotal ? (cover.ownRate / coverTotal) * 100 : 0,
    },
  };
}
