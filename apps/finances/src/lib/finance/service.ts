import * as q from '@/lib/db/queries';
import type { FinancePrincipal } from '@/lib/db/finance-queries';
import {
  detectRecurring,
  refundGaps,
  suggestEvidenceMatches,
} from './reconciliation';
import { createHash } from 'node:crypto';
import { sumMoney } from './money';
import type { FinanceScenarioChanges, FinanceViewScope } from './contracts';
import { OperationError } from '@/lib/server/operation';

export function financeDatasets(
  p: FinancePrincipal,
  scope: FinanceViewScope,
  changes?: FinanceScenarioChanges,
) {
  const accounts = q.requireFinance(p, scope.accountIds),
    transactions = q.financeTransactionsForCalculation(p, scope),
    asOf = new Date().toISOString();
  const evidenceAccounts = q.permittedFinanceEvidenceAccounts(
      p,
      scope.accountIds,
    ),
    evidence = evidenceAccounts.length
      ? q.listFinanceEvidence(p, evidenceAccounts)
      : [],
    allocations = q.listFinanceAllocations(
      p,
      evidence.map((e) => e.id),
    );
  const refunds = evidence
    .filter((e) => e.data.kind === 'refund' || e.data.kind === 'return')
    .map((e) => refundGaps(e, transactions, allocations, accounts));
  const recurring = detectRecurring(transactions, evidence);
  const budget = scope.budgetId ? q.getFinanceBudget(p, scope.budgetId) : null;
  const calculation = budget
    ? q.calculateFinanceBudget(p, budget.id, asOf, changes).result
    : null;
  const baseline = budget
    ? q.calculateFinanceBudget(p, budget.id, asOf).result
    : null;
  const trends = new Map<
    string,
    {
      name: string;
      category: string;
      currency: string;
      amountMinor: number;
      transactionIds: string[];
    }
  >();
  for (const t of transactions.filter(
    (t) =>
      t.state === 'posted' &&
      !['transfer', 'card_payment', 'income'].includes(t.kind),
  )) {
    const name = t.postedOn.slice(0, 7),
      key = `${name}:${t.category}:${t.currency}`;
    const prior = trends.get(key);
    trends.set(key, {
      name,
      category: t.category,
      currency: t.currency,
      amountMinor: sumMoney([prior?.amountMinor ?? 0, t.amountMinor]),
      transactionIds: [...(prior?.transactionIds ?? []), t.id],
    });
  }
  return {
    asOf,
    currency: budget?.plan.currency ?? accounts[0]?.currency ?? 'USD',
    budget: calculation,
    budgetRecord: budget,
    transactions: transactions.slice(-1000),
    transactionCount: transactions.length,
    budgetTransactions: budget
      ? q
          .financeTransactionsForCalculation(p, {
            accountIds: budget.accountIds,
            startOn: budget.plan.startOn,
            endOn: budget.plan.endOn,
          })
          .slice(0, 1000)
      : [],
    accounts: accounts.map((a) => ({
      ...a,
      connectionId: undefined,
      state: a.access === 'retained' ? 'Retained local history' : a.syncStatus,
      amountMinor: a.balanceMinor,
    })),
    evidence: scope.evidenceId
      ? evidence.filter((e) => e.id === scope.evidenceId)
      : evidence.slice(0, 200),
    refunds,
    recurring,
    findings: q
      .listFinanceFindings(p, scope.accountIds)
      .filter(
        (f) =>
          f.state === 'open' ||
          (f.state === 'snoozed' && f.snoozedUntil && f.snoozedUntil < asOf),
      )
      .map((f) => ({ ...f, status: f.state })),
    trends: [...trends.values()],
    comparison:
      calculation && baseline
        ? baseline.categories.map((c) => ({
            id: c.id,
            name: c.name,
            baselineMinor: c.limitMinor,
            scenarioMinor: calculation.categories.find(
              (row) => row.id === c.id,
            )!.limitMinor,
            amountMinor: calculation.categories.find((row) => row.id === c.id)!
              .forecastRemainingMinor,
          }))
        : [],
    incomplete: accounts.some(
      (a) =>
        a.access !== 'connected' ||
        ['stale','reconnect','error','syncing'].includes(a.syncStatus) ||
        !a.asOf ||
        Date.parse(asOf) - Date.parse(a.asOf) > 48 * 3600000,
    ),
  };
}
export function openFinanceView(
  p: FinancePrincipal,
  id: string,
  options: {
    expectedRevision?: number;
    changes?: FinanceScenarioChanges;
    filters?: { startOn?: string; endOn?: string; accountIds?: string[] };
  } = {},
) {
  const view = q.getFinanceView(p, id);
  if (
    options.expectedRevision !== undefined &&
    view.revision !== options.expectedRevision
  )
    throw new OperationError(409, {
      error: 'conflict',
      message: 'View changed. Reload its current revision.',
    });
  const scope = { ...view.scope, ...view.scope.filters, ...options.filters };
  if (scope.accountIds.some((id) => !view.scope.accountIds.includes(id)))
    throw new OperationError(403, {
      error: 'scope',
      message: 'Filter cannot widen account permissions',
    });
  if (scope.endOn <= scope.startOn)
    throw new OperationError(400, {
      error: 'dates',
      message: 'Invalid filter range',
    });
  // Filters affect only the requested dataset. The adopted budget always uses its
  // own period and selected accounts, independent of a six-month activity chart.
  const savedScenario = view.scenarioId
    ? q.getFinanceScenario(p, view.scenarioId)
    : null;
  const savedScenarioStale =
    !!savedScenario &&
    !!scope.budgetId &&
    savedScenario.baseRevision !==
      q.getFinanceBudget(p, scope.budgetId).revision;
  const data = financeDatasets(
    p,
    scope,
    options.changes ??
      (!savedScenarioStale ? savedScenario?.changes : undefined),
  );
  return {
    view,
    data,
    filterAccounts: q.requireFinance(p, view.scope.accountIds),
    scenarioChanges:
      options.changes ??
      (!savedScenarioStale ? savedScenario?.changes : undefined),
    savedScenarioStale,
    resourceUri: 'ui://personal-finance/renderer-v1.html',
  };
}
export function reconcileFinance(p: FinancePrincipal, scope: FinanceViewScope) {
  const accounts = q.requireFinance(p, scope.accountIds, 'write'),
    transactions = q.financeTransactionsForCalculation(p, scope),
    evidence = q.listFinanceEvidence(p, scope.accountIds);
  for (const e of evidence) {
    const prior = q.listFinanceAllocations(p, [e.id]);
    const purpose = e.data.kind === 'refund' ? 'refund' : 'purchase',
      target = purpose === 'refund' ? e.data.promiseMinor : e.data.totalMinor;
    const allocated = sumMoney(
      prior
        .filter(
          (a) =>
            ['human', 'confirmed'].includes(a.decision) &&
            (a.role ??
              ((transactions.find((t) => t.id === a.transactionId)
                ?.amountMinor ?? 0) < 0
                ? 'refund'
                : 'purchase')) === purpose,
        )
        .map((a) => a.amountMinor),
    );
    const remaining = target === null ? null : Math.max(0, target - allocated);
    const matchingEvidence = {
      ...e,
      data: {
        ...e.data,
        ...(purpose === 'refund'
          ? { promiseMinor: remaining }
          : { totalMinor: remaining }),
      },
    };
    const matches = (
      !['receipt','return','refund'].includes(e.data.kind)||remaining === null || remaining === 0
        ? []
        : suggestEvidenceMatches(matchingEvidence, transactions)
    ).filter((m) => !prior.some((a) => a.transactionId === m.transactionId));
    if (matches.length === 1 && matches[0].confidence >= 0.9) {
      const t = transactions.find((t) => t.id === matches[0].transactionId)!;
      q.matchFinanceEvidence(p, {
        evidenceId: e.id,
        transactionId: t.id,
        amountMinor: Math.abs(t.amountMinor),
        decision: 'confirmed',
        confidence: matches[0].confidence,
        expectedRevision: 0,
        mutationKey: `auto-match:${e.id}:${t.id}`,
      });
    }
    q.upsertFinanceFinding(p, {
      accountId: e.accountId,
      key: `ambiguous:${e.id}`,
      kind: 'ambiguous_match',
      message:
        'Several transactions could match this purchase. Review the evidence.',
      evidenceId: e.id,
      transactionIds: matches.map((m) => m.transactionId),
      state: matches.length > 1 ? 'open' : 'resolved',
      dueOn: null,
      amountMinor: null,
    });
    if (['refund', 'return'].includes(e.data.kind)) {
      const gap = refundGaps(
        e,
        transactions,
        q.listFinanceAllocations(p, [e.id]),
        accounts,
      );
        q.upsertFinanceFinding(p, {
          accountId: e.accountId,
          key: `deduction:${e.id}`,
          kind: 'deduction',
          message:
            'The refund promise is smaller than the returned purchase allocation. Review its breakdown.',
          evidenceId: e.id,
          transactionIds: gap.transactionIds,
          state: (gap.unexplainedDeductionMinor ?? 0) > 0 ? 'open' : 'resolved',
          dueOn: e.data.deadlineOn,
          amountMinor: gap.deductionMinor,
        });
        q.upsertFinanceFinding(p, {
          accountId: e.accountId,
          key: `settlement:${e.id}`,
          kind: 'settlement',
          message:
            'A promised refund has not fully settled at the stated destination.',
          evidenceId: e.id,
          transactionIds: gap.transactionIds,
          state:
            (gap.settlementGapMinor??0) > 0 &&
            !!gap.settlementDueOn &&
            gap.settlementDueOn <= new Date().toISOString().slice(0, 10)
              ? 'open'
              : 'resolved',
          dueOn: gap.settlementDueOn,
          amountMinor: gap.settlementGapMinor,
        });
      q.upsertFinanceFinding(p,{accountId:e.accountId,key:`allocation-review:${e.id}`,kind:'ambiguous_match',message:'A source amount changed after matching. Review the saved allocations.',evidenceId:e.id,transactionIds:gap.transactionIds,state:gap.status==='needs_review'?'open':'resolved',dueOn:null,amountMinor:null});
    }else{
      for(const kind of ['deduction','settlement'] as const)q.upsertFinanceFinding(p,{accountId:e.accountId,key:`${kind}:${e.id}`,kind,message:'The evidence no longer defines this refund finding.',evidenceId:e.id,transactionIds:[],state:'resolved',dueOn:null,amountMinor:null});
      q.upsertFinanceFinding(p,{accountId:e.accountId,key:`allocation-review:${e.id}`,kind:'ambiguous_match',message:'The evidence no longer defines this refund finding.',evidenceId:e.id,transactionIds:[],state:'resolved',dueOn:null,amountMinor:null});
    }
    q.upsertFinanceFinding(p,{accountId:e.accountId,key:`unknown-renewal:${e.id}`,kind:'ambiguous_match',message:'Renewal terms need an amount before a subscription estimate can be calculated.',evidenceId:e.id,transactionIds:[],state:e.data.kind==='renewal'&&e.data.totalMinor===null&&e.data.recurrence?.renewalMinor==null?'open':'resolved',dueOn:e.data.recurrence?.trialEndsOn??null,amountMinor:null});
  }
  const recurring = detectRecurring(transactions, evidence);
  const transactionIds=new Set(transactions.map(t=>t.id)), evidenceIds=new Set(evidence.map(e=>e.id));
  for(const old of q.listFinanceRecurring(p,scope.accountIds)){
    if(recurring.some(r=>r.key===old.key))continue;
    // A partial date scope cannot retire a stream whose source records are outside it.
    if(!old.transactionIds.every(id=>transactionIds.has(id)) || !old.evidenceIds.every(id=>evidenceIds.has(id)))continue;
    q.removeFinanceRecurring(p,old.id);
    for(const [prefix,kind] of [['cancelled','after_cancellation'],['price','price_change'],['renewal','renewal']] as const)
      q.upsertFinanceFinding(p,{accountId:old.accountId,key:`${prefix}:${old.key}`,kind,message:'The current source records no longer support this recurring finding.',evidenceId:null,transactionIds:old.transactionIds,state:'resolved',dueOn:null,amountMinor:null});
  }
  for (const r of recurring) {
    const { annualMinor, afterCancellation, ...row } = r;
    void annualMinor;
    q.storeFinanceRecurring(p, row);
    q.upsertFinanceFinding(p, {
      accountId: r.accountId,
      key: `cancelled:${r.key}`,
      kind: 'after_cancellation',
      message:
        'A charge posted after cancellation evidence. Review the timeline.',
      evidenceId: r.evidenceIds.at(-1) ?? null,
      transactionIds: r.transactionIds.slice(-1),
      state: afterCancellation ? 'open' : 'resolved',
      dueOn: null,
      amountMinor: r.amountMinor,
    });
    const priceIncreased =
      r.previousAmountMinor !== null &&
      r.previousAmountMinor > 0 &&
      r.amountMinor >
        r.previousAmountMinor *
          (1 +
            (q.getFinanceSettings()?.thresholds.priceChangePercent ?? 10) /
              100);
    q.upsertFinanceFinding(p, {
      accountId: r.accountId,
      key: `price:${r.key}`,
      kind: 'price_change',
      message: 'A recurring charge increased in price.',
      evidenceId: null,
      transactionIds: r.transactionIds.slice(-2),
      state: priceIncreased ? 'open' : 'resolved',
      dueOn: r.nextOn,
      amountMinor:
        r.previousAmountMinor === null
          ? null
          : r.amountMinor - r.previousAmountMinor,
    });
  }
  const duplicateGroups = new Map<string, typeof transactions>();
  for (const t of transactions.filter(
    (t) => t.state === 'posted' && t.kind === 'purchase',
  )) {
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          t.accountId,
          t.postedOn,
          t.currency,
          t.merchant.toLowerCase(),
          t.amountMinor,
        ]),
      )
      .digest('hex');
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), t]);
  }
  for (const [key, rows] of duplicateGroups)
    q.upsertFinanceFinding(p, {
      accountId: rows[0].accountId,
      key: `duplicate:${key}`,
      kind: 'duplicate',
      message:
        'Two posted charges share a merchant, date and amount. Check whether both were expected.',
      evidenceId: null,
      transactionIds: rows.map((t) => t.id),
      state: rows.length > 1 ? 'open' : 'resolved',
      dueOn: null,
      amountMinor: rows[0].amountMinor,
    });
  for(const old of q.listFinanceFindings(p,scope.accountIds).filter(f=>f.kind==='duplicate'&&f.state!=='resolved')){
    if(old.transactionIds.length && old.transactionIds.every(id=>transactionIds.has(id)) && !duplicateGroups.has(old.key.slice('duplicate:'.length)))
      q.upsertFinanceFinding(p,{accountId:old.accountId,key:old.key,kind:old.kind,message:old.message,evidenceId:old.evidenceId,transactionIds:old.transactionIds,state:'resolved',dueOn:old.dueOn,amountMinor:old.amountMinor});
  }
  const today = new Date().toISOString().slice(0, 10),
    soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  for (const r of recurring)
    q.upsertFinanceFinding(p, {
      accountId: r.accountId,
      key: `renewal:${r.key}`,
      kind: 'renewal',
      message:
        'A recurring payment or trial deadline is coming up. Review its terms before renewal.',
      evidenceId: r.evidenceIds[0] ?? null,
      transactionIds: r.transactionIds.slice(-1),
      state:
        r.status !== 'cancelled' && r.nextOn >= today && r.nextOn <= soon
          ? 'open'
          : 'resolved',
      dueOn: r.nextOn,
      amountMinor: r.amountMinor,
    });
  for (const a of accounts.filter(
    (a) => a.kind !== 'excluded' && a.kind !== 'mailbox',
  ))
    q.upsertFinanceFinding(p, {
      accountId: a.id,
      key: `connection:${a.id}`,
      kind: 'connection',
      message:
        'This account needs a connection repair or fresh sync before its coverage is dependable.',
      evidenceId: null,
      transactionIds: [],
      state:
        ['reconnect', 'error', 'stale'].includes(a.syncStatus) ||
        !a.asOf ||
        Date.now() - Date.parse(a.asOf) > 48 * 3600000
          ? 'open'
          : 'resolved',
      dueOn: null,
      amountMinor: null,
    });
  if (scope.budgetId) {
    const { result, budget } = q.calculateFinanceBudget(p, scope.budgetId);
    for (const g of budget.plan.goals) {
      const shortfall = Math.max(
        0,
        g.targetMinor - (g.heldMinor ?? 0) - g.contributionMinor,
      );
      q.upsertFinanceFinding(p, {
        accountId: accounts[0].id,
        key: `goal:${budget.id}:${g.id}`,
        kind: 'goal',
        message: `${g.name} needs a larger contribution to reach its target by the selected deadline.`,
        evidenceId: null,
        transactionIds: [],
        state:
          g.dueOn && g.dueOn < result.endOn && shortfall > 0
            ? 'open'
            : 'resolved',
        dueOn: g.dueOn ?? null,
        amountMinor: shortfall,
      });
    }
    q.upsertFinanceFinding(p, {
      accountId: accounts[0].id,
      key: `cash:${budget.id}`,
      kind: 'connection',
      message:
        'Known obligations exceed the estimated liquid cash. Inspect pending spending, card commitments and income assumptions.',
      evidenceId: null,
      transactionIds: [],
      state:
        result.cash.estimatedMinor !== null && result.cash.estimatedMinor < 0
          ? 'open'
          : 'resolved',
      dueOn: result.endOn,
      amountMinor:
        result.cash.estimatedMinor === null
          ? null
          : Math.max(0, -result.cash.estimatedMinor),
    });
    for (const c of result.categories)
      q.upsertFinanceFinding(p, {
        accountId: accounts[0].id,
        key: `overspend:${scope.budgetId}:${c.id}`,
        kind: 'overspending',
        message: `${c.name} is projected to exceed its allocation.`,
        evidenceId: null,
        transactionIds: c.transactionIds,
        state:
          c.forecastRemainingMinor <
          -(q.getFinanceSettings()?.thresholds.overspendMinor ?? 2500)
            ? 'open'
            : 'resolved',
        dueOn: result.endOn,
        amountMinor: Math.max(0, -c.forecastRemainingMinor),
      });
  }
  if (q.getFinanceSettings()?.autoTasks)
    for (const f of q
      .listFinanceFindings(p, scope.accountIds)
      .filter((f) => f.state === 'open'))
      q.createFinanceFollowup(p, f.id);
  return { findings: q.listFinanceFindings(p, scope.accountIds), recurring };
}
