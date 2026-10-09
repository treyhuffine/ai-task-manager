import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { getRawDb, resetDb } from '@/lib/db';
import { seedSyntheticFinance } from './synthetic';
import { allocateMoney, parseMoney, sumMoney } from './money';
import {
  applyScenario,
  budgetPeriod,
  calculateBudget,
  rolloverBalance,
} from './calculations';
import {
  viewDefinitionSchema,
  evidenceSchema,
  transactionSchema,
} from './contracts';
import { normalizeFinanceCsv, parseFinanceCsv } from './imports';
import { openFinanceView, reconcileFinance } from './service';
import { refundGaps, detectRecurring } from './reconciliation';
import { nextFinanceBudgetPeriod, proposeFinanceBudget } from './onboarding';
import { mergeFinanceCardObligations } from './sources';

let home: TestHome;
const owner = q.financeOwner;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-finance-' });
});
afterEach(async () => {
  await home.cleanup();
});
describe('exact financial arithmetic', () => {
  it('rejects fractional minor units and preserves every allocated cent', () => {
    expect(() => sumMoney([0.1])).toThrow();
    expect(() => sumMoney([Number.MAX_SAFE_INTEGER, 1])).toThrow();
    expect(allocateMoney(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateMoney(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });
  it('parses decimal currency without binary rounding', () => {
    expect(parseMoney('19.99', 'USD')).toBe(1999);
    expect(parseMoney('123', 'JPY')).toBe(123);
    expect(() => parseMoney('1.001', 'USD')).toThrow();
  });
  it('clamps a 31st-day period and snapshots rollover policy', () => {
    expect(budgetPeriod(2026, 2, 31)).toEqual({
      startOn: '2026-02-28',
      endOn: '2026-03-31',
    });
    expect(rolloverBalance('positive', -100)).toBe(0);
    expect(rolloverBalance('both', -100)).toBe(-100);
    expect(rolloverBalance('none', 200)).toBe(0);
  });
});
describe('durable finance operations', () => {
  it('keeps pending spending separate and excludes transfers and card payments', () => {
    const f = seedSyntheticFinance(owner),
      result = q.calculateFinanceBudget(owner, f.budget.id).result;
    expect(result.postedMinor).toBe(211500);
    expect(result.pendingMinor).toBe(4500);
    expect(
      result.categories.find((c) => c.id === 'dining')?.remainingMinor,
    ).toBe(31500);
    expect(result.upcoming).toHaveLength(0);
    expect(result.forecastMethod).toContain('Promised refunds are excluded');
  });
  it('does not silently adopt a proposal and applies a scenario once with undo', () => {
    const f = seedSyntheticFinance(owner),
      base = q.getFinanceBudget(owner, f.budget.id);
    const changes = {
      categoryLimits: {
        dining:
          base.plan.categories.find((c) => c.id === 'dining')!.limitMinor -
          15000,
      },
      goalContributions: {},
      obligationAmounts: { music: 0, video: 0 },
    };
    const scenario = q.saveFinanceScenario(owner, {
      budgetId: base.id,
      name: 'Spend less',
      changes,
      expectedRevision: 0,
      mutationKey: 'scenario-save-001',
    });
    expect(q.getFinanceBudget(owner, base.id)).toEqual(base);
    const input = {
      scenarioId: scenario.id,
      expectedBudgetRevision: base.revision,
      mutationKey: 'scenario-apply-001',
    };
    const changed = q.applyFinanceScenario(owner, input);
    expect(q.applyFinanceScenario(owner, input)).toEqual(changed);
    expect(changed.revision).toBe(base.revision + 1);
    expect(changed.plan.obligations.map((o) => o.amountMinor)).toEqual([
      180000, 0, 0,
    ]);
    const undone = q.changeFinanceBudget(owner, {
      id: base.id,
      expectedRevision: changed.revision,
      mutationKey: 'scenario-undo-001',
      undo: true,
    });
    expect(undone.plan).toEqual(base.plan);
  });
  it('preserves corrections across pending replacement and modified/removed batches', () => {
    const f = seedSyntheticFinance(owner),
      pending = q
        .listFinanceTransactions(owner, {
          accountIds: [f.accounts[1].id],
          startOn: f.budget.plan.startOn,
          endOn: f.budget.plan.endOn,
        })
        .rows.find((t) => t.state === 'pending')!;
    q.overrideFinanceTransaction(owner, {
      id: pending.id,
      category: 'shopping',
      expectedRevision: 0,
      mutationKey: 'correction-001',
    });
    const batch = {
      accountIds: [pending.accountId],
      generation: q.getFinanceSettings()!.generation,
      added: [
        {
          sourceId: 'posted-dinner',
          accountId: pending.accountId,
          amountMinor: 4600,
          currency: 'USD',
          postedOn: pending.postedOn,
          authorizedOn: null,
          merchant: pending.merchant,
          category: 'dining',
          kind: 'purchase',
          state: 'posted',
          pendingSourceId: pending.sourceId,
          obligationId: null,
          refundOf: null,
        },
      ],
      removed: [],
      asOf: new Date().toISOString(),
    };
    q.applyFinanceSync(owner, batch);
    q.applyFinanceSync(owner, batch);
    const rows = q
      .listFinanceTransactions(owner, {
        accountIds: [pending.accountId],
        startOn: pending.postedOn,
        endOn: f.budget.plan.endOn,
      })
      .rows.filter((t) => t.sourceId === 'posted-dinner');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: pending.id,
      category: 'shopping',
      amountMinor: 4600,
    });
    q.applyFinanceSync(owner, {
      ...batch,
      added: [],
      removed: [{ accountId: pending.accountId, sourceId: 'posted-dinner' }],
    });
    expect(
      q
        .listFinanceTransactions(owner, {
          accountIds: [pending.accountId],
          startOn: pending.postedOn,
          endOn: f.budget.plan.endOn,
        })
        .rows.find((t) => t.id === pending.id)?.state,
    ).toBe('removed');
  });
  it('persists a declarative view across a database reconnect and rejects stale edits', () => {
    const f = seedSyntheticFinance(owner),
      view = f.views[0];
    resetDb();
    expect(openFinanceView(owner, view.id).view.definition).toEqual(
      view.definition,
    );
    q.saveFinanceView(owner, {
      id: view.id,
      scope: view.scope,
      definition: { ...view.definition, title: 'My comparison' },
      expectedRevision: view.revision,
      mutationKey: 'view-revision-001',
    });
    expect(() =>
      q.saveFinanceView(owner, {
        id: view.id,
        scope: view.scope,
        definition: view.definition,
        expectedRevision: view.revision,
        mutationKey: 'view-stale-001',
      }),
    ).toThrow('View changed');
    expect(q.getFinanceView(owner, view.id).definition.title).toBe(
      'My comparison',
    );
  });
  it('rejects injected bindings, tool names, code and literal financial metric values', () => {
    const f = seedSyntheticFinance(owner),
      def = f.views[0].definition;
    for (const extra of [
      { javascript: 'alert(1)' },
      { url: 'http://localhost:4224' },
      { sql: 'select * from tasks' },
      { toolName: 'delete_task' },
      { actualBalance: 100000 },
    ])
      expect(viewDefinitionSchema.safeParse({ ...def, ...extra }).success).toBe(
        false,
      );
    expect(
      viewDefinitionSchema.safeParse({
        ...def,
        components: [
          {
            id: 'x',
            type: 'metric',
            title: 'Balance',
            metric: 'remaining',
            value: 9000,
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('checks current account grants and revocation on saved views', () => {
    const f = seedSyntheticFinance(owner),
      agent = { id: 'chat:example', owner: false };
    expect(() => q.getFinanceView(agent, f.views[0].id)).toThrow('permission');
    q.grantFinance(owner, agent.id, f.budget.accountIds, ['read', 'evidence']);
    expect(q.getFinanceView(agent, f.views[0].id).id).toBe(f.views[0].id);
    q.grantFinance(owner, agent.id, [f.accounts[0].id], [], true);
    expect(() => q.getFinanceView(agent, f.views[0].id)).toThrow('permission');
  });
  it('invalidates stale workers after disabling or deleting live records', () => {
    const f = seedSyntheticFinance(owner),
      generation = q.getFinanceSettings()!.generation;
    q.configureFinance(owner, { enabled: false });
    expect(() => q.getFinanceView(owner, f.views[0].id)).toThrow('disabled');
    q.configureFinance(owner, { enabled: true });
    expect(() =>
      q.applyFinanceSync(owner, {
        accountIds: [f.accounts[0].id],
        generation,
        added: [],
        removed: [],
        asOf: new Date().toISOString(),
      }),
    ).toThrow('generation');
    const deleted = q.deleteLiveFinanceData(owner, f.budget.accountIds);
    expect(deleted.backupsDeleted).toBe(false);
    expect(() => q.getFinanceView(owner, f.views[0].id)).toThrow('not found');
    expect(
      getRawDb()
        .prepare('SELECT count(*) AS n FROM finance_transactions')
        .get(),
    ).toEqual({ n: 0 });
  });
  it('keeps deduction and settlement findings separate, with protected generic task text', () => {
    const f = seedSyntheticFinance(owner),
      transactions = q.financeTransactionsForCalculation(
        owner,
        f.views[0].scope,
      ),
      credit = transactions.find((t) => t.sourceId === 'return-credit')!;
    q.matchFinanceEvidence(owner, {
      evidenceId: f.evidence.id,
      transactionId: credit.id,
      amountMinor: 8000,
      decision: 'human',
      confidence: 1,
      expectedRevision: 0,
      mutationKey: 'match-credit-001',
    });
    const gaps = refundGaps(
      f.evidence,
      transactions,
      q.listFinanceAllocations(owner, [f.evidence.id]),
    );
    expect(gaps).toMatchObject({
      deductionMinor: 2400,
      settlementGapMinor: 1600,
      settledMinor: 8000,
    });
    const findings = reconcileFinance(owner, f.views[0].scope).findings;
    const settlement = findings.find((i) => i.kind === 'settlement')!;
    const handoff = q.createFinanceFollowup(owner, settlement.id);
    expect(q.createFinanceFollowup(owner, settlement.id)).toEqual(handoff);
    const task = q.listFinanceHandoffs(owner).find(t=>t.id===handoff.handoffId)!;
    const embedded=JSON.stringify(task);
    for (const secret of [
      'Fictional shop',
      '8000',
      '9600',
      '12000',
      'refund notice',
    ])
      expect(embedded).not.toContain(secret);
    expect(task).not.toHaveProperty('attachments');
    expect(embedded).toContain('/finance?finding=');
  });
  it('does not count a store-credit promise as a missing card settlement', () => {
    const f = seedSyntheticFinance(owner),
      e = {
        ...f.evidence,
        data: { ...f.evidence.data, destination: 'store_credit' as const },
      };
    expect(refundGaps(e, [], [])).toMatchObject({
      deductionMinor: 2400,
      settlementGapMinor: null,
      settledMinor: null,
      status: 'non_cash',
    });
  });
  it('marks cash estimates incomplete when balances, currencies or fresh sources are missing', () => {
    const f = seedSyntheticFinance(owner),
      accounts = f.accounts.map((a) =>
        a.kind === 'cash' ? { ...a, balanceMinor: null, asOf: null } : a,
      );
    const result = calculateBudget({
      plan: f.budget.plan,
      transactions: [],
      accounts,
      asOf: new Date().toISOString(),
    });
    expect(result.cash.status).toBe('partial');
    expect(result.cash.reasons.join(' ')).toContain('balance missing');
  });
  it('isolates scenarios and rejects unknown dimensions', () => {
    const f = seedSyntheticFinance(owner),
      plan = f.budget.plan;
    const changed = applyScenario(plan, {
      categoryLimits: { dining: 35000 },
      goalContributions: {},
      obligationAmounts: {},
    });
    expect(plan.categories.find((c) => c.id === 'dining')!.limitMinor).toBe(
      50000,
    );
    expect(changed.categories.find((c) => c.id === 'dining')!.limitMinor).toBe(
      35000,
    );
    expect(() =>
      applyScenario(plan, {
        categoryLimits: { unknown: 1 },
        goalContributions: {},
        obligationAmounts: {},
      }),
    ).toThrow('Unknown');
  });
});
describe('CSV lifecycle', () => {
  it('parses quoted multiline fields and rejects malformed input', () => {
    expect(
      parseFinanceCsv(
        'date,merchant,amount\r\n2026-10-01,"Cafe, downtown\nbranch",12.34',
      ),
    ).toEqual([
      ['date', 'merchant', 'amount'],
      ['2026-10-01', 'Cafe, downtown\nbranch', '12.34'],
    ]);
    expect(() => parseFinanceCsv('a,b\n"broken')).toThrow();
  });
  it('preserves real identical purchases while making a repeated import idempotent', () => {
    const input = {
      text: 'date,merchant,amount\n2026-10-01,Cafe,12.34\n2026-10-01,Cafe,12.34',
      accountId: 'a',
      currency: 'USD',
      positiveMeansSpending: true,
    };
    const rows = normalizeFinanceCsv(input);
    expect(rows).toHaveLength(2);
    expect(rows[0].sourceId).not.toBe(rows[1].sourceId);
    expect(normalizeFinanceCsv(input)).toEqual(rows);
  });
});

describe('financial edge cases', () => {
  it('reconciles card payments per account instead of offsetting payments on another card', () => {
    const f = seedSyntheticFinance(owner),
      card = f.accounts.find((a) => a.kind === 'credit')!,
      cash = f.accounts.find((a) => a.kind === 'cash')!;
    const second = {
      ...card,
      id: 'second-card',
      sourceId: 'second-card',
      balanceMinor: 1000,
    };
    const first = { ...card, balanceMinor: 10000 };
    const plan = {
      ...f.budget.plan,
      obligations: [
        {
          id: 'first-payment',
          category: 'fixed',
          amountMinor: 100,
          accountId: first.id,
          dueOn: f.budget.plan.startOn,
          kind: 'card_payment' as const,
          source: 'manual' as const,
        },
        {
          id: 'second-payment',
          category: 'fixed',
          amountMinor: 20000,
          accountId: second.id,
          dueOn: f.budget.plan.startOn,
          kind: 'card_payment' as const,
          source: 'manual' as const,
        },
      ],
    };
    const result = calculateBudget({
      plan,
      transactions: [],
      accounts: [cash, first, second],
      asOf: new Date().toISOString(),
    });
    expect(result.cash.cardCommitmentsMinor).toBe(30000);
  });
  it('counts a posted obligation and a pending replacement only once while preserving a disclosed forecast', () => {
    const f = seedSyntheticFinance(owner),
      transactions = q.financeTransactionsForCalculation(
        owner,
        f.views[0].scope,
      ),
      rent = transactions.find((t) => t.obligationId === 'rent')!;
    const plan = {
      ...f.budget.plan,
      obligations: [
        {
          ...f.budget.plan.obligations[0],
          merchant: rent.merchant,
          accountId: rent.accountId,
        },
      ],
    };
    const result = calculateBudget({
      plan,
      transactions: transactions.map((t) =>
        t.id === rent.id ? { ...t, obligationId: null } : t,
      ),
      accounts: f.accounts,
      asOf: new Date().toISOString(),
    });
    expect(result.upcoming).toHaveLength(0);
  });
  it('records a refund in its posting period using the original corrected purchase category', () => {
    const f = seedSyntheticFinance(owner),
      account = f.accounts[1],
      generation = q.getFinanceSettings()!.generation;
    const old = {
      sourceId: 'old-purchase',
      accountId: account.id,
      amountMinor: 9000,
      currency: 'USD',
      postedOn: '2026-09-10',
      authorizedOn: null,
      merchant: 'Fictional merchant',
      category: 'shopping',
      kind: 'purchase',
      state: 'posted',
      pendingSourceId: null,
      obligationId: null,
      refundOf: null,
    };
    q.applyFinanceSync(owner, {
      accountIds: [account.id],
      generation,
      added: [old],
      removed: [],
      asOf: new Date().toISOString(),
    });
    const purchase = q
      .listFinanceTransactions(owner, {
        accountIds: [account.id],
        startOn: '2026-09-01',
        endOn: '2026-10-01',
      })
      .rows.find((t) => t.sourceId === old.sourceId)!;
    q.overrideFinanceTransaction(owner, {
      id: purchase.id,
      category: 'dining',
      expectedRevision: 0,
      mutationKey: 'original-category-001',
    });
    q.applyFinanceSync(owner, {
      accountIds: [account.id],
      generation,
      added: [
        {
          ...old,
          sourceId: 'late-refund',
          amountMinor: -5000,
          postedOn: '2026-10-04',
          category: 'other',
          kind: 'refund',
          refundOf: purchase.id,
        },
      ],
      removed: [],
      asOf: new Date().toISOString(),
    });
    const october = q.listFinanceTransactions(owner, {
      accountIds: [account.id],
      startOn: '2026-10-01',
      endOn: '2026-11-01',
    }).rows;
    expect(october.find((t) => t.sourceId === 'late-refund')).toMatchObject({
      category: 'dining',
      amountMinor: -5000,
    });
    expect(
      q
        .listFinanceTransactions(owner, {
          accountIds: [account.id],
          startOn: '2026-09-01',
          endOn: '2026-10-01',
        })
        .rows.find((t) => t.id === purchase.id)?.amountMinor,
    ).toBe(9000);
  });
  it('preserves reviewed evidence and rejects stale human edits', () => {
    const f = seedSyntheticFinance(owner),
      before = f.evidence;
    expect(
      q.saveFinanceEvidence(owner, {
        data: { ...before.data, promiseMinor: 1 },
      }),
    ).toEqual(before);
    const changed = q.saveFinanceEvidence(owner, {
      data: { ...before.data, promiseMinor: 10000 },
      reviewed: true,
      expectedRevision: before.revision,
    });
    expect(changed.revision).toBe(before.revision + 1);
    expect(() =>
      q.saveFinanceEvidence(owner, {
        data: before.data,
        reviewed: true,
        expectedRevision: before.revision,
      }),
    ).toThrow('changed');
  });
  it('restores proposal state when undoing adoption and prevents stale scenarios applying', () => {
    const f = seedSyntheticFinance(owner),
      proposal = q.createFinanceBudget(owner, {
        name: 'Proposal',
        plan: f.budget.plan,
        accountIds: f.budget.accountIds,
        mutationKey: 'proposal-edge-001',
      });
    const adopted = q.changeFinanceBudget(owner, {
        id: proposal.id,
        adopt: true,
        expectedRevision: 0,
        mutationKey: 'adopt-edge-001',
      }),
      undone = q.changeFinanceBudget(owner, {
        id: proposal.id,
        undo: true,
        expectedRevision: adopted.revision,
        mutationKey: 'undo-adoption-001',
      });
    expect(undone.state).toBe('proposal');
    const scenario = q.saveFinanceScenario(owner, {
      budgetId: undone.id,
      name: 'Stale scenario',
      changes: {
        categoryLimits: { dining: 1000 },
        goalContributions: {},
        obligationAmounts: {},
      },
      expectedRevision: 0,
      mutationKey: 'scenario-stale-001',
    });
    q.changeFinanceBudget(owner, {
      id: undone.id,
      plan: { ...undone.plan, incomeMinor: 1 },
      expectedRevision: undone.revision,
      mutationKey: 'change-after-scenario-001',
    });
    expect(() =>
      q.applyFinanceScenario(owner, {
        scenarioId: scenario.id,
        expectedBudgetRevision: undone.revision + 1,
        mutationKey: 'apply-stale-001',
      }),
    ).toThrow('older');
  });
  it('keeps source revocation effective on grants, saved views and queued jobs even when the plugin is disabled', () => {
    const f = seedSyntheticFinance(owner),
      account = q.createFinanceAccount(owner, {
        name: 'Fixture source',
        kind: 'cash',
        provider: 'plaid',
        currency: 'USD',
        connectionId: 'fixture-connector',
        sourceId: 'fixture-source',
        balanceMinor: 1000,
        balanceIncludesPending: false,
        historyStart: null,
        asOf: null,
      });
    q.grantFinance(
      owner,
      'chat:revocation',
      [account.id],
      ['read', 'write', 'sync'],
    );
    q.queueFinanceSync(owner, account.id);
    q.configureFinance(owner, { enabled: false });
    q.invalidateFinanceConnection('fixture-connector');
    q.configureFinance(owner, { enabled: true });
    expect(() =>
      q.requireFinance({ id: 'chat:revocation', owner: false }, [account.id]),
    ).toThrow('permission');
    expect(q.requireFinance(owner, [account.id])[0].access).toBe('retained');
    expect(
      q.claimFinanceJobs(new Date(Date.now() + 1000).toISOString()),
    ).toEqual([]);
    expect(f.views.length).toBe(5);
  });
});

describe('refund, recurring and persistent view acceptance', () => {
  it('keeps original purchase allocations out of credits and accounts for split refunds and later recharges', () => {
    const f = seedSyntheticFinance(owner),
      transactions = q.financeTransactionsForCalculation(
        owner,
        f.views[0].scope,
      ),
      credit = transactions.find((t) => t.sourceId === 'return-credit')!,
      purchase =
        transactions.find((t) => t.sourceId === 'return-purchase') ??
        transactions.find((t) => t.amountMinor === 12000)!;
    q.applyFinanceSync(owner, {
      accountIds: [credit.accountId],
      generation: q.getFinanceSettings()!.generation,
      asOf: new Date().toISOString(),
      removed: [],
      added: [
        transactionSchema
          .strip()
          .parse({ ...credit, sourceId: 'partial-credit', amountMinor: -1600 }),
        transactionSchema.strip().parse({
          ...credit,
          sourceId: 'later-recharge',
          amountMinor: 1600,
          kind: 'purchase',
        }),
      ],
    });
    const all = q.financeTransactionsForCalculation(owner, f.views[0].scope);
    for (const [t, role, amount] of [
      [purchase, 'purchase', 12000],
      [credit, 'refund', 8000],
      [all.find((t) => t.sourceId === 'partial-credit')!, 'refund', 1600],
    ] as const)
      q.matchFinanceEvidence(owner, {
        evidenceId: f.evidence.id,
        transactionId: t.id,
        role,
        amountMinor: amount,
        decision: 'human',
        confidence: 1,
        expectedRevision: 0,
        mutationKey: 'role-' + t.id,
      });
    expect(
      refundGaps(
        f.evidence,
        all,
        q.listFinanceAllocations(owner, [f.evidence.id]),
        f.accounts,
      ),
    ).toMatchObject({
      settledMinor: 9600,
      settlementGapMinor: 0,
      deductionMinor: 2400,
      status: 'settled',
    });
    const recharge = all.find((t) => t.sourceId === 'later-recharge')!;
    q.matchFinanceEvidence(owner, {
      evidenceId: f.evidence.id,
      transactionId: recharge.id,
      role: 'recharge',
      amountMinor: 1600,
      decision: 'human',
      confidence: 1,
      expectedRevision: 0,
      mutationKey: 'recharge-001',
    });
    expect(
      refundGaps(
        f.evidence,
        all,
        q.listFinanceAllocations(owner, [f.evidence.id]),
        f.accounts,
      ),
    ).toMatchObject({
      settledMinor: 8000,
      settlementGapMinor: 1600,
      deductionMinor: 2400,
    });
  });
  it('keeps gift money and the wrong masked destination out of cash settlement', () => {
    const f = seedSyntheticFinance(owner),
      transactions = q.financeTransactionsForCalculation(
        owner,
        f.views[0].scope,
      ),
      credit = transactions.find((t) => t.sourceId === 'return-credit')!;
    const allocation = q.matchFinanceEvidence(owner, {
      evidenceId: f.evidence.id,
      transactionId: credit.id,
      amountMinor: 6000,
      role: 'refund',
      decision: 'human',
      confidence: 1,
      expectedRevision: 0,
      mutationKey: 'mixed-match-001',
    });
    const evidence = {
      ...f.evidence,
      data: {
        ...f.evidence.data,
        refundParts: [
          {
            destination: 'card' as const,
            maskedHint: '1111',
            amountMinor: 7200,
          },
          {
            destination: 'gift_card' as const,
            maskedHint: null,
            amountMinor: 2400,
          },
        ],
      },
    };
    const accounts = f.accounts.map((a) =>
      a.id === credit.accountId ? { ...a, mask: '1111' } : a,
    );
    expect(
      refundGaps(evidence, transactions, [allocation], accounts),
    ).toMatchObject({
      cashPromiseMinor: 7200,
      settledMinor: 6000,
      settlementGapMinor: 1200,
      nonCashPromises: [{ destination: 'gift_card', amountMinor: 2400 }],
    });
    expect(
      refundGaps(
        evidence,
        transactions,
        [allocation],
        accounts.map((a) => ({ ...a, mask: '9999' })),
      ),
    ).toMatchObject({ settledMinor: 0, settlementGapMinor: 7200 });
    expect(() =>
      evidenceSchema.parse({ ...evidence.data, promiseMinor: 9601 }),
    ).toThrow('must sum');
  });
  it('allocates partial quantities, tax, shipping and discounts exactly', () => {
    const f = seedSyntheticFinance(owner),
      e = {
        ...f.evidence,
        data: {
          ...f.evidence.data,
          totalMinor: 11001,
          promiseMinor: 7000,
          items: [
            {
              id: 'item',
              name: 'Three items',
              quantity: 3,
              returnedQuantity: 2,
              amountMinor: 10001,
            },
          ],
          adjustments: {
            taxMinor: 801,
            shippingMinor: 499,
            discountMinor: 300,
            deductionMinor: 334,
          },
        },
      };
    expect(refundGaps(e, [], [])).toMatchObject({
      purchaseMinor: 7334,
      deductionMinor: 334,
      unexplainedDeductionMinor: 0,
      settlementGapMinor: 7000,
    });
    expect(() =>
      evidenceSchema.parse({
        ...e.data,
        adjustments: { ...e.data.adjustments, taxMinor: -1 },
      }),
    ).toThrow();
  });
  it('does not auto-match another identical charge after a human has filled the purchase allocation', () => {
    const f = seedSyntheticFinance(owner),
      base = q
        .financeTransactionsForCalculation(owner, f.views[0].scope)
        .find((t) => t.amountMinor === 12000)!;
    q.applyFinanceSync(owner, {
      accountIds: [base.accountId],
      generation: q.getFinanceSettings()!.generation,
      asOf: new Date().toISOString(),
      removed: [],
      added: [
        transactionSchema
          .strip()
          .parse({ ...base, sourceId: 'identical-purchase' }),
      ],
    });
    const e = q.saveFinanceEvidence(owner, {
      reviewed: true,
      data: {
        ...f.evidence.data,
        sourceId: 'ambiguous-receipt',
        kind: 'receipt',
        promiseMinor: null,
        orderId: 'ambiguous-order',
      },
    });
    expect(
      reconcileFinance(owner, f.views[0].scope).findings.find(
        (x) => x.evidenceId === e.id && x.kind === 'ambiguous_match',
      )?.state,
    ).toBe('open');
    q.matchFinanceEvidence(owner, {
      evidenceId: e.id,
      transactionId: base.id,
      amountMinor: 12000,
      decision: 'human',
      confidence: 1,
      expectedRevision: 0,
      mutationKey: 'human-choose-001',
    });
    reconcileFinance(owner, f.views[0].scope);
    expect(q.listFinanceAllocations(owner, [e.id])).toHaveLength(1);
    expect(
      q
        .listFinanceFindings(owner, f.budget.accountIds)
        .find((x) => x.evidenceId === e.id && x.kind === 'ambiguous_match')
        ?.state,
    ).toBe('resolved');
  });
  it('persists scenario assumptions and local filters without narrowing budget coverage', () => {
    const f = seedSyntheticFinance(owner),
      scenario = q.saveFinanceScenario(owner, {
        budgetId: f.budget.id,
        name: 'Saved comparison',
        changes: {
          categoryLimits: { dining: 35000 },
          goalContributions: {},
          obligationAmounts: {},
        },
        expectedRevision: 0,
        mutationKey: 'saved-scenario-001',
      }),
      view = q.saveFinanceView(owner, {
        scope: {
          ...f.views[0].scope,
          filters: {
            accountIds: [f.accounts[1].id],
            startOn: f.budget.plan.startOn,
            endOn: f.budget.plan.endOn,
          },
        },
        scenarioId: scenario.id,
        definition: f.views[0].definition,
        expectedRevision: 0,
        mutationKey: 'saved-filter-001',
      });
    resetDb();
    const reopened = openFinanceView(owner, view.id);
    expect(reopened.view.scope.accountIds).toEqual(f.budget.accountIds);
    expect(
      reopened.data.transactions.every((t) => t.accountId === f.accounts[1].id),
    ).toBe(true);
    expect(reopened.data.budget?.postedMinor).toBe(211500);
    expect(reopened.scenarioChanges?.categoryLimits.dining).toBe(35000);
    expect(q.getFinanceBudget(owner, f.budget.id).revision).toBe(
      f.budget.revision,
    );
  });
  it('keeps explicit card details through provider gaps and moves bills into custom-start periods', () => {
    const f = seedSyntheticFinance(owner),
      prior = {
        statementBalanceMinor: 12000,
        currentBalanceMinor: 13000,
        minimumPaymentMinor: 500,
        chosenPaymentMinor: 10000,
        dueOn: '2026-11-04',
        source: 'manual' as const,
        asOf: '2026-10-01T00:00:00.000Z',
      };
    expect(
      mergeFinanceCardObligations(prior, {
        ...prior,
        currentBalanceMinor: 14000,
        statementBalanceMinor: null,
        minimumPaymentMinor: null,
        dueOn: null,
        source: 'provider',
        asOf: '2026-10-06T00:00:00.000Z',
      }),
    ).toMatchObject({ ...prior, currentBalanceMinor: 14000 });
    const changed = q.changeFinanceBudget(owner, {
        id: f.budget.id,
        expectedRevision: f.budget.revision,
        mutationKey: 'period-shift-001',
        plan: {
          ...f.budget.plan,
          startDay: 15,
          startOn: '2026-10-15',
          endOn: '2026-11-15',
          obligations: [
            { ...f.budget.plan.obligations[0], dueOn: '2026-11-04' },
          ],
        },
      }),
      next = nextFinanceBudgetPeriod(owner, changed.id, 'next-period-001');
    expect(next.plan.obligations[0].dueOn).toBe('2026-12-04');
    expect(next.plan.startDay).toBe(15);
  });
  it('detects annual price changes and confirms cancellation only with supplied evidence', () => {
    const f = seedSyntheticFinance(owner),
      base = q
        .financeTransactionsForCalculation(owner, f.views[0].scope)
        .find((t) => t.kind === 'purchase')!,
      transactions = [
        {
          ...base,
          id: 'a',
          merchant: 'Annual service',
          amountMinor: 9000,
          postedOn: '2025-10-01',
        },
        {
          ...base,
          id: 'b',
          merchant: 'Annual service',
          amountMinor: 12000,
          postedOn: '2026-10-01',
        },
      ],
      evidence = [
        {
          ...f.evidence,
          occurredOn: '2026-09-01',
          data: {
            ...f.evidence.data,
            kind: 'cancellation' as const,
            merchant: 'Annual service',
            occurredOn: '2026-09-01',
          },
        },
      ];
    expect(detectRecurring(transactions, evidence)[0]).toMatchObject({
      cadence: 'annual',
      annualMinor: 12000,
      previousAmountMinor: 9000,
      status: 'cancelled',
      afterCancellation: true,
    });
  });
});

describe('budget funding acceptance', () => {
  it('deducts a reserve-funded upcoming bill once and carries contributions into the next period', () => {
    const f = seedSyntheticFinance(owner),
      cash = f.accounts.find((a) => a.kind === 'cash')!,
      plan = {
        ...f.budget.plan,
        incomeMinor: 0,
        categories: f.budget.plan.categories.map((c) => ({
          ...c,
          variableForecastMinor: 0,
        })),
        obligations: [
          {
            id: 'annual-bill',
            category: 'fixed',
            amountMinor: 10000,
            dueOn: '2026-10-20',
            kind: 'purchase' as const,
            source: 'manual' as const,
            accountId: cash.id,
            reserveId: 'annual',
          },
        ],
        reserves: [
          {
            id: 'annual',
            name: 'Annual bill',
            targetMinor: 10000,
            heldMinor: 9000,
            contributionMinor: 1000,
          },
        ],
        goals: [],
      };
    const before = calculateBudget({
      plan,
      accounts: [cash],
      transactions: [],
      asOf: new Date().toISOString(),
    });
    expect(before.cash.estimatedMinor).toBe(cash.balanceMinor! - 10000);
    expect(before.cash.reserveCommitments[0]).toMatchObject({
      overlapMinor: 10000,
      earmarkedMinor: 0,
    });
    const transaction = q.financeTransactionsForCalculation(
        owner,
        f.views[0].scope,
      )[0],
      partial = {
        ...transaction,
        accountId: cash.id,
        amountMinor: 4000,
        kind: 'purchase' as const,
        state: 'pending' as const,
        postedOn: '2026-10-10',
        obligationId: 'annual-bill',
        category: 'fixed',
      };
    const after = calculateBudget({
      plan,
      accounts: [cash],
      transactions: [partial],
      asOf: new Date().toISOString(),
    });
    expect(after.upcoming[0].amountMinor).toBe(6000);
    expect(after.cash.estimatedMinor).toBe(before.cash.estimatedMinor);
    expect(after.categories.find((c) => c.id === 'fixed')?.forecastMinor).toBe(
      10000,
    );
    const changed = q.changeFinanceBudget(owner, {
        id: f.budget.id,
        plan: {
          ...plan,
          goals: [
            {
              id: 'goal',
              name: 'Goal',
              heldMinor: 2000,
              targetMinor: 10000,
              contributionMinor: 1000,
            },
          ],
        },
        expectedRevision: f.budget.revision,
        mutationKey: 'reserve-plan-001',
      }),
      next = nextFinanceBudgetPeriod(owner, changed.id, 'reserve-next-001');
    expect(next.plan.reserves[0]).toMatchObject({
      heldMinor: 10000,
      contributionMinor: 0,
    });
    expect(next.plan.goals[0]).toMatchObject({
      heldMinor: 3000,
      contributionMinor: 1000,
    });
  });
  it('uses two-year evidence for annual reserves and conservative income without adopting the proposal', () => {
    const f = seedSyntheticFinance(owner),
      base = transactionSchema
        .strip()
        .parse(
          q
            .financeTransactionsForCalculation(owner, f.views[0].scope)
            .find((t) => t.kind === 'purchase')!,
        );
    q.applyFinanceSync(owner, {
      accountIds: [base.accountId],
      generation: q.getFinanceSettings()!.generation,
      asOf: new Date().toISOString(),
      removed: [],
      added: [
        {
          ...base,
          sourceId: 'annual-2025',
          merchant: 'Annual renewal',
          amountMinor: 12000,
          postedOn: '2025-09-01',
        },
        {
          ...base,
          sourceId: 'annual-2026',
          merchant: 'Annual renewal',
          amountMinor: 12000,
          postedOn: '2026-09-01',
        },
      ],
    });
    const proposal = proposeFinanceBudget(owner, {
      accountIds: f.budget.accountIds,
      startDay: 1,
      mutationKey: 'annual-proposal-001',
    });
    expect(proposal.budget.state).toBe('proposal');
    expect(proposal.budget.plan.incomeConfidence).toBe('assumed');
    expect(
      proposal.budget.plan.reserves.find((r) => r.name === 'Annual renewal'),
    ).toMatchObject({
      targetMinor: 12000,
      contributionMinor: 1000,
      heldMinor: 0,
    });
    expect(q.getFinanceBudget(owner, f.budget.id)).toMatchObject({plan:f.budget.plan,revision:f.budget.revision,state:f.budget.state});
  });
});
