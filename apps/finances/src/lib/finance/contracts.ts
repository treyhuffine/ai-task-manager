import { z } from 'zod/v4';

export const minorUnits = z
  .number()
  .int()
  .refine(Number.isSafeInteger, 'Amount exceeds exact integer range');
export const currencyCode = z.string().regex(/^[A-Z]{3}$/);
export const financeId = z.string().min(1).max(128);
export const dateOnly = z.iso.date();
export const financeAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    kind: z.enum(['cash', 'credit', 'mailbox', 'excluded']),
    provider: z.enum(['manual', 'plaid', 'google', 'microsoft', 'synthetic']),
    currency: currencyCode,
    connectionId: financeId.nullable(),
    sourceId: financeId,
    mask: z.string().max(32).nullable().optional(),
    balanceMinor: minorUnits.nullable(),
    balanceIncludesPending: z.boolean(),
    historyStart: dateOnly.nullable(),
    asOf: z.iso.datetime().nullable(),
  })
  .strict();
export const transactionSchema = z
  .object({
    sourceId: financeId,
    accountId: financeId,
    amountMinor: minorUnits,
    currency: currencyCode,
    postedOn: dateOnly,
    authorizedOn: dateOnly.nullable(),
    merchant: z.string().max(300),
    category: z.string().min(1).max(80),
    kind: z.enum([
      'purchase',
      'refund',
      'income',
      'transfer',
      'card_payment',
      'interest',
      'fee',
    ]),
    state: z.enum(['pending', 'posted', 'removed']),
    pendingSourceId: financeId.nullable(),
    obligationId: financeId.nullable(),
    refundOf: financeId.nullable(),
  })
  .strict();
export const obligationSchema = z
  .object({
    id: financeId,
    category: z.string().min(1).max(80),
    amountMinor: minorUnits,
    dueOn: dateOnly,
    kind: z.enum(['purchase', 'card_payment']),
    source: z.enum(['manual', 'provider', 'evidence', 'inferred']),
    accountId: financeId.optional(),
    merchant: z.string().max(300).optional(),
    reserveId: financeId.optional(),
  })
  .strict();
