import {widgetInputSchema,viewOperations,runViewOperation} from '@/lib/mcp/view-operations';
import { z } from 'zod/v4';
import { router, viewerProcedure as p } from './init';
import * as q from '@/lib/db/queries';
import {
  budgetPlanSchema,
  cardObligationsSchema,
  dateOnly,
  evidenceSchema,
  financeAccountSchema,
  financeId,
  minorUnits,
  mutationKey,
  revisionNumber,
  scenarioChangesSchema,
  transactionSchema,
  viewDefinitionSchema,
  viewScopeSchema,
} from '@/lib/finance/contracts';
import { seedSyntheticFinance } from '@/lib/finance/synthetic';
import {
  financeDatasets,
  openFinanceView,
  reconcileFinance,
} from '@/lib/finance/service';
import { normalizeFinanceCsv, exportFinanceCsv } from '@/lib/finance/imports';
import { composeFinanceView } from '@/lib/server/operations/finance';
import {
  listFinanceSourceConnections,
  beginFinanceBankLink,
  finishFinanceBankLink,
  connectFinanceMailbox,
  disconnectFinanceSource,
} from '@/lib/finance/sources';
import {
  proposeFinanceBudget,
  nextFinanceBudgetPeriod,
} from '@/lib/finance/onboarding';
import { getAppRoot, getDevAppRoot, getTestAppRoot } from '@/lib/config/paths';
import { TRPCError } from '@trpc/server';
import { openFinanceChat } from '@/lib/server/operations/finance-chat';
const owner = q.financeOwner;
const syntheticAllowed = () =>

  ([getDevAppRoot(), getTestAppRoot()].includes(getAppRoot()) ||
    process.env.FINANCE_SYNTHETIC === '1');
