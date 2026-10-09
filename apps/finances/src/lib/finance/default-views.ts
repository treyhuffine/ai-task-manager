import type { FinanceViewDefinition } from './contracts';
export const FINANCE_UI_RESOURCE = 'ui://personal-finance/renderer-v1.html';
export const defaultFinanceViews: Record<
  'Budget' | 'Needs attention' | 'Activity' | 'Subscriptions' | 'Accounts',
  FinanceViewDefinition
> = {
  Budget: {
    version: 1,
    title: 'Your monthly budget',
    layout: 'grid',
    components: [
      {
        id: 'remaining',
        type: 'metric',
        title: 'Remaining allocation',
        metric: 'remaining',
      },
      {
        id: 'posted',
        type: 'metric',
        title: 'Posted spending',
        metric: 'posted',
      },
      {
        id: 'pending',
        type: 'metric',
        title: 'Pending spending',
        metric: 'pending',
      },
      {
        id: 'cash',
        type: 'metric',
        title: 'Estimated cash available',
        metric: 'cashAvailable',
      },
      {
        id: 'categories',
        type: 'chart',
        title: 'Plan and spending',
        dataset: 'budget',
        style: 'bars',
      },
      {
        id: 'dining',
        type: 'scenario',
        title: 'Try a dining limit',
        categoryId: 'dining',
        minMinor: 0,
        maxMinor: 100000,
        stepMinor: 5000,
      },
      {
        id: 'comparison',
        type: 'chart',
        title: 'Scenario compared with your plan',
        dataset: 'comparison',
        style: 'bars',
      },
      {
        id: 'save-scenario',
        type: 'action',
        title: 'Save this scenario with the view',
        action: 'save_scenario',
      },
      {
        id: 'apply',
        type: 'action',
        title: 'Apply to budget',
        action: 'apply_scenario',
      },
      {
        id: 'undo',
        type: 'action',
        title: 'Undo last budget change',
        action: 'undo_budget',
      },
    ],
  },
  'Needs attention': {
    version: 1,
    title: 'Needs attention',
    layout: 'stack',
    components: [
      {
        id: 'findings',
        type: 'table',
        title: 'A few things worth following up',
        dataset: 'findings',
        columns: ['message', 'amountMinor', 'status'],
      },
      {
        id: 'refunds',
        type: 'timeline',
        title: 'Refund evidence',
        dataset: 'refunds',
      },
    ],
  },
  Activity: {
    version: 1,
    title: 'Activity',
    layout: 'stack',
    components: [
      {
        id: 'dates',
        type: 'filter',
        title: 'Activity dates',
        dimension: 'dates',
      },
      {
        id: 'accounts-filter',
        type: 'filter',
        title: 'Selected accounts',
        dimension: 'accounts',
      },
      {
        id: 'save-filter',
        type: 'action',
        title: 'Save these filters with the view',
        action: 'save_filters',
      },
      {
        id: 'trends',
        type: 'chart',
        title: 'Spending by month',
        dataset: 'trends',
        style: 'bars',
      },
      {
        id: 'transactions',
        type: 'table',
        title: 'Charges and credits',
        dataset: 'transactions',
        columns: ['postedOn', 'merchant', 'category', 'amountMinor', 'state'],
      },
    ],
  },
  Subscriptions: {
    version: 1,
    title: 'Subscriptions',
    layout: 'stack',
    components: [
      {
        id: 'subscriptions',
        type: 'table',
        title: 'Confirmed and suspected recurring payments',
        dataset: 'recurring',
        columns: [
          'merchant',
          'amountMinor',
          'cadence',
          'annualMinor',
          'nextOn',
          'status',
        ],
      },
    ],
  },
  Accounts: {
    version: 1,
    title: 'Accounts',
    layout: 'stack',
    components: [
      {
        id: 'accounts',
        type: 'table',
        title: 'Coverage and freshness',
        dataset: 'accounts',
        columns: ['name', 'state', 'asOf'],
      },
    ],
  },
};
