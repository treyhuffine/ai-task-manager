import * as q from '@/lib/db/queries';
import type { FinancePrincipal } from '@/lib/db/finance-queries';
import { budgetPeriod, rolloverBalance } from './calculations';
import { sumMoney } from './money';
import type { FinancePlan } from './contracts';
import { detectRecurring } from './reconciliation';
import { defaultFinanceViews } from './default-views';
export function proposeFinanceBudget(
  p: FinancePrincipal,
  input: {
    accountIds: string[];
    incomeMinor?: number;
    startDay: number;
    mutationKey: string;
  },
) {
  const settings = q.getFinanceSettings()!,
    date = new Intl.DateTimeFormat('en-CA', {
      timeZone: settings.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  const [year, month, day] = date.split('-').map(Number),
    period = budgetPeriod(
      year,
      month - (day < input.startDay ? 1 : 0),
      input.startDay,
    ),
    history = new Date(`${period.startOn}T12:00Z`);
  history.setUTCMonth(history.getUTCMonth() - 6);
  const accounts = q.requireFinance(p, input.accountIds, 'write'),
    startOn = history.toISOString().slice(0, 10),
    tx = q
      .financeTransactionsForCalculation(p, {
        accountIds: input.accountIds,
        startOn,
        endOn: period.startOn,
      })
      .filter(
        (t) =>
          t.state === 'posted' &&
          t.currency === settings.currency &&
          accounts.some(
            (a) =>
              a.id === t.accountId && !['excluded', 'mailbox'].includes(a.kind),
          ),
      );
  const months = [...new Set(tx.map((t) => t.postedOn.slice(0, 7)))],
    median = (values: number[]) =>
      values.length
        ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]
        : 0;
  const categories = [
    'fixed',
    'dining',
    'subscriptions',
    'shopping',
    'other',
  ].map((id) => {
    const rows = tx.filter(
      (t) =>
        t.category === id &&
        !['transfer', 'card_payment', 'income'].includes(t.kind),
    );
    const monthly = months.map((m) =>
      sumMoney(
        rows.filter((t) => t.postedOn.startsWith(m)).map((t) => t.amountMinor),
      ),
    );
    const estimate = Math.max(0, median(monthly));
    return {
      id,
      name: {
        fixed: 'Fixed obligations',
        dining: 'Dining',
        subscriptions: 'Subscriptions',
        shopping: 'Shopping',
        other: 'Other',
      }[id]!,
      limitMinor: estimate,
      rollover: 'none' as const,
      rolloverMinor: 0,
      variableForecastMinor: estimate,
    };
  });
  const incomeHistory = months.map((m) =>
      sumMoney(
        tx
          .filter((t) => t.kind === 'income' && t.postedOn.startsWith(m))
          .map((t) => -t.amountMinor),
      ),
    ),
    incomeMinor =
      input.incomeMinor ??
      Math.max(0, incomeHistory.length ? Math.min(...incomeHistory) : 0);
  const current = q
    .financeTransactionsForCalculation(p, {
      accountIds: input.accountIds,
      ...period,
    })
    .filter(
      (t) =>
        t.state !== 'removed' &&
        t.currency === settings.currency &&
        accounts.some(
          (a) =>
            a.id === t.accountId && !['excluded', 'mailbox'].includes(a.kind),
        ),
    );
  const dateWithinPeriod = (day: number) => {
    const first = new Date(`${period.startOn}T12:00Z`),
      y = first.getUTCFullYear(),
      m = first.getUTCMonth();
    let due = new Date(
      Date.UTC(
        y,
        m,
        Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()),
      ),
    );
    if (due.toISOString().slice(0, 10) < period.startOn)
      due = new Date(
        Date.UTC(
          y,
          m + 1,
          Math.min(day, new Date(Date.UTC(y, m + 2, 0)).getUTCDate()),
        ),
      );
    return due.toISOString().slice(0, 10);
  };
  const annualHistory = new Date(`${period.startOn}T12:00Z`);
  annualHistory.setUTCFullYear(annualHistory.getUTCFullYear() - 2);
  const recurring = detectRecurring(
      q
        .financeTransactionsForCalculation(p, {
          accountIds: input.accountIds,
          startOn: annualHistory.toISOString().slice(0, 10),
          endOn: period.startOn,
        })
        .filter(
          (t) =>
            t.currency === settings.currency &&
            accounts.some(
              (a) =>
                a.id === t.accountId &&
                !['excluded', 'mailbox'].includes(a.kind),
            ),
        ),
      q.permittedFinanceEvidenceAccounts(p,input.accountIds).length?q.listFinanceEvidence(p,q.permittedFinanceEvidenceAccounts(p,input.accountIds)).filter(e=>e.data.currency===settings.currency):[],
    ),
    obligations: FinancePlan['obligations'] = recurring
      .filter(
        (r) =>
          r.status !== 'cancelled' &&
          r.cadence === 'monthly' &&
          !current.some(
            (t) =>
              (t.accountId === r.accountId || accounts.find(a=>a.id===r.accountId)?.kind==='mailbox') &&
              t.state !== 'removed' && ['purchase','fee','interest'].includes(t.kind) && t.currency===r.currency &&
              t.merchant.toLowerCase() === r.merchant.toLowerCase(),
          ),
      )
      .map((r) => ({
        id: r.key,
        accountId: accounts.find(a=>a.id===r.accountId)?.kind==='mailbox'?undefined:r.accountId,
        merchant: r.merchant,
        category: r.category,
        amountMinor: r.amountMinor,
        dueOn: dateWithinPeriod(Number(r.nextOn.slice(8))),
        kind: 'purchase',
        source: r.evidenceIds.length?'evidence':'inferred',
      }));
  const plan: FinancePlan = {
    currency: settings.currency,
    timezone: settings.timezone,
    startDay: input.startDay,
    ...period,
    incomeMinor,
    incomeConfidence: input.incomeMinor === undefined ? 'assumed' : 'confirmed',
    categories: categories.map((c) => ({
      ...c,
      variableForecastMinor: Math.max(
        0,
        c.variableForecastMinor -
          sumMoney(
            obligations
              .filter((o) => o.category === c.id)
              .map((o) => o.amountMinor),
          ) -
          sumMoney(
            current
              .filter(
                (t) =>
                  t.category === c.id &&
                  !['income', 'transfer', 'card_payment'].includes(t.kind),
              )
              .map((t) => t.amountMinor),
          ),
      ),
    })),
    obligations,
    reserves: recurring
      .filter((r) => r.cadence === 'annual')
      .map((r) => ({
        id: r.key,
        name: r.merchant,
        targetMinor: r.amountMinor,
        heldMinor: 0,
        contributionMinor: Math.ceil(r.amountMinor / 12),
      })),
    goals: [],
  };
  const budget = q.createFinanceBudget(p, {
    name: `Budget proposal ${period.startOn}`,
    plan,
    accountIds: input.accountIds,
    mutationKey: input.mutationKey,
  });
  const scope = {
    accountIds: input.accountIds,
    startOn,
    endOn: period.endOn,
    budgetId: budget.id,
    evidenceId: null,
  };
  const views = Object.entries(defaultFinanceViews).map(([name, definition]) =>
    q.saveFinanceView(p, {
      definition,
      scope,
      expectedRevision: 0,
      mutationKey: `${input.mutationKey}:${name}`,
    }),
  );
  return {
    budget,
    views,
    assumptions: [
      `Based on ${months.length} available months. Recent history is a starting point, not a recommendation to maintain that spending.`,
      `Category targets use the median of observed months, reducing the effect of unusual one-time spending. Review uncategorized and excluded accounts before adopting.`,
      input.incomeMinor === undefined
        ? 'Income uses the lowest observed month and is an assumption. Enter a conservative take-home figure if income is irregular.'
        : 'Income is your supplied take-home figure.',
      ...accounts
        .filter((a) => !a.historyStart || a.historyStart > startOn)
        .map((a) => `${a.name}: history is incomplete`),
    ],
  };
}
export function nextFinanceBudgetPeriod(
  p: FinancePrincipal,
  id: string,
  mutationKey: string,
) {
  const { budget, result } = q.calculateFinanceBudget(p, id),
    start = new Date(`${budget.plan.endOn}T12:00Z`),
    startDay = budget.plan.startDay ?? Number(budget.plan.startOn.slice(8));
  const period = budgetPeriod(
    start.getUTCFullYear(),
    start.getUTCMonth() + 1,
    startDay,
  );
  const plan = {
    ...budget.plan,
    startDay,
    ...period,
    reserves: budget.plan.reserves.map((r) => {
      const consumed =
          result.cash.reserveCommitments.find((row) => row.id === r.id)
            ?.consumedMinor ?? 0,
        heldMinor = Math.max(
          0,
          sumMoney([r.heldMinor, r.contributionMinor, -consumed]),
        );
      return {
        ...r,
        heldMinor,
        contributionMinor: Math.min(
          r.contributionMinor,
          Math.max(0, r.targetMinor - heldMinor),
        ),
      };
    }),
    goals: budget.plan.goals.map((g) => {
      const heldMinor = sumMoney([g.heldMinor ?? 0, g.contributionMinor]);
      return {
        ...g,
        heldMinor,
        contributionMinor: Math.min(
          g.contributionMinor,
          Math.max(0, g.targetMinor - heldMinor),
        ),
      };
    }),
    categories: budget.plan.categories.map((c) => ({
      ...c,
      rolloverMinor: rolloverBalance(
        c.rollover,
        result.categories.find((row) => row.id === c.id)!.remainingMinor,
      ),
    })),
    obligations: budget.plan.obligations.map((o) => {
      const y = start.getUTCFullYear(),
        m =
          start.getUTCMonth() +
          (Number(o.dueOn.slice(8)) < Number(period.startOn.slice(8)) ? 1 : 0),
        day = Number(o.dueOn.slice(8));
      return {
        ...o,
        dueOn: new Date(
          Date.UTC(
            y,
            m,
            Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()),
          ),
        )
          .toISOString()
          .slice(0, 10),
      };
    }),
  };
  return q.createFinanceBudget(p, {
    name: `Budget ${period.startOn}`,
    plan,
    accountIds: budget.accountIds,
    mutationKey,
  });
}