export const budgetPlanSchema = z
  .object({
    currency: currencyCode,
    timezone: z.string().min(1).max(80),
    startOn: dateOnly,
    endOn: dateOnly,
    startDay: z.number().int().min(1).max(31).optional(),
    incomeMinor: minorUnits.nonnegative(),
    incomeConfidence: z.enum(['confirmed', 'assumed']),
    categories: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            name: z.string().min(1).max(100),
            limitMinor: minorUnits.nonnegative(),
            rollover: z.enum(['none', 'positive', 'both']),
            rolloverMinor: minorUnits,
            variableForecastMinor: minorUnits.nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    obligations: z.array(obligationSchema).max(300),
    reserves: z
      .array(
        z
          .object({
            id: financeId,
            name: z.string().max(100),
            contributionMinor: minorUnits.nonnegative(),
            heldMinor: minorUnits.nonnegative(),
            targetMinor: minorUnits.nonnegative(),
          })
          .strict(),
      )
      .max(40),
    goals: z
      .array(
        z
          .object({
            id: financeId,
            name: z.string().max(100),
            contributionMinor: minorUnits.nonnegative(),
            targetMinor: minorUnits.nonnegative(),
            heldMinor: minorUnits.nonnegative().optional(),
            dueOn: dateOnly.nullable().optional(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.endOn <= plan.startOn)
      ctx.addIssue({ code: 'custom', message: 'Budget end must follow start' });
    if (
      new Set(plan.categories.map((c) => c.id)).size !== plan.categories.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate category' });
    if (
      new Set(plan.obligations.map((o) => o.id)).size !==
      plan.obligations.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate obligation' });
    for (const records of [plan.goals, plan.reserves])
      if (new Set(records.map((r) => r.id)).size !== records.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate goal or reserve' });
    for (const obligation of plan.obligations)
      if (
        obligation.reserveId &&
        (!plan.reserves.some((r) => r.id === obligation.reserveId) ||
          obligation.kind !== 'purchase')
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Reserve funding must name a reserve and a purchase obligation',
        });
    for (const obligation of plan.obligations)
      if (
        obligation.amountMinor < 0 ||
        !plan.categories.some((c) => c.id === obligation.category)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid obligation amount or category',
        });
    try {
      new Intl.DateTimeFormat('en', { timeZone: plan.timezone });
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid timezone' });
    }
  });
export type FinancePlan = z.infer<typeof budgetPlanSchema>;
export const scenarioChangesSchema = z
  .object({
    categoryLimits: z.record(z.string().max(80), minorUnits.nonnegative()),
    incomeMinor: minorUnits.nonnegative().optional(),
    goalContributions: z.record(z.string().max(128), minorUnits.nonnegative()),
    obligationAmounts: z.record(z.string().max(128), minorUnits.nonnegative()),
  })
  .strict();
export type FinanceScenarioChanges = z.infer<typeof scenarioChangesSchema>;

export const evidenceSchema = z
  .object({
    sourceId: financeId,
    accountId: financeId,
    kind: z.enum([
      'receipt',
      'return',
      'refund',
      'renewal',
      'cancellation',
      'statement',
    ]),
    merchant: z.string().max(300),
    orderId: z.string().max(160).nullable(),
    occurredOn: dateOnly,
    currency: currencyCode,
    totalMinor: minorUnits.nonnegative().nullable(),
    promiseMinor: minorUnits.nonnegative().nullable(),
    destination: z.enum([
      'cash',
      'card',
      'gift_card',
      'store_credit',
      'unknown',
    ]),
    deadlineOn: dateOnly.nullable(),
    settlementDueOn: dateOnly.nullable(),
    recurrence:z.object({cadence:z.enum(['monthly','annual','variable']),renewalMinor:minorUnits.nonnegative().nullable(),nextChargeOn:dateOnly.nullable(),trialEndsOn:dateOnly.nullable()}).strict().optional(),
    events: z
      .array(
        z
          .object({
            kind: z.enum([
              'ordered',
              'delivered',
              'return_requested',
              'dispatched',
              'refund_promised',
              'exchanged',
              'recharged',
            ]),
            on: dateOnly,
            source: z.string().max(500),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    paymentParts: z
      .array(
        z
          .object({
            destination: z.enum(['cash', 'card', 'gift_card', 'store_credit']),
            amountMinor: minorUnits.nonnegative(),
            maskedHint: z.string().max(32).nullable(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    refundParts: z
      .array(
        z
          .object({
            destination: z.enum(['cash', 'card', 'gift_card', 'store_credit']),
            amountMinor: minorUnits.nonnegative(),
            maskedHint: z.string().max(32).nullable(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    adjustments: z
      .object({
        taxMinor: minorUnits.nonnegative(),
        shippingMinor: minorUnits.nonnegative(),
        discountMinor: minorUnits.nonnegative(),
        deductionMinor: minorUnits.nonnegative(),
      })
      .strict()
      .optional(),
    items: z
      .array(
        z
          .object({
            id: financeId,
            name: z.string().max(300),
            quantity: z.number().int().positive().max(10000),
            amountMinor: minorUnits.nonnegative(),
            returnedQuantity: z.number().int().nonnegative().max(10000),
          })
          .strict(),
      )
      .max(300),
    excerpt: z.string().max(24000),
    confidence: z.number().min(0).max(1),
    provenance: z
      .object({
        source: z.enum(['manual', 'email', 'attachment', 'synthetic']),
        extractorVersion: z.string().max(100),
        messageIds: z.array(z.string().max(1000)).max(50),
        termsSource: z.string().max(500).nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (
      e.refundParts?.length &&
      e.promiseMinor !== null &&
      e.refundParts.reduce(
        (total, part) => total + BigInt(part.amountMinor),
        BigInt(0),
      ) !== BigInt(e.promiseMinor)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Refund destinations must sum to the promised refund',
      });
    for (const item of e.items)
      if (item.returnedQuantity > item.quantity)
        ctx.addIssue({
          code: 'custom',
          message: 'Returned quantity exceeds purchased quantity',
        });
    if (new Set(e.items.map((i) => i.id)).size !== e.items.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate item' });
  });
export type FinanceEvidenceData = z.infer<typeof evidenceSchema>;

export const datasetName = z.enum([
  'budget',
  'transactions',
  'accounts',
  'refunds',
  'recurring',
  'findings',
  'trends',
  'comparison',
  'evidence',
]);
const componentBase = { id: financeId, title: z.string().min(1).max(160) };
export const viewComponentSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...componentBase,
      type: z.literal('metric'),
      metric: z.enum([
        'posted',
        'pending',
        'remaining',
        'forecast',
        'unallocated',
        'cashAvailable',
      ]),
      categoryId: z.string().max(80).optional(),
    })
    .strict(),
  z
    .object({
      ...componentBase,
      type: z.literal('table'),
      dataset: datasetName,
      categoryIds: z.array(z.string().max(80)).max(40).optional(),
      columns: z
        .array(
          z.enum([
            'name',
            'merchant',
            'category',
            'amountMinor',
            'postedOn',
            'state',
            'asOf',
            'cadence',
            'nextOn',
            'annualMinor',
            'deductionMinor',
            'settlementGapMinor',
            'status',
            'message',
          ]),
        )
        .min(1)
        .max(10),
    })
    .strict(),
  z
    .object({
      ...componentBase,
      type: z.literal('chart'),
      dataset: z.enum(['trends', 'budget', 'comparison']),
      categoryIds: z.array(z.string().max(80)).max(40).optional(),
      style: z.enum(['bars', 'line']),
    })
    .strict(),
  z
    .object({
      ...componentBase,
      type: z.literal('timeline'),
      dataset: z.enum(['refunds', 'evidence', 'transactions']),
    })
    .strict(),
  z
    .object({
      ...componentBase,
      type: z.literal('scenario'),
      parameter: z
        .enum(['category', 'income', 'goal', 'obligation'])
        .optional(),
      categoryId: z.string().min(1).max(80),
      minMinor: minorUnits.nonnegative(),
      maxMinor: minorUnits.nonnegative(),
      stepMinor: minorUnits.positive(),
    })
    .strict(),
  z
    .object({
      ...componentBase,
      type: z.literal('filter'),
      dimension: z.enum(['dates', 'accounts']),
    })
    .strict(),
  z
    .object({
      ...componentBase,
      type: z.literal('action'),
      action: z.enum([
        'refresh',
        'apply_scenario',
        'undo_budget',
        'save_scenario',
        'save_filters',
      ]),
    })
    .strict(),
]);
export const viewDefinitionSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(160),
    layout: z.enum(['stack', 'grid']),
    components: z.array(viewComponentSchema).min(1).max(24),
  })
  .strict()
  .superRefine((view, ctx) => {
    if (
      new Set(view.components.map((c) => c.id)).size !== view.components.length
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate component id' });
    for (const component of view.components)
      if (
        component.type === 'scenario' &&
        component.maxMinor <= component.minMinor
      )
        ctx.addIssue({ code: 'custom', message: 'Invalid scenario range' });
  });
export type FinanceViewDefinition = z.infer<typeof viewDefinitionSchema>;
export const viewScopeSchema = z
  .object({
    accountIds: z.array(financeId).min(1).max(100),
    startOn: dateOnly,
    endOn: dateOnly,
    budgetId: financeId.nullable(),
    evidenceId: financeId.nullable(),
    filters: z
      .object({
        accountIds: z.array(financeId).min(1).max(100).optional(),
        startOn: dateOnly.optional(),
        endOn: dateOnly.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((scope) => scope.endOn > scope.startOn, 'Invalid date range');
export type FinanceViewScope = z.infer<typeof viewScopeSchema>;
export const financeOperation = z.enum(['read', 'write', 'sync', 'evidence']);
export type FinanceOperation = z.infer<typeof financeOperation>;

export const mutationKey = z.string().min(8).max(160);
export const revisionNumber = z.number().int().nonnegative();
export const cardObligationsSchema = z
  .object({
    asOf: z.iso.datetime(),
    statementBalanceMinor: minorUnits.nullable(),
    currentBalanceMinor: minorUnits.nullable(),
    minimumPaymentMinor: minorUnits.nonnegative().nullable(),
    chosenPaymentMinor: minorUnits.nonnegative().nullable(),
    dueOn: dateOnly.nullable(),
    source: z.enum(['provider', 'manual']),
  })
  .strict();
