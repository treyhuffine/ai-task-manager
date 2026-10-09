import * as q from '@/lib/db/queries';
import type { FinancePrincipal } from '@/lib/db/finance-queries';
import { defaultFinanceViews } from './default-views';
import type { FinancePlan } from './contracts';

/** Deliberately named fictional records. Never invoked at startup. */
export function seedSyntheticFinance(p: FinancePrincipal) {
  q.configureFinance(p, {
    enabled: true,
    timezone: 'America/Denver',
    currency: 'USD',
  });
  const asOf = new Date().toISOString(),
    month = asOf.slice(0, 7),
    startOn = `${month}-01`,
    endDate = new Date(`${startOn}T12:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const endOn = endDate.toISOString().slice(0, 10);
  const account = (
    name: string,
    kind: 'cash' | 'credit' | 'mailbox',
    balanceMinor: number | null,
  ) =>
    q.createFinanceAccount(p, {
      name,
      kind,
      balanceMinor,
      provider: 'synthetic',
      currency: 'USD',
      connectionId: null,
      sourceId: `synthetic:${kind}`,
      balanceIncludesPending: false,
      historyStart: '2024-10-01',
      asOf,
    });
  const cash = account('Fictional checking', 'cash', 425000),
    card = account('Fictional card', 'credit', 86000),
    mail = account('Fictional receipts', 'mailbox', null);
  const tx = (
    sourceId: string,
    accountId: string,
    amountMinor: number,
    postedOn: string,
    merchant: string,
    category: string,
    kind: 'purchase' | 'refund' | 'income' | 'card_payment' = 'purchase',
    state: 'posted' | 'pending' = 'posted',
    obligationId: string | null = null,
  ) => ({
    sourceId,
    accountId,
    amountMinor,
    currency: 'USD',
    postedOn,
    authorizedOn: null,
    merchant,
    category,
    kind,
    state,
    pendingSourceId: null,
    obligationId,
    refundOf: null,
  });
  const added: ReturnType<typeof tx>[] = [];
  for (let back = 5; back >= 0; back--) {
    const d = new Date(`${startOn}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - back);
    const m = d.toISOString().slice(0, 7);
    added.push(
      tx(
        `${m}:income`,
        cash.id,
        -500000,
        `${m}-01`,
        'Fictional payroll',
        'income',
        'income',
      ),
      tx(
        `${m}:rent`,
        cash.id,
        180000,
        `${m}-02`,
        'Fictional rent',
        'fixed',
        'purchase',
        'posted',
        'rent',
      ),
      tx(
        `${m}:dining`,
        card.id,
        23500 + back * 1500,
        `${m}-03`,
        'Fictional cafe',
        'dining',
      ),
      tx(
        `${m}:music`,
        card.id,
        1600,
        `${m}-04`,
        'Fictional music',
        'subscriptions',
        'purchase',
        'posted',
        'music',
      ),
      tx(
        `${m}:video`,
        card.id,
        2400,
        `${m}-05`,
        'Fictional video',
        'subscriptions',
        'purchase',
        'posted',
        'video',
      ),
    );
  }
  added.push(
    tx(
      'return-purchase',
      card.id,
      12000,
      `${month}-03`,
      'Fictional shop',
      'shopping',
    ),
    tx(
      'return-credit',
      card.id,
      -8000,
      `${month}-05`,
      'Fictional shop',
      'shopping',
      'refund',
    ),
    tx(
      'pending-dining',
      card.id,
      4500,
      `${month}-06`,
      'Fictional dinner',
      'dining',
      'purchase',
      'pending',
    ),
    tx(
      'card-payment',
      cash.id,
      50000,
      `${month}-04`,
      'Fictional card payment',
      'transfer',
      'card_payment',
    ),
  );
  q.applyFinanceSync(p, {
    accountIds: [cash.id, card.id],
    generation: q.getFinanceSettings()!.generation,
    added,
    removed: [],
    asOf,
  });
  const evidence =
    q.getFinanceEvidenceBySource(p, mail.id, 'synthetic:refund-notice') ??
    q.saveFinanceEvidence(p, {
      data: {
        sourceId: 'synthetic:refund-notice',
        accountId: mail.id,
        kind: 'refund',
        merchant: 'Fictional shop',
        orderId: 'FICTIONAL-ORDER-001',
        occurredOn: `${month}-04`,
        currency: 'USD',
        totalMinor: 12000,
        promiseMinor: 9600,
        destination: 'card',
        deadlineOn: null,
        settlementDueOn: `${month}-05`,
        items: [
          {
            id: 'fictional-item',
            name: 'Fictional returned item',
            quantity: 1,
            amountMinor: 12000,
            returnedQuantity: 1,
          },
        ],
        excerpt:
          'Synthetic fixture: returned item $120, merchant refund promise $96. Card settlement $80.',
        confidence: 1,
        provenance: {
          source: 'synthetic',
          extractorVersion: 'fixture-v1',
          messageIds: ['fictional-message'],
          termsSource: null,
        },
      },
      reviewed: true,
    });
  const credit = q
    .financeTransactionsForCalculation(p, {
      accountIds: [card.id],
      startOn,
      endOn,
    })
    .find((t) => t.sourceId === 'return-credit')!;
  if (!q.listFinanceAllocations(p, [evidence.id]).length)
    q.matchFinanceEvidence(p, {
      evidenceId: evidence.id,
      transactionId: credit.id,
      amountMinor: 8000,
      decision: 'confirmed',
      confidence: 1,
      expectedRevision: 0,
      mutationKey: 'synthetic-refund-match',
    });
  const plan: FinancePlan = {
    currency: 'USD',
    timezone: 'America/Denver',
    startOn,
    endOn,
    incomeMinor: 500000,
    incomeConfidence: 'confirmed',
    categories: [
      {
        id: 'fixed',
        name: 'Fixed obligations',
        limitMinor: 200000,
        rollover: 'none',
        rolloverMinor: 0,
        variableForecastMinor: 0,
      },
      {
        id: 'dining',
        name: 'Dining',
        limitMinor: 50000,
        rollover: 'positive',
        rolloverMinor: 5000,
        variableForecastMinor: 10000,
      },
      {
        id: 'subscriptions',
        name: 'Subscriptions',
        limitMinor: 6000,
        rollover: 'none',
        rolloverMinor: 0,
        variableForecastMinor: 0,
      },
      {
        id: 'shopping',
        name: 'Shopping',
        limitMinor: 35000,
        rollover: 'none',
        rolloverMinor: 0,
        variableForecastMinor: 5000,
      },
      {
        id: 'other',
        name: 'Other',
        limitMinor: 50000,
        rollover: 'none',
        rolloverMinor: 0,
        variableForecastMinor: 15000,
      },
    ],
    obligations: [
      {
        id: 'rent',
        category: 'fixed',
        amountMinor: 180000,
        dueOn: `${month}-02`,
        kind: 'purchase',
        source: 'manual',
      },
      {
        id: 'music',
        category: 'subscriptions',
        amountMinor: 1600,
        dueOn: `${month}-04`,
        kind: 'purchase',
        source: 'manual',
      },
      {
        id: 'video',
        category: 'subscriptions',
        amountMinor: 2400,
        dueOn: `${month}-05`,
        kind: 'purchase',
        source: 'manual',
      },
    ],
    reserves: [
      {
        id: 'annual',
        name: 'Annual expenses',
        heldMinor: 50000,
        contributionMinor: 10000,
        targetMinor: 120000,
      },
    ],
    goals: [
      {
        id: 'savings',
        name: 'Savings',
        contributionMinor: 40000,
        targetMinor: 600000,
      },
    ],
  };
  const existing = q
    .listFinanceBudgets(p)
    .find((b) => b.name === 'Fictional monthly budget');
  const budget =
    existing ??
    q.createFinanceBudget(p, {
      name: 'Fictional monthly budget',
      plan,
      accountIds: [cash.id, card.id, mail.id],
      mutationKey: `synthetic-budget:${month}`,
    });
  const adopted =
    budget.state === 'proposal'
      ? q.changeFinanceBudget(p, {
          id: budget.id,
          expectedRevision: budget.revision,
          mutationKey: `synthetic-adopt:${month}`,
          adopt: true,
        })
      : budget;
  const prior = q.listFinanceViews(p),
    scope = {
      accountIds: budget.accountIds,
      startOn: added[0].postedOn,
      endOn,
      budgetId: budget.id,
      evidenceId: null,
    };
  const views = Object.entries(defaultFinanceViews).map(
    ([name, definition]) =>
      prior.find((v) => v.definition.title === definition.title) ??
      q.saveFinanceView(p, {
        definition,
        scope,
        expectedRevision: 0,
        mutationKey: `synthetic-view:${month}:${name}`,
      }),
  );
  q.reconcileFinance(p, scope);
  return { accounts: [cash, card, mail], budget: adopted, views, evidence };
}
