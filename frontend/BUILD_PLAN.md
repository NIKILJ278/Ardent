# Ardent — CEO Dashboard

Premium executive BI frontend for e-commerce companies and agencies managing
multiple brands. Mock data, no backend dependency.

## Run it

```bash
cd D:\Ardent\Ardent-main\frontend
npm install
npm run dev      # http://localhost:5173
npm run smoke    # SSR-renders every route + drill level, catches runtime errors
npm run build
```

Boots straight to `/overview`. No auth gate — not part of the brief.

## Architecture

```
src/
  lib/format.js         Indian currency (₹ Cr / L), deltas, dates
  lib/prng.js           mulberry32 — data is identical on every reload
  data/catalog.js       4 companies, 5 channels, 24 products, SKU variants
  data/engine.js        THE fact table + all rollups + health scoring
  data/business.js      goals, departments, timeline, reconciliation, sources
  state/AppState.jsx    company · period · comparison · goals · notes · theme
  state/Drilldown.jsx   the drill stack
  components/shell/     sidebar, topbar, company selector, period, export
  components/ui/        Card, Pill, Delta, Track, DataTable, Modal, BarList…
  components/charts/    RevenueTrend, MeasureBars, Bridge, HealthGauge
  components/drill/     DrilldownPanel — every level of the drill
  pages/                Overview, Sales, Finance, Goals, Reconciliation,
                        DataSources, Reports, Settings, Simple (People/
                        Insights/Inventory/Customers/Marketing/Help)
  styles/               tokens.css (light+dark), app.css
```

### Why one fact table

`data/engine.js` generates ~58,600 rows at `(day × company × channel × product)`
from a seeded PRNG. **Every** number in the app — a KPI, a chart point, a
channel total, a SKU row — is a filter+reduce over those same rows. That is what
makes drill-down trustworthy: a channel breakdown provably sums to the company
total (verified to Δ=0.000000), and a SKU sums to its product.

Drill path:
- All Brands → `Channel → Brand → Category → Product → SKU → Transactions`
- One company → `Channel → Category → Product → SKU → Transactions`

Composed figures (Net revenue, EBITDA, Net profit) additionally render a
**derivation panel** showing the exact lines that build them.

### Calibration

Demo "today" is fixed at **30 Sep 2026** so *This Month* reads as a complete
September. Lead brand (Kosha Living) lands at:

| Figure | Value |
|---|---|
| Net revenue | ₹1.26 Cr |
| EBITDA | ₹22.6 L (18.0%) |
| Company Health | 83 / 100 — Healthy |
| Runway | 7.7 months |
| vs Target | 8% below (matches the brief's copy) |

Cash is a balance-sheet constant per company, not derived from the period —
an early version made runway swing with the date range, which was wrong.

## Chart colour

Validated with the dataviz skill's `validate_palette.js` against this app's own
surfaces — **both modes PASS** every gate:

- Light `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4` on `#ffffff`
- Dark  `#3987e5 #d95926 #199e70 #c98500 #d55181` on `#141416`

The light run returns a contrast WARN (3 slots under 3:1), which obligates
relief — so **every channel mark carries a visible direct label**. Status
colours (good/warning/serious/critical) are reserved for state, never reused as
a series colour, and always ship with an icon + text label. No dual-axis charts
anywhere: the comparison series is the same measure on the same scale.

## Deliverables

1. ✅ CEO Overview 2. ✅ Company Health (weights editable) 3. ✅ KPI cards
4. ✅ Revenue chart + event markers 5. ✅ Sales 6. ✅ Finance
7. ✅ Goals & Targets (create/delete) 8. ✅ Departments 9. ✅ Product/SKU
10. ✅ Business Timeline 11. ✅ CEO Notes 12. ✅ Reconciliation (+ settlement
lines) 13. ✅ Data Sources 14. ✅ Data Upload (with duplicate detection)
15. ✅ Reports & Export 16. ✅ Company selector (+ All Brands) 17. ✅ Settings
18. ✅ Responsive nav 19. ✅ Drill-down 20. ✅ Realistic sample data

Scoped but deliberately not built — marked "Soon" in the sidebar: Inventory,
Customers, Marketing. People & HR is intentionally light per the brief.

## Repo note

`requirements.txt` and `run.py` carried unresolved merge-conflict markers from
commit `2dc7e66`. Resolved and staged; kept the `load_dotenv()` call since the
Anthropic key integration depends on it.
