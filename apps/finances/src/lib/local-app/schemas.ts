import { z } from "zod/v4";
import {capabilitiesSchema} from '@/lib/connectors/contracts';
import { createSelectSchema } from "drizzle-zod";
import * as s from "@/lib/db/schema";
import {
  budgetPlanSchema,
  scenarioChangesSchema,
  viewDefinitionSchema,
  viewScopeSchema,
  evidenceSchema,
  cardObligationsSchema,
  obligationSchema,
  minorUnits,
} from "@/lib/finance/contracts";
export const account = createSelectSchema(s.financeAccounts, {
  cardObligations: cardObligationsSchema.nullable(),
}).strict();
export const budget = createSelectSchema(s.financeBudgets, {
  plan: budgetPlanSchema,
  accountIds: z.array(z.string()),
}).strict();
export const view = createSelectSchema(s.financeViews, {
  definition: viewDefinitionSchema,
  scope: viewScopeSchema,
}).strict();
export const transaction = createSelectSchema(s.financeTransactions).strict();
export const evidence = createSelectSchema(s.financeEvidence, {
  data: evidenceSchema,
  attachments: z.array(
    z
      .object({
        file_name: z.string(),
        original_name: z.string(),
        mime_type: z.string(),
        size: z.number().int(),
        uploaded_at: z.string(),
      })
      .strict(),
  ),
}).strict();
export const recurring = createSelectSchema(s.financeRecurring, {
  transactionIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
}).strict();
export const finding = createSelectSchema(s.financeFindings).strict();
export const scenario = createSelectSchema(s.financeScenarios, {
  changes: scenarioChangesSchema,
}).strict();
export const settings = createSelectSchema(s.financeSettings, {
  thresholds: z
    .object({ overspendMinor: minorUnits, priceChangePercent: z.number() })
    .strict(),
}).strict();
const ids = z.array(z.string()),
  money = minorUnits;
const category = z
  .object({
    id: z.string(),
    name: z.string(),
    limitMinor: money,
    rolloverMinor: money,
    postedMinor: money,
    pendingMinor: money,
    upcomingMinor: money,
    remainingMinor: money,
    afterPendingMinor: money,
    forecastMinor: money,
    forecastRemainingMinor: money,
    transactionIds: ids,
    obligationIds: ids,
  })
  .strict();
export const calculation = z
  .object({
    currency: z.string(),
    asOf: z.string(),
    startOn: z.string(),
    endOn: z.string(),
    categories: z.array(category),
    postedMinor: money,
    pendingMinor: money,
    remainingMinor: money,
    forecastMinor: money,
    unallocatedMinor: money,
    unassignedTransactionIds: ids,
    upcoming: z.array(obligationSchema),
    cash: z
      .object({
        status: z.enum(["partial", "complete"]),
        estimatedMinor: money.nullable(),
        reasons: ids,
        expectedIncomeMinor: money,
        cardCommitmentsMinor: money,
        reserveCommitments: z.array(
          z
            .object({
              id: z.string(),
              consumedMinor: money,
              remainingMinor: money,
              overlapMinor: money,
              earmarkedMinor: money,
            })
            .strict(),
        ),
      })
      .strict(),
    coverage: z
      .object({
        accountIds: ids,
        excludedAccountIds: ids,
        otherCurrencies: ids,
      })
      .strict(),
    forecastMethod: z.string(),
  })
  .strict();
const publicAccount = account
  .omit({ connectionId: true })
  .extend({
    state: z.string().optional(),
    amountMinor: money.nullable().optional(),
  })
  .strict();
const json: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);
export const datasets = z
  .object({
    asOf: z.string(),
    currency: z.string(),
    budget: calculation.nullable(),
    budgetRecord: budget.nullable(),
    transactions: z.array(transaction),
    transactionCount: z.number().int(),
    budgetTransactions: z.array(transaction),
    accounts: z.array(publicAccount),
    evidence: z.array(evidence),
    refunds: z.array(z.record(z.string(), json)),
    recurring: z.array(z.record(z.string(), json)),
    findings: z.array(finding.extend({ status: z.string() })),
    trends: z.array(
      z
        .object({
          name: z.string(),
          category: z.string(),
          currency: z.string(),
          amountMinor: money,
          transactionIds: ids,
        })
        .strict(),
    ),
    comparison: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          baselineMinor: money,
          scenarioMinor: money,
          amountMinor: money,
        })
        .strict(),
    ),
    incomplete: z.boolean(),
  })
  .strict();
export const openedView = z
  .object({
    view,
    data: datasets,
    filterAccounts: z.array(account),
    scenarioChanges: scenarioChangesSchema.optional(),
    savedScenarioStale: z.boolean(),
    resourceUri: z.string(),
  })
  .strict();
