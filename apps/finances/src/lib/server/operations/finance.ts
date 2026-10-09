import * as q from '@/lib/db/queries';
import type { FinancePrincipal } from '@/lib/db/finance-queries';
import { z } from 'zod/v4';
import { viewDefinitionSchema, viewScopeSchema, dateOnly } from '@/lib/finance/contracts';
import { runHarnessJson } from '@/lib/harness/one-shot';
import { financeDatasets } from '@/lib/finance/service';

export async function composeFinanceView(
  p: FinancePrincipal,
  input: {
    question: string;
    scope: z.infer<typeof viewScopeSchema>;
    viewId?: string;
    expectedRevision: number;
    mutationKey: string;
    originChatId?: string;
  },
) {
  const scope = viewScopeSchema.parse(input.scope);
  if (input.viewId) {
    const current = q.getFinanceView(p, input.viewId);
    if (current.revision !== input.expectedRevision)
      throw new Error('View changed. Review its current revision.');
  }
  const datasets = financeDatasets(p, scope);
  // The model supplies presentation only. No extracted email body, credential,
  // literal financial value or executable expression belongs in this contract.
  const generationSchema=z.object({definition:viewDefinitionSchema,dateScope:z.object({startOn:dateOnly,endOn:dateOnly}).strict().optional()}).strict();
  const context = {
    today:new Intl.DateTimeFormat('en-CA',{timeZone:q.getFinanceSettings()!.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),
    coverage:datasets.accounts.map(a=>({name:a.name,historyStart:a.historyStart,asOf:a.asOf})),
    currency: datasets.currency,
    period: { startOn: scope.startOn, endOn: scope.endOn },
    categories: datasets.budgetRecord?.plan.categories.map((c) => ({
      id: c.id,
      name: c.name,
    })),
    goals: datasets.budgetRecord?.plan.goals.map((g) => ({
      id: g.id,
      name: g.name,
    })),
    obligations: datasets.budgetRecord?.plan.obligations.map((o) => ({
      id: o.id,
      category: o.category,
    })),
    availableDatasets: [
      'budget',
      'transactions',
      'accounts',
      'refunds',
      'recurring',
      'findings',
      'trends',
      'comparison',
      'evidence',
    ],
    currentView: input.viewId
      ? q.getFinanceView(p, input.viewId).definition
      : null,
  };
  const generated = await runHarnessJson({
    label: 'finance-compose-view',
    tier: 'standard',
    maxTurns: 1,
    timeoutSec: 90,
    system:
      'Return a declarative finance view definition and, when the question requests a different activity date range, a dateScope matching the supplied JSON schema. Resolve relative dates from context.today. endOn is exclusive. A request for the last six months requires a six-month activity range. Date scope changes never alter the adopted budget period. Use only the listed dataset names and category ids. No code, URLs, SQL, arbitrary tools or literal financial results. Metrics always bind to server results. Use short plain titles. Budget metrics cover the budget period only. For longer history use trends and transactions. When requested categories are named, set categoryIds on charts and tables. Include applicable filters and a save_scenario action for scenarios. Do not use em dashes or semicolons in titles.',
    prompt: JSON.stringify({ question: input.question, context }),
    schema: generationSchema,
    shape: JSON.stringify(z.toJSONSchema(generationSchema,{target:'draft-7'})),
  });
  const resolvedScope=viewScopeSchema.parse({...scope,...generated.dateScope});
  // Resolve activity scope before computing the bounded, authorized server results.
  financeDatasets(p,resolvedScope);
  return q.saveFinanceView(p, {
    id: input.viewId,
    definition: generated.definition,
    scope:resolvedScope,
    expectedRevision: input.expectedRevision,
    mutationKey: input.mutationKey,
    originChatId: input.originChatId,
  });
}
