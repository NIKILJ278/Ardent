/**
 * Metric-level permissions.
 *
 * Sales and Finance read the SAME underlying numbers — there is no second
 * calculation anywhere. Permissions only decide which of those numbers a given
 * user is shown, so a Sales user and the CEO can never see figures that
 * disagree; one simply sees fewer of them.
 */

export const PERM = {
  SALES_PERFORMANCE:   'sales.performance',
  CHANNEL_PERFORMANCE: 'sales.channelPerformance',
  CHANNEL_ECONOMICS:   'sales.channelEconomics',
  UNIT_ECONOMICS:      'sales.unitEconomics',
  DIAGNOSTICS:         'sales.diagnostics',
  TARGETS:             'sales.targets',
  COGS:                'fin.cogs',
  CONTRIBUTION:        'fin.contribution',   // CM1 / CM2
  NET_MARGIN:          'fin.netMargin',      // net profit / net margin
  COMPANY_FINANCIALS:  'fin.company',
};

/** Everything a Sales user may see — deliberately stops short of profitability. */
const SALES_SET = [
  PERM.SALES_PERFORMANCE, PERM.CHANNEL_PERFORMANCE, PERM.CHANNEL_ECONOMICS,
  PERM.UNIT_ECONOMICS, PERM.DIAGNOSTICS, PERM.TARGETS,
];

export const ROLES = {
  sales: {
    id: 'sales', label: 'Sales', title: 'Sales Lead',
    blurb: 'Sells and runs channels. Sees demand and channel cost, not company profit.',
    permissions: SALES_SET,
  },
  finance: {
    id: 'finance', label: 'Finance', title: 'Finance Controller',
    blurb: 'Sees the full cost stack including COGS and contribution.',
    permissions: [...SALES_SET, PERM.COGS, PERM.CONTRIBUTION, PERM.NET_MARGIN, PERM.COMPANY_FINANCIALS],
  },
  ceo: {
    id: 'ceo', label: 'CEO', title: 'Chief Executive Officer',
    blurb: 'Full visibility across sales, economics and profitability.',
    permissions: [...SALES_SET, PERM.COGS, PERM.CONTRIBUTION, PERM.NET_MARGIN, PERM.COMPANY_FINANCIALS],
  },
};

export const DEFAULT_ROLE = 'ceo';

export function makeCan(roleId) {
  const role = ROLES[roleId] ?? ROLES[DEFAULT_ROLE];
  const set = new Set(role.permissions);
  const can = (perm) => set.has(perm);
  can.role = role;
  /** True when the viewer may see any profitability figure. */
  can.profit = set.has(PERM.CONTRIBUTION) || set.has(PERM.NET_MARGIN);
  return can;
}