const ids = z.array(financeId).min(1).max(100);
export const financeRouter = router({
  viewOperation:p.input(z.object({name:z.enum(viewOperations),arguments:widgetInputSchema}).strict()).mutation(({input})=>runViewOperation(q.financeOwner,input.name,input.arguments)),
  status: p.query(() => ({
    settings: q.getFinanceSettings(),
    accounts: q.listFinanceAccounts(owner),
    budgets: q.listFinanceBudgets(owner),
    views: q.listFinanceViews(owner),
    syntheticAllowed: syntheticAllowed(),
  })),
  configure: p
    .input(
      z
        .object({
          enabled: z.boolean(),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
          timezone: z.string().max(80).optional(),
          restoreReviewed: z.boolean().optional(),
          autoTasks: z.boolean().optional(),
          thresholds: z
            .object({
              overspendMinor: minorUnits.nonnegative(),
              priceChangePercent: z.number().min(0).max(1000),
            })
            .strict()
            .optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => q.configureFinance(owner, input)),
  seedSynthetic: p.mutation(() => {
    if (!syntheticAllowed())
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Synthetic examples are available on a disposable development data folder',
      });
    return seedSyntheticFinance(owner);
  }),
  sourceConnections: p.query(() => listFinanceSourceConnections(owner)),
  beginBankLink: p
    .input(
      z
        .object({
          developerConnectionId: financeId,
          environment: z.enum(['sandbox', 'production']),
          confirmUSPersonalUSD: z.literal(true),
          liabilities: z.boolean(),
          reconnectAccountId: financeId.optional(),
          redirectUri: z.url().optional(),
        })
        .strict(),
    )
    .mutation(({ input, ctx }) =>
      beginFinanceBankLink(owner, {
        ...input,
        redirectUri: input.redirectUri
          ? new URL('/finance', ctx.request.url).href
          : undefined,
      }),
    ),
  finishBankLink: p
    .input(
      z
        .object({
          sessionId: financeId,
          publicToken: z.string().max(500).optional(),
          selectedAccountIds: ids,
          liabilities: z.boolean(),
        })
        .strict(),
    )
    .mutation(({ input }) => finishFinanceBankLink(owner, input)),
  connectMailbox: p
    .input(
      z
        .object({
          connectionId: financeId,
          provider: z.enum(['google', 'microsoft']),
          initialStartOn: dateOnly,
          query: z.string().max(500),
          monitoring: z.boolean(),
          acknowledgeBroadMailboxRead: z.literal(true),
        })
        .strict(),
    )
    .mutation(({ input }) => connectFinanceMailbox(owner, input)),
  proposeBudget: p
    .input(
      z
        .object({
          accountIds: ids,
          incomeMinor: minorUnits.nonnegative().optional(),
          startDay: z.number().int().min(1).max(31),
          mutationKey,
        })
        .strict(),
    )
    .mutation(({ input }) => proposeFinanceBudget(owner, input)),
  nextPeriod: p
    .input(z.object({ id: financeId, mutationKey }).strict())
    .mutation(({ input }) =>
      nextFinanceBudgetPeriod(owner, input.id, input.mutationKey),
    ),
  copies: p.query(() => q.listFinanceCopies(owner)),
  openChat: p
    .input(
      z
        .object({
          viewId: financeId,
          includeEvidence: z.boolean(),
          allowEdits: z.boolean(),
        })
        .strict(),
    )
    .mutation(({ input }) => openFinanceChat(owner, input)),
  updateManualAccount: p
    .input(
      z
        .object({
          id: financeId,
          balanceMinor: minorUnits.nullable(),
          balanceIncludesPending: z.boolean(),
          mask: z.string().max(32).nullable().optional(),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      q.updateManualFinanceAccount(owner, input.id, {
        balanceMinor: input.balanceMinor,
        balanceIncludesPending: input.balanceIncludesPending,
        mask: input.mask,
      }),
    ),
  recordTransaction: p
    .input(
      z
        .object({
          data: transactionSchema.omit({ sourceId: true }),
          mutationKey,
        })
        .strict(),
    )
    .mutation(({ input }) => q.recordManualFinanceTransaction(owner, input)),
  exportTransactions: p
    .input(
      z
        .object({ accountIds: ids, startOn: dateOnly, endOn: dateOnly })
        .strict(),
    )
    .mutation(({ input }) => {
      if (input.endOn <= input.startOn)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid export date range',
        });
      const rows = q.financeTransactionsForCalculation(owner, input);
      q.recordFinanceCopy(
        owner,
        input.accountIds,
        'download',
        'finance-transactions.csv',
      );
      return {
        csv: exportFinanceCsv(rows),
        rowCount: rows.length,
        asOf: new Date().toISOString(),
        scope: input,
      };
    }),
  recordExport: p
    .input(z.object({ accountIds: ids }).strict())
    .mutation(({ input }) =>
      q.recordFinanceCopy(
        owner,
        input.accountIds,
        'download',
        'finance-export.json',
      ),
    ),
  createAccount: p
    .input(financeAccountSchema)
    .mutation(({ input }) => q.createFinanceAccount(owner, input)),
  grantCandidates: p.query(() => q.financeGrantCandidates(owner)),
  grants: p.query(() => q.financeGrantList(owner)),
  grant: p
    .input(
      z
        .object({
          principal: z.string().max(140),
          accountIds: ids,
          operations: z
            .array(z.enum(['read', 'write', 'sync', 'evidence']))
            .max(4),
          revoked: z.boolean().optional(),
        })
        .strict(),
    )
    .mutation(({ input }) =>
      q.grantFinance(
        owner,
        input.principal,
        input.accountIds,
        input.operations,
        input.revoked,
      ),
    ),
  transactions: p
    .input(
      z
        .object({
          accountIds: ids,
          startOn: dateOnly,
          endOn: dateOnly,
          limit: z.number().int().min(1).max(1000).optional(),
          after: z
            .object({ date: dateOnly, id: financeId })
            .strict()
            .optional(),
        })
        .strict(),
    )
    .query(({ input }) => q.listFinanceTransactions(owner, input)),
  importCsv: p
    .input(
      z
        .object({
          text: z.string().max(5 * 1024 * 1024),
          accountId: financeId,
          currency: z.string().regex(/^[A-Z]{3}$/),
          positiveMeansSpending: z.boolean(),
          columns: z
            .object({
              date: z.string(),
              merchant: z.string(),
              amount: z.string(),
              category: z.string().optional(),
            })
            .strict()
            .optional(),
          preview: z.boolean(),
        })
        .strict(),
    )
    .mutation(({ input }) => {
      const account = q.requireFinance(owner, [input.accountId], 'write')[0],
        added = normalizeFinanceCsv(input);
      if (account.currency !== input.currency)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'CSV currency differs from account',
        });
      if (input.preview)
        return {
          preview: added.slice(0, 30),
          count: added.length,
          imported: false,
        };
      return {
        ...q.applyFinanceSync(owner, {
          accountIds: [input.accountId],
          generation: q.getFinanceSettings()!.generation,
          added,
          removed: [],
          asOf: new Date().toISOString(),
        }),
        imported: true,
      };
    }),
  manualTransaction: p.input(transactionSchema).mutation(({ input }) =>
    q.applyFinanceSync(owner, {
      accountIds: [input.accountId],
      generation: q.getFinanceSettings()!.generation,
      added: [input],
      removed: [],
      asOf: new Date().toISOString(),
    }),
  ),
  correctTransaction: p
    .input(
      z
        .object({
          id: financeId,
          category: z.string().min(1).max(80).optional(),
          kind: transactionSchema.shape.kind.optional(),
          obligationId: financeId.optional(),
          rememberMerchant: z.boolean().optional(),
          expectedRevision: revisionNumber,
          mutationKey,
        })
        .strict(),
    )
    .mutation(({ input }) => q.overrideFinanceTransaction(owner, input)),
  createBudget: p
    .input(
      z
        .object({
          name: z.string().min(1).max(160),
          accountIds: ids,
          plan: budgetPlanSchema,
          mutationKey,
        })
        .strict(),
    )
    .mutation(({ input }) => q.createFinanceBudget(owner, input)),
  budget: p
    .input(
      z
        .object({ id: financeId, changes: scenarioChangesSchema.optional() })
        .strict(),
    )
    .query(({ input }) =>
      q.calculateFinanceBudget(owner, input.id, undefined, input.changes),
    ),
  changeBudget: p
    .input(
      z
        .object({
          id: financeId,
          expectedRevision: revisionNumber,
          mutationKey,
          plan: budgetPlanSchema.optional(),
          adopt: z.boolean().optional(),
          undo: z.boolean().optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => q.changeFinanceBudget(owner, input)),
  saveScenario: p
    .input(
      z
        .object({
          id: financeId.optional(),
          budgetId: financeId,
          name: z.string().min(1).max(160),
          changes: scenarioChangesSchema,
          expectedRevision: revisionNumber,
          mutationKey,
        })
        .strict(),
    )
    .mutation(({ input }) => q.saveFinanceScenario(owner, input)),
  applyScenario: p
    .input(
      z
        .object({
          scenarioId: financeId,
          expectedBudgetRevision: revisionNumber,
          mutationKey,
        })
        .strict(),
    )
    .mutation(({ input }) => q.applyFinanceScenario(owner, input)),
  saveView: p
    .input(
      z
        .object({
          id: financeId.optional(),
          definition: viewDefinitionSchema,
          scope: viewScopeSchema,
          expectedRevision: revisionNumber,
          mutationKey,
          originChatId: financeId.optional(),
          scenarioId: financeId.optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => q.saveFinanceView(owner, input)),
  openView: p
    .input(
      z
        .object({
          id: financeId,
          expectedRevision: revisionNumber.optional(),
          changes: scenarioChangesSchema.optional(),
          filters: z
            .object({
              startOn: dateOnly.optional(),
              endOn: dateOnly.optional(),
              accountIds: ids.optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    )
    .query(({ input }) => openFinanceView(owner, input.id, input)),
  composeView: p
    .input(
      z
        .object({
          question: z.string().trim().min(1).max(2000),
          scope: viewScopeSchema,
          viewId: financeId.optional(),
          expectedRevision: revisionNumber,
          mutationKey,
          originChatId: financeId.optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => composeFinanceView(owner, input)),
  datasets: p
    .input(viewScopeSchema)
    .query(({ input }) => financeDatasets(owner, input)),
  evidence: p
    .input(z.object({ id: financeId }).strict())
    .query(({ input }) => q.getFinanceEvidence(owner, input.id)),
  allocations: p
    .input(z.object({ evidenceId: financeId }).strict())
    .query(({ input }) => q.listFinanceAllocations(owner, [input.evidenceId])),
  saveEvidence: p
    .input(
      z
        .object({
          data: evidenceSchema,
          reviewed: z.boolean(),
          expectedRevision: revisionNumber.optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => q.saveFinanceEvidence(owner, input)),
  matchEvidence: p
    .input(
      z
        .object({
          evidenceId: financeId,
          transactionId: financeId,
          amountMinor: minorUnits.nonnegative(),
          itemId: financeId.optional(),
          decision: z.enum(['human', 'confirmed', 'suggested', 'rejected']),
          role: z.enum(['purchase', 'refund', 'recharge']).optional(),
          confidence: z.number().min(0).max(1),
          expectedRevision: revisionNumber,
          mutationKey,
        })
        .strict(),
    )
    .mutation(({ input }) => q.matchFinanceEvidence(owner, input)),
  reconcile: p
    .input(viewScopeSchema)
    .mutation(({ input }) => reconcileFinance(owner, input)),
  finding: p
    .input(z.object({ id: financeId }).strict())
    .query(({ input }) => q.getFinanceFinding(owner, input.id)),
  followup: p
    .input(z.object({ findingId: financeId }).strict())
    .mutation(({ input }) => q.createFinanceFollowup(owner, input.findingId)),
  snooze: p
    .input(
      z.object({ id: financeId, until: z.iso.datetime().nullable() }).strict(),
    )
    .mutation(({ input }) =>
      q.snoozeFinanceFinding(owner, input.id, input.until),
    ),
  cardObligations: p
    .input(
      z.object({ id: financeId, obligations: cardObligationsSchema }).strict(),
    )
    .mutation(({ input }) =>
      q.updateFinanceAccountSource(owner, input.id, {
        cardObligations: input.obligations,
      }),
    ),
  queueSync: p
    .input(z.object({ id: financeId }).strict())
    .mutation(({ input }) => q.queueFinanceSync(owner, input.id)),
  disconnect: p
    .input(z.object({ id: financeId, retain: z.boolean() }).strict())
    .mutation(({ input }) =>
      disconnectFinanceSource(owner, input.id, input.retain),
    ),
  deleteLive: p
    .input(
      z
        .object({ accountIds: ids, acknowledgeRetainedCopies: z.literal(true) })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const accounts = q.requireFinance(owner, input.accountIds);
      for (const a of accounts.filter((a) => a.access === 'connected'))
        await disconnectFinanceSource(owner, a.id, true);
      return q.deleteLiveFinanceData(owner, input.accountIds);
    }),
});
