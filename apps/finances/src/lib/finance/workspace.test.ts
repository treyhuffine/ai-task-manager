import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestHome, type TestHome } from "@/test/fixtures/home";
import * as q from "@/lib/db/queries";
import { seedSyntheticFinance } from "./synthetic";
import { financeActivity, financeOverview } from "./workspace";
import { toolsDefinition } from "@/lib/local-app/definition";
import { initializeManaged, shutdownManaged } from "@/lib/local-app/managed";
let home: TestHome;
const owner = q.financeOwner;
beforeEach(async () => {
  home = await createTestHome({ prefix: "finance-workspace-" });
  initializeManaged("00000000-0000-4000-8000-000000000001", null);
});
afterEach(async () => {
  shutdownManaged();
  await home.cleanup();
});
const call = (name: string, input: unknown = {}, principal = owner) =>
  toolsDefinition()
    .find((t) => t.name === name)!
    .run(principal, input);
it("separates currencies, pending, transfers and snapshots and never treats a refund as income", async () => {
  const f = seedSyntheticFinance(owner),
    scope = {
      accountIds: f.accounts.map((a) => a.id),
      startOn: f.budget.plan.startOn,
      endOn: f.budget.plan.endOn,
    };
  const overview = financeOverview(owner, scope),
    usd = overview.summaries.find((s) => s.currency === "USD")!;
  expect(usd).toMatchObject({
    incomeMinor: 500000,
    spendingMinor: 211500,
    pendingMinor: 4500,
    cashMinor: 425000,
    creditMinor: 86000,
  });
  expect(usd.netMinor).toBe(288500);
  expect(usd.categories.reduce((s, c) => s + c.amountMinor, 0)).toBe(
    usd.spendingMinor,
  );
  const foreign = q.createFinanceAccount(owner, {
    name: "Foreign cash",
    kind: "cash",
    provider: "manual",
    currency: "JPY",
    sourceId: "foreign",
    connectionId: null,
    balanceMinor: 1234,
    balanceIncludesPending: false,
    historyStart: null,
    asOf: null,
  });
  const combined = financeOverview(owner, {
    ...scope,
    accountIds: [...scope.accountIds, foreign.id],
  });
  expect(combined.summaries.find((s) => s.currency === "JPY")).toMatchObject({
    cashMinor: 1234,
    incomeMinor: 0,
  });
  expect(
    combined.coverage.find((a) => a.accountId === foreign.id),
  ).toMatchObject({ incomplete: true, stale: true, manual: true });
  await expect(call("finance_overview", scope)).resolves.toMatchObject({
    summaries: [expect.objectContaining({ incomeMinor: 500000 })],
  });
});
it("paginates newest first without duplicates and searches effective corrections, not source categories", () => {
  const f = seedSyntheticFinance(owner),
    scope = {
      accountIds: f.accounts.map((a) => a.id),
      startOn: f.budget.plan.startOn,
      endOn: f.budget.plan.endOn,
    };
  const first = financeActivity(owner, { ...scope, limit: 2 });
  expect(first.next).not.toBeNull();
  const second = financeActivity(owner, {
    ...scope,
    limit: 2,
    after: first.next!,
  });
  expect(new Set([...first.rows, ...second.rows].map((t) => t.id)).size).toBe(
    4,
  );
  expect(first.rows[0].postedOn >= second.rows[0].postedOn).toBe(true);
  const t = first.rows[0];
  q.overrideFinanceTransaction(owner, {
    id: t.id,
    category: "corrected",
    expectedRevision: 0,
    mutationKey: "workspace-correct-1",
  });
  const result = financeActivity(owner, {
    ...scope,
    category: "corrected",
    search: t.merchant.toUpperCase(),
  });
  expect(result.rows.map((t) => t.id)).toEqual([t.id]);
  expect(q.financeTransactionDetail(owner, t.id).correctionRevision).toBe(1);
  expect(() =>
    q.overrideFinanceTransaction(owner, {
      id: t.id,
      category: "stale",
      expectedRevision: 0,
      mutationKey: "workspace-correct-2",
    }),
  ).toThrow(/changed/);
  expect(() =>
    financeActivity(owner, { ...scope, startOn: "2020-01-01" }),
  ).toThrow(/366/);
});
it("enforces read and evidence scopes for overview, details and shared selection", async () => {
  const f = seedSyntheticFinance(owner),
    a = f.accounts[0],
    b = f.accounts[1],
    p = { id: "chat:restricted", owner: false };
  q.grantFinance(owner, p.id, [a.id], ["read"]);
  const scope = {
    accountIds: [a.id],
    startOn: f.budget.plan.startOn,
    endOn: f.budget.plan.endOn,
  };
  expect(() => financeOverview(p, { ...scope, accountIds: [b.id] })).toThrow(
    /permission/,
  );
  const t = financeActivity(owner, { ...scope, accountIds: [b.id] }).rows[0];
  await expect(
    call("finance_transaction_detail", { id: t.id }, p),
  ).rejects.toThrow(/permission/);
  await expect(
    call(
      "finance_describe_view_context",
      {
        path: "/",
        query: {},
        state: {
          selected: [{ type: "transaction", id: t.id }],
          filters: scope,
        },
      },
      p,
    ),
  ).rejects.toThrow(/permission/);
  const valid = financeActivity(p, scope).rows[0];
  expect(q.financeTransactionDetail(p, valid.id).evidence).toEqual([]);
  const shared = await call(
    "finance_describe_view_context",
    {
      path: "/",
      query: {},
      state: {
        selected: [{ type: "transaction", id: valid.id }],
        filters: scope,
        section: "transactions",
      },
    },
    p,
  );
  expect(shared).toMatchObject({ recordRefs: [{ recordId: valid.id }] });
  await expect(
    call(
      "finance_describe_view_context",
      {
        path: "/",
        query: {},
        state: {
          selected: [{ type: "transaction", id: valid.id }],
          filters: scope,
          activity: { search: "not this merchant" },
        },
      },
      p,
    ),
  ).rejects.toThrow(/visible filters/);
});
it("previews CSV without writes and preserves explicit income and transfer kinds on import", async () => {
  q.configureFinance(owner, {
    enabled: true,
    currency: "USD",
    timezone: "UTC",
  });
  const a = q.createFinanceAccount(owner, {
    name: "Manual",
    kind: "cash",
    provider: "manual",
    currency: "USD",
    connectionId: null,
    sourceId: "manual",
    balanceMinor: 50000,
    balanceIncludesPending: false,
    historyStart: null,
    asOf: new Date().toISOString(),
  });
  const input = {
    accountId: a.id,
    text: "date,merchant,amount,category,kind\n2026-10-01,Payday,-2500,income,income\n2026-10-02,Move money,100,transfer,transfer",
    positiveMeansSpending: true,
  };
  await expect(call("finance_csv_preview", input)).resolves.toMatchObject({
    count: 2,
    rows: [{ kind: "income", amountMinor: -250000 }, { kind: "transfer" }],
  });
  const scope = {
    accountIds: [a.id],
    startOn: "2026-10-01",
    endOn: "2026-11-01",
  };
  expect(financeActivity(owner, scope).total).toBe(0);
  await call("finance_import_csv", input);
  await call("finance_import_csv", input);
  expect(financeActivity(owner, scope).total).toBe(2);
  expect(financeOverview(owner, scope).summaries[0]).toMatchObject({
    incomeMinor: 250000,
    spendingMinor: 0,
    cashMinor: 50000,
  });
});
it("applies only the reviewed budget revision, then supports explicit undo", async () => {
  const f = seedSyntheticFinance(owner),
    b = f.budget,
    changes = {
      categoryLimits: { dining: 10000 },
      goalContributions: {},
      obligationAmounts: {},
    };
  await call("finance_scenario", { id: b.id, changes });
  expect(q.getFinanceBudget(owner, b.id).revision).toBe(b.revision);
  const applied = await call("finance_apply_budget_preview", {
    id: b.id,
    expectedRevision: b.revision,
    changes,
    mutationKey: "workspace-apply-1",
  });
  expect(applied).toMatchObject({ revision: b.revision + 1 });
  await expect(
    call("finance_apply_budget_preview", {
      id: b.id,
      expectedRevision: b.revision,
      changes,
      mutationKey: "workspace-stale-1",
    }),
  ).rejects.toThrow(/changed/);
  q.changeFinanceBudget(owner, {
    id: b.id,
    expectedRevision: b.revision + 1,
    mutationKey: "workspace-undo-1",
    undo: true,
  });
  expect(q.getFinanceBudget(owner, b.id).plan).toEqual(b.plan);
});