export const homeData = z
  .object({
    settings: settings.nullable(),
    accounts: z.array(publicAccount),
    budgets: z.array(budget),
    views: z.array(view),
    owner: z.boolean(),
    accessSetup: z.object({actorId:z.string().max(160)}).strict().optional(),
    inspection: z.discriminatedUnion('type', [
      z.object({type:z.literal('transaction'),record:transaction}).strict(),
      z.object({type:z.literal('evidence'),record:evidence}).strict(),
      z.object({type:z.literal('finding'),record:finding}).strict(),
    ]).optional(),
  })
  .strict();
export const openedApp = z
  .object({
    resource: z.string(),
    data: z.union([homeData, openedView]),
    scope: z
      .object({
        actions: ids,
        bindings: z.union([z.object({viewId:z.string()}).strict(),z.object({actorId:z.string().max(160)}).strict()]).optional(),
      })
      .strict(),
  })
  .strict();
const changedBudget = budget
  .extend({
    diff: z
      .array(
        z
          .object({
            field: z.string(),
            label: z.string(),
            before: z.union([z.string(), z.number(), z.null()]),
            after: z.union([z.string(), z.number(), z.null()]),
            money: z.boolean(),
            currency: z.string(),
          })
          .strict(),
      )
      .optional(),
    stateChange: z
      .object({ before: z.string(), after: z.string() })
      .strict()
      .optional(),
  })
  .strict();
export const outputSchemas: Record<string, z.ZodType> = {
  finance_source_connections:capabilitiesSchema.extend({unavailable:z.boolean()}),
  finance_connect_mailbox:account,
  finance_disconnect_source:account.extend({providerRevoked:z.boolean(),revocationMessage:z.string()}),
  finance_list_scopes:z.object({scopes:z.array(z.object({scopeRef:z.string().uuid(),actorId:z.string(),accountIds:ids,operations:z.array(z.enum(['read','write','sync','evidence']))}).strict()).max(1000)}).strict(),
  finance_revoke_scope:z.object({revoked:z.literal(true)}).strict(),
  finance_record_transaction: transaction,
  finance_status: z
    .object({
      enabled: z.boolean(),
      accounts: z.array(publicAccount),
      budgets: z.array(budget),
      views: z.array(view),
    })
    .strict(),
  finance_view_contract: z
    .object({ resourceUri: z.string(), schema: z.record(z.string(), json) })
    .strict(),
  finance_correct_transaction: createSelectSchema(s.financeOverrides).strict(),
  finance_save_evidence: evidence,
  finance_match_evidence: createSelectSchema(s.financeAllocations).strict(),
  finance_transactions: z
    .object({
      rows: z.array(transaction),
      next: z.object({ date: z.string(), id: z.string() }).strict().nullable(),
    })
    .strict(),
  finance_datasets: datasets,
  finance_propose_budget: z
    .object({ budget, views: z.array(view), assumptions: ids })
    .strict(),
  finance_budget: z.object({ budget, result: calculation }).strict(),
  finance_change_budget: changedBudget,
  finance_scenario: z.object({ budget, result: calculation }).strict(),
  finance_save_scenario: scenario,
  finance_apply_scenario: changedBudget,
  finance_evidence: evidence,
  finance_findings: z.object({ records: z.array(finding) }).strict(),
  finance_followup: z
    .object({
      handoffId: z.string(),
      status: z.literal("pending"),
      reference: z.string(),
    })
    .strict(),
  finance_recurring: z.object({ records: z.array(recurring) }).strict(),
  finance_reconcile: z
    .object({
      findings: z.array(finding),
      recurring: z.array(z.record(z.string(), json)),
    })
    .strict(),
  finance_save_view: view,
  finance_open_view: openedView,
  finance_open_app: openedApp,
  finance_home: homeData,
  finance_setup: settings,
  finance_create_account: account,
  finance_import_csv: z
    .object({ imported: z.number().int().nonnegative() })
    .strict(),
  finance_create_default_view: view,
  finance_create_scope: z
    .object({
      scopeRef: z.string().uuid(),
      actorId: z.string(),
      accountIds: ids,
      operations: z.array(z.enum(["read", "write", "sync", "evidence"])),
    })
    .strict(),
  finance_describe_view_context: z
    .object({
      modelContent: z.string().max(16384),
      recordRefs: z
        .array(
          z
            .object({
              instanceId: z.string().uuid(),
              entityType: z.string(),
              recordId: z.string(),
            })
            .strict(),
        )
        .max(50),
      dataRevision: z.string(),
    })
    .strict(),
  finance_inspect: z
    .object({
      inspection: z
        .object({
          type: z.string(),
          record: z.record(z.string(), json),
          allocations: z
            .array(createSelectSchema(s.financeAllocations).strict())
            .optional(),
        })
        .strict(),
    })
    .strict(),
};
for (const name of [
  "finance_refresh",
  "finance_filter",
  "finance_scenario_preview",
  "finance_save_view_filters",
  "finance_save_view_scenario",
  "finance_view_apply_scenario",
  "finance_view_undo_budget",
])
  outputSchemas[name] = openedView;
export function normalizedResult(value: unknown) {
  return Array.isArray(value) ? { records: value } : value;
}
