# Ardent Frontend

React + Bootstrap dashboard for the Ardent D2C analytics backend. Styling and
palette were generated with the **UI/UX Pro Max** skill (Data-Dense Dashboard
style, blue + amber palette, Fira Sans / Fira Code typography).

## Stack

- React 19 + Vite
- React Router 6
- Bootstrap 5.3 (+ react-bootstrap)
- Recharts (charts)
- Axios (API client, JWT auto-refresh)
- lucide-react (SVG icons)

## Multi-theme

Four themes ship out of the box, switchable live from the top bar / auth screens:
`light`, `dark`, `ocean`, `forest`. They are pure CSS-variable token sets in
[src/themes/tokens.css](src/themes/tokens.css); the selection persists in
`localStorage`. Add a new theme by adding a `[data-theme="x"]` block there.

## Setup

```bash
cd frontend
npm install
cp .env.example .env      # point VITE_API_URL at the Flask backend
npm run dev               # http://localhost:5173
```

`VITE_API_URL` defaults to `http://localhost:5000`.

## Pages

| Route                     | Feature                                        |
|---------------------------|------------------------------------------------|
| `/login`, `/register`     | JWT auth                                        |
| `/dashboard`              | KPIs, channel chart, P&L waterfall, RTO, campaigns |
| `/analytics/channels`     | Channel profitability                           |
| `/analytics/waterfall`    | Gross-to-net waterfall                          |
| `/analytics/skus`         | SKU profit Pareto (80/20)                       |
| `/analytics/rto`          | RTO-by-state action matrix                      |
| `/analytics/campaigns`    | Scale / cut / monitor campaign board            |
| `/analytics/customers`    | RFM customer segments                           |
| `/analytics/inventory`    | Inventory health                                |
| `/connectors`             | Connect / sync / disconnect data sources        |
| `/ai`                     | Ask Analyst (Claude-powered chat)               |
| `/reports`                | Save / run / export CSV reports                 |
| `/alerts`                 | Generate & read rule-based alerts               |

## Demo login

Seed the backend (`python manage.py seed-demo`) then log in with:

```
demo@brandstack.local  /  password123
```
