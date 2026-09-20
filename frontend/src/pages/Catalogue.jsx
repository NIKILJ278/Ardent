import { useMemo } from 'react';
import { Package } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { useDrill } from '../state/Drilldown.jsx';
import { groupBy } from '../data/engine.js';
import { productsFor, productForVariant, variantById } from '../data/catalog.js';
import { money, num, pct } from '../lib/format.js';
import { Card, DataTable, Empty, Pill } from '../components/ui/index.jsx';
import { WatchButton } from '../components/watch/WatchButton.jsx';

/**
 * The catalogue as your store actually holds it: every product and variant that
 * sold in the selected period, with its own figures.
 *
 * Variants are not ratios of their product — each row is summed from that
 * variant's own order lines, which is why two sizes of the same product can
 * return at very different rates.
 */
export default function Catalogue() {
  const { scope, companyId, dataVersion } = useApp();
  const { open } = useDrill();

  const products = useMemo(() => productsFor(companyId), [companyId, dataVersion]);

  const rows = useMemo(() => groupBy(scope, 'variant').map(v => {
    const product = productForVariant(v.key);
    const meta = variantById(v.key);
    const netSales = v.grossSales - v.cancelValue - v.returnsValue - v.discount;
    return {
      id: v.key,
      sku: meta?.sku || '—',
      variant: meta?.title || 'Default',
      product: product?.name ?? 'Product no longer synced',
      productId: product?.id ?? null,
      category: product?.category ?? '',
      subcategory: product?.subcategory ?? '',
      units: v.units,
      orders: v.orders,
      grossSales: v.grossSales,
      netSales,
      asp: v.units ? (v.grossSales - v.discount) / v.units : 0,
      returnUnits: v.returnUnits,
      returnPct: v.grossSales ? (v.returnsValue / v.grossSales) * 100 : 0,
      costed: v.costGaps === 0,
    };
  }), [scope]);

  const uncosted = rows.filter(r => !r.costed).length;

  return (
    <div className="vstack" style={{ gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 20 }}>Catalogue</h1>
        <p className="muted small" style={{ margin: '3px 0 0' }}>
          Products and variants as your store holds them — {num(products.length)} product(s) synced.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <Empty icon={Package} title="Nothing sold in this period">
            Widen the date range, or connect a store on Data Sources if nothing has synced yet.
          </Empty>
        </Card>
      ) : (
        <Card
          title="Variants"
          subtitle="Each row is summed from that variant's own order lines"
          flush
          actions={uncosted > 0
            ? <span className="tiny muted">{num(uncosted)} variant(s) have no unit cost</span>
            : null}
        >
          <DataTable
            pageSize={20}
            searchKeys={['sku', 'variant', 'product', 'category']}
            columns={[
              { key: 'sku', label: 'SKU', render: r => <span className="mono" style={{ fontWeight: 600 }}>{r.sku}</span> },
              {
                key: 'product', label: 'Product',
                render: r => (
                  <span>
                    <span style={{ fontWeight: 500 }}>{r.product}</span>
                    <span className="tiny muted" style={{ display: 'block' }}>
                      {[r.category, r.subcategory].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                ),
              },
              { key: 'variant', label: 'Variant' },
              { key: 'units',  label: 'Units',  align: 'right', render: r => num(r.units) },
              { key: 'orders', label: 'Orders', align: 'right', render: r => num(r.orders) },
              { key: 'asp',    label: 'ASP',    align: 'right', render: r => money(r.asp) },
              { key: 'netSales', label: 'Net Sales', align: 'right', render: r => <strong>{money(r.netSales)}</strong> },
              {
                key: 'returnPct', label: 'Return %', align: 'right',
                render: r => (
                  <span style={r.returnPct > 12 ? { color: 'var(--critical-ink)', fontWeight: 600 } : undefined}>
                    {pct(r.returnPct)}
                  </span>
                ),
              },
              {
                key: 'costed', label: 'Costed', align: 'right', sortable: false,
                render: r => (r.costed
                  ? <Pill tone="good" icon={false}>Yes</Pill>
                  : <span className="tiny muted">no unit cost</span>),
              },
              {
                key: 'watch', label: '', sortable: false, align: 'right',
                render: r => (
                  <WatchButton
                    subject={{
                      company: companyId, product: r.productId, sku: r.id,
                      title: `${r.product} — ${r.variant}`,
                    }}
                    iconOnly
                  />
                ),
              },
            ]}
            rows={rows}
            initialSort={{ key: 'netSales', dir: 'desc' }}
            onRowClick={(r) => r.productId && open({
              type: 'product', label: r.product, scope: { ...scope, product: r.productId },
            })}
          />
        </Card>
      )}
    </div>
  );
}
