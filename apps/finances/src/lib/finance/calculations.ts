import type {
  FinanceAccountRecord,
  FinanceTransactionRecord,
} from '@/db/types';
import {
  budgetPlanSchema,
  scenarioChangesSchema,
  type FinancePlan,
  type FinanceScenarioChanges,
} from './contracts';
import { exactAmount, sumMoney } from './money';

export function rolloverBalance(
  policy: FinancePlan['categories'][number]['rollover'],
  balance: number,
): number {
  return policy === 'none'
    ? 0
    : policy === 'positive'
      ? Math.max(0, exactAmount(balance))
      : exactAmount(balance);
}
export function calculateBudget(input: {
  plan: FinancePlan;
  transactions: FinanceTransactionRecord[];
  accounts: FinanceAccountRecord[];
  asOf: string;
}) {
  const plan = budgetPlanSchema.parse(input.plan);
  const included = new Set(
    input.accounts
      .filter((a) => a.kind !== 'excluded' && a.kind !== 'mailbox')
      .map((a) => a.id),
  );
  const transactions = input.transactions.filter(
    (t) =>
      included.has(t.accountId) &&
      t.state !== 'removed' &&
      t.currency === plan.currency &&
      t.postedOn >= plan.startOn &&
      t.postedOn < plan.endOn,
  );
  const spending = transactions.filter(
    (t) => !['transfer', 'card_payment', 'income'].includes(t.kind),
  );
  const paid = new Map<string, number>();
  const matched = new Map<string, string[]>();
  for (const obligation of plan.obligations) {
    const rows = transactions.filter(
      (t) =>
        t.obligationId === obligation.id &&
        (!obligation.accountId || t.accountId === obligation.accountId) &&
        (obligation.kind === 'card_payment'
          ? t.kind === 'card_payment'
          : t.amountMinor > 0 &&
            !['income', 'transfer', 'card_payment'].includes(t.kind)),
    );
    paid.set(obligation.id, sumMoney(rows.map((t) => Math.abs(t.amountMinor))));
    matched.set(
      obligation.id,
      rows.map((t) => t.id),
    );
  }
  const satisfied = new Set(
    plan.obligations
      .filter((o) => (paid.get(o.id) ?? 0) >= o.amountMinor)
      .map((o) => o.id),
  );
  const used = new Set(
    transactions.filter((t) => t.obligationId).map((t) => t.id),
  );
  for (const obligation of plan.obligations) {
    if (satisfied.has(obligation.id) || !obligation.merchant) continue;
    const matches = transactions.filter(
      (t) =>
        !used.has(t.id) &&
        t.amountMinor === obligation.amountMinor &&
        t.category === obligation.category &&
        (!obligation.accountId || t.accountId === obligation.accountId) &&
        t.merchant.toLowerCase() === obligation.merchant!.toLowerCase() &&
        Math.abs(Date.parse(t.postedOn) - Date.parse(obligation.dueOn)) <=
          7 * 86400000,
    );
    if (matches.length === 1) {
      satisfied.add(obligation.id);
      used.add(matches[0].id);
      paid.set(obligation.id, matches[0].amountMinor);
      matched.set(obligation.id, [matches[0].id]);
    }
  }
  const upcoming = plan.obligations
    .filter(
      (o) =>
        o.dueOn >= plan.startOn && o.dueOn < plan.endOn && !satisfied.has(o.id),
    )
    .map((o) => ({
      ...o,
      amountMinor: Math.max(0, o.amountMinor - (paid.get(o.id) ?? 0)),
    }));
  for (const card of input.accounts.filter((a) => a.kind === 'credit')) {
    const details = card.cardObligations;
    if (
      !details?.dueOn ||
      details.dueOn < plan.startOn ||
      details.dueOn >= plan.endOn ||
      plan.obligations.some(
        (o) => o.kind === 'card_payment' && o.accountId === card.id,
      )
    )
      continue;
    if (
      transactions.some(
        (t) =>
          t.kind === 'card_payment' &&
          t.accountId === card.id &&
          t.state !== 'removed' &&
          Math.abs(t.amountMinor) >= (details.minimumPaymentMinor ?? 0),
      )
    )
      continue;
    if (
      details.chosenPaymentMinor !== null ||
      details.minimumPaymentMinor !== null
    )
      upcoming.push({
        id: `card:${card.id}`,
        accountId: card.id,
        category: plan.categories[0].id,
        amountMinor: details.chosenPaymentMinor ?? details.minimumPaymentMinor!,
        dueOn: details.dueOn,
        kind: 'card_payment',
        source: details.source,
      });
  }
  const categories = plan.categories.map((c) => {
    const rows = spending.filter((t) => t.category === c.id);
    const postedMinor = sumMoney(
      rows.filter((t) => t.state === 'posted').map((t) => t.amountMinor),
    );
    const pendingMinor = sumMoney(
      rows.filter((t) => t.state === 'pending').map((t) => t.amountMinor),
    );
    const upcomingMinor = sumMoney(
      upcoming
        .filter((o) => o.category === c.id && o.kind === 'purchase')
        .map((o) => o.amountMinor),
    );
    const rolloverMinor = rolloverBalance(c.rollover, c.rolloverMinor);
    const remainingMinor = sumMoney([
      c.limitMinor,
      rolloverMinor,
      -postedMinor,
    ]);
    const forecastMinor = sumMoney([
      postedMinor,
      pendingMinor,
      upcomingMinor,
      c.variableForecastMinor,
    ]);
    return {
      id: c.id,
      name: c.name,
      limitMinor: c.limitMinor,
      rolloverMinor,
      postedMinor,
      pendingMinor,
      upcomingMinor,
      remainingMinor,
      afterPendingMinor: sumMoney([remainingMinor, -pendingMinor]),
      forecastMinor,
      forecastRemainingMinor: sumMoney([
        c.limitMinor,
        rolloverMinor,
        -forecastMinor,
      ]),
      transactionIds: rows.map((t) => t.id),
      obligationIds: upcoming
        .filter((o) => o.category === c.id)
        .map((o) => o.id),
    };
  });
  const unassigned = spending.filter(
    (t) => !plan.categories.some((c) => c.id === t.category),
  );
  const postedMinor = sumMoney(
    spending.filter((t) => t.state === 'posted').map((t) => t.amountMinor),
  );
  const pendingMinor = sumMoney(
    spending.filter((t) => t.state === 'pending').map((t) => t.amountMinor),
  );
  const allocatedMinor = sumMoney([
    ...plan.categories.map((c) => c.limitMinor),
    ...plan.reserves.map((r) => r.contributionMinor),
    ...plan.goals.map((g) => g.contributionMinor),
  ]);
  const reasons: string[] = [];
  const cash = input.accounts.filter(
    (a) => a.kind === 'cash' && a.currency === plan.currency,
  );
  const cards = input.accounts.filter(
    (a) => a.kind === 'credit' && a.currency === plan.currency,
  );
  if (!cash.length) reasons.push('No liquid account balances');
  for (const a of [...cash, ...cards]) {
    if (
      (a.kind === 'credit'
        ? (a.cardObligations?.currentBalanceMinor ?? a.balanceMinor)
        : a.balanceMinor) === null
    )
      reasons.push(`${a.name}: balance missing`);
    if (
      a.kind === 'credit' &&
      (!a.cardObligations?.dueOn ||
        a.cardObligations.minimumPaymentMinor === null)
    )
      reasons.push(`${a.name}: payment due date or minimum missing`);
    if (
      !a.asOf ||
      ['stale', 'reconnect', 'error', 'syncing'].includes(a.syncStatus) ||
      Date.parse(input.asOf) - Date.parse(a.asOf) > 48 * 60 * 60 * 1000
    )
      reasons.push(`${a.name}: source stale`);
    if (
      a.kind === 'credit' &&
      a.cardObligations &&
      Date.parse(input.asOf) - Date.parse(a.cardObligations.asOf) > 48 * 3600000
    )
      reasons.push(`${a.name}: statement details stale`);
    if (
      a.kind === 'credit' &&
      !a.cardObligations?.currentBalanceMinor &&
      a.balanceMinor === null
    )
      reasons.push(`${a.name}: card commitments unknown`);
  }
  if (input.accounts.some((a) => a.kind === 'excluded'))
    reasons.push('Excluded accounts make coverage incomplete');
  if (
    input.transactions.some(
      (t) =>
        included.has(t.accountId) &&
        t.state !== 'removed' &&
        t.currency !== plan.currency,
    ) ||
    input.accounts.some(
      (a) => a.kind !== 'mailbox' && a.currency !== plan.currency,
    )
  )
    reasons.push('Other currencies shown separately');
  if (unassigned.length) reasons.push('Uncategorized spending');
  if (plan.incomeConfidence === 'assumed')
    reasons.push('Expected income is an assumption');
  if (input.accounts.some((a) => a.provider === 'plaid'))
    reasons.push(
      'Pending balance treatment assumes current balances exclude pending charges',
    );
  // Outstanding card balances already represent incurred purchases. Card-payment
  // obligations settle that same balance, so deduct the greater amount only once.
  const cardPayments = upcoming.filter((o) => o.kind === 'card_payment');
  const unboundPayments = cardPayments.filter(
    (o) => !o.accountId || !cards.some((a) => a.id === o.accountId),
  );
  if (unboundPayments.length && cards.length !== 1)
    reasons.push(
      'Card payments need an account to reconcile outstanding balances',
    );
  const cardCommitments = sumMoney(
    cards.map((a) =>
      Math.max(
        0,
        a.cardObligations?.currentBalanceMinor ?? a.balanceMinor ?? 0,
        sumMoney(
          cardPayments
            .filter(
              (o) =>
                o.accountId === a.id || (cards.length === 1 && !o.accountId),
            )
            .map((o) => o.amountMinor),
        ),
      ),
    ),
  );
  const unresolvedPayments =
    cards.length === 1
      ? sumMoney(
          unboundPayments
            .filter((o) => !!o.accountId)
            .map((o) => o.amountMinor),
        )
      : sumMoney(unboundPayments.map((o) => o.amountMinor));
  const reconciledCardCommitments = sumMoney([
    cardCommitments,
    unresolvedPayments,
  ]);
  const pendingCash = sumMoney(
    spending
      .filter(
        (t) =>
          t.state === 'pending' &&
          cash.some((a) => a.id === t.accountId && !a.balanceIncludesPending),
      )
      .map((t) => t.amountMinor),
  );
  const newCardPending = sumMoney(
    spending
      .filter(
        (t) =>
          t.state === 'pending' &&
          cards.some((a) => a.id === t.accountId && !a.balanceIncludesPending),
      )
      .map((t) => t.amountMinor),
  );
  const incomeReceived = sumMoney(
    transactions
      .filter((t) => t.kind === 'income' && t.state === 'posted')
      .map((t) => -t.amountMinor),
  );
  const expectedIncome = Math.max(
    0,
    sumMoney([plan.incomeMinor, -incomeReceived]),
  );
  const reserveCommitments = plan.reserves.map((r) => {
    const funded = plan.obligations.filter((o) => o.reserveId === r.id);
    const consumedIds = new Set(funded.flatMap((o) => matched.get(o.id) ?? []));
    const consumed = sumMoney(
      transactions
        .filter((t) => consumedIds.has(t.id))
        .map((t) => Math.max(0, t.amountMinor)),
    );
    const remaining = Math.max(
      0,
      sumMoney([r.heldMinor, r.contributionMinor, -consumed]),
    );
    const upcomingFunding = sumMoney(
      upcoming.filter((o) => o.reserveId === r.id).map((o) => o.amountMinor),
    );
    return {
      id: r.id,
      consumedMinor: consumed,
      remainingMinor: remaining,
      overlapMinor: Math.min(remaining, upcomingFunding),
      earmarkedMinor: Math.max(0, remaining - upcomingFunding),
    };
  });
  const estimatedMinor = sumMoney([
    ...cash.map((a) => a.balanceMinor ?? 0),
    -reconciledCardCommitments,
    -newCardPending,
    -pendingCash,
    -sumMoney(
      upcoming.filter((o) => o.kind === 'purchase').map((o) => o.amountMinor),
    ),
    -sumMoney(reserveCommitments.map((r) => r.earmarkedMinor)),
    -sumMoney(
      plan.goals.flatMap((g) => [g.heldMinor ?? 0, g.contributionMinor]),
    ),
    expectedIncome,
  ]);
  return {
    currency: plan.currency,
    asOf: input.asOf,
    startOn: plan.startOn,
    endOn: plan.endOn,
    categories,
    postedMinor,
    pendingMinor,
    remainingMinor: sumMoney(categories.map((c) => c.remainingMinor)),
    forecastMinor: sumMoney(categories.map((c) => c.forecastMinor)),
    unallocatedMinor: sumMoney([plan.incomeMinor, -allocatedMinor]),
    unassignedTransactionIds: unassigned.map((t) => t.id),
    upcoming,
    cash: {
      status: reasons.length ? ('partial' as const) : ('complete' as const),
      estimatedMinor: cash.length ? estimatedMinor : null,
      reasons,
      expectedIncomeMinor: expectedIncome,
      cardCommitmentsMinor: reconciledCardCommitments,
      reserveCommitments,
    },
    coverage: {
      accountIds: [...included],
      excludedAccountIds: input.accounts
        .filter((a) => a.kind === 'excluded')
        .map((a) => a.id),
      otherCurrencies: [
        ...new Set([
          ...input.transactions
            .filter(
              (t) =>
                included.has(t.accountId) &&
                t.state !== 'removed' &&
                t.currency !== plan.currency,
            )
            .map((t) => t.currency),
          ...input.accounts
            .filter((a) => a.currency !== plan.currency)
            .map((a) => a.currency),
        ]),
      ],
    },
    forecastMethod:
      'Posted spending plus pending spending, unmatched known obligations, and the disclosed remaining variable-spending assumption. Promised refunds are excluded.',
  };
}
export function applyScenario(
  planInput: FinancePlan,
  changesInput: FinanceScenarioChanges,
): FinancePlan {
  const plan = budgetPlanSchema.parse(planInput),
    changes = scenarioChangesSchema.parse(changesInput);
  for (const id of Object.keys(changes.categoryLimits))
    if (!plan.categories.some((c) => c.id === id))
      throw new Error('Unknown category');
  for (const id of Object.keys(changes.goalContributions))
    if (!plan.goals.some((c) => c.id === id)) throw new Error('Unknown goal');
  for (const id of Object.keys(changes.obligationAmounts))
    if (!plan.obligations.some((c) => c.id === id))
      throw new Error('Unknown obligation');
  return budgetPlanSchema.parse({
    ...plan,
    incomeMinor: changes.incomeMinor ?? plan.incomeMinor,
    categories: plan.categories.map((c) => ({
      ...c,
      limitMinor: changes.categoryLimits[c.id] ?? c.limitMinor,
    })),
    goals: plan.goals.map((g) => ({
      ...g,
      contributionMinor: changes.goalContributions[g.id] ?? g.contributionMinor,
    })),
    obligations: plan.obligations.map((o) => ({
      ...o,
      amountMinor: changes.obligationAmounts[o.id] ?? o.amountMinor,
    })),
  });
}
export function budgetPeriod(
  year: number,
  month: number,
  startDay: number,
): { startOn: string; endOn: string } {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 31)
    throw new Error('Invalid budget start day');
  const day = (y: number, m: number) =>
    new Date(
      Date.UTC(
        y,
        m,
        Math.min(startDay, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()),
      ),
    )
      .toISOString()
      .slice(0, 10);
  return { startOn: day(year, month - 1), endOn: day(year, month) };
}
