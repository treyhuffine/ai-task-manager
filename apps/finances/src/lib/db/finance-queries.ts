import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  notInArray,
  lt,
  sql,
} from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { getConfigDir, getAttachmentsDir } from '@/lib/config/paths';
import { createHash } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { getDb } from './index';
import * as s from './schema';
import type {
  FinanceAccountRecord,
  FinanceBudgetRecord,
  FinanceTransactionRecord,
} from '@/db/types';
import {
  budgetPlanSchema,
  evidenceSchema,
  financeAccountSchema,
  scenarioChangesSchema,
  transactionSchema,
  viewDefinitionSchema,
  viewScopeSchema,
  type FinanceOperation,
  type FinancePlan,
  type FinanceScenarioChanges,
  type FinanceViewDefinition,
  type FinanceViewScope,
} from '@/lib/finance/contracts';
import { OperationError } from '@/lib/server/operation';
import { applyScenario, calculateBudget } from '@/lib/finance/calculations';
import { exactAmount, sumMoney } from '@/lib/finance/money';
import { financeBudgetDiff } from '@/lib/finance/budget-diff';

import { createLocalFollowup } from './app-queries';

export type FinancePrincipal = { id: string; owner: boolean };
export const financeOwner: FinancePrincipal = { id: 'owner', owner: true };
function refuse(message: string, status = 403): never {
  throw new OperationError(status, {
    error:
      status === 409
        ? 'conflict'
        : status === 404
          ? 'not_found'
          : 'finance_access_denied',
    message,
  });
}
export function getFinanceSettings() {
  const settings =
    getDb()
      .select()
      .from(s.financeSettings)
      .where(eq(s.financeSettings.id, 'local'))
      .get() ?? null;
  return settings &&
    fs.existsSync(path.join(getConfigDir(), 'finance-review-required'))
    ? { ...settings, restoreReviewed: false }
    : settings;
}
export function configureFinance(
  p: FinancePrincipal,
  input: {
    enabled: boolean;
    timezone?: string;
    currency?: string;
    restoreReviewed?: boolean;
    autoTasks?: boolean;
    thresholds?: { overspendMinor: number; priceChangePercent: number };
  },
) {
  if (!p.owner) refuse('Only the owner can configure finance');
  const before = getFinanceSettings();
  const row = {
    id: 'local',
    enabled: input.enabled,
    timezone: input.timezone ?? before?.timezone ?? 'America/Denver',
    currency: input.currency ?? before?.currency ?? 'USD',
    restoreReviewed: input.restoreReviewed ?? before?.restoreReviewed ?? true,
    startDay: before?.startDay ?? 1,
    generation: (before?.generation ?? 0) + (input.enabled === false ? 1 : 0),
    autoTasks: input.autoTasks ?? before?.autoTasks ?? false,
    thresholds: input.thresholds ??
      before?.thresholds ?? { overspendMinor: 2500, priceChangePercent: 10 },
  };
  try {
    new Intl.DateTimeFormat('en', { timeZone: row.timezone });
    new Intl.NumberFormat('en', { style: 'currency', currency: row.currency });
  } catch {
    refuse('Invalid finance timezone or currency', 400);
  }
  getDb()
    .insert(s.financeSettings)
    .values(row)
    .onConflictDoUpdate({ target: s.financeSettings.id, set: row })
    .run();
  if (!input.enabled)
    getDb()
      .update(s.financeSync)
      .set({ state: 'disabled', leaseUntil: null })
      .run();
  if(input.enabled && (!before?.enabled || (!before.restoreReviewed&&input.restoreReviewed===true))){
    const connected=getDb().select({id:s.financeAccounts.id}).from(s.financeAccounts).where(eq(s.financeAccounts.access,'connected')).all().map(a=>a.id);
    if(connected.length)getDb().update(s.financeSync).set({state:'idle',generation:row.generation,nextOn:new Date().toISOString(),attempts:0,leaseUntil:null,leaseToken:null,rerunRequested:false}).where(inArray(s.financeSync.accountId,connected)).run();
  }
  if (input.restoreReviewed === true)
    fs.rmSync(path.join(getConfigDir(), 'finance-review-required'), {
      force: true,
    });
  return getFinanceSettings()!;
}
export function requireFinance(
  p: FinancePrincipal,
  ids: string[],
  op: FinanceOperation = 'read',
): FinanceAccountRecord[] {
  const settings = getFinanceSettings();
  if (!settings?.enabled || !settings.restoreReviewed)
    refuse(
      !settings?.enabled
        ? 'Finance is disabled'
        : 'Review restored finance data before access',
    );
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
    refuse('Select distinct accounts', 400);
  const accounts = getDb()
    .select()
    .from(s.financeAccounts)
    .where(inArray(s.financeAccounts.id, ids))
    .all();
  if (
    accounts.length !== ids.length ||
    accounts.some(
      (a) =>
        a.access === 'revoked' || (op === 'sync' && a.access !== 'connected'),
    )
  )
    refuse('An account is missing or access was revoked');
  if (!p.owner) {
    const grants = getDb()
      .select()
      .from(s.financeGrants)
      .where(
        and(
          eq(s.financeGrants.principal, p.id),
          inArray(s.financeGrants.accountId, ids),
          eq(s.financeGrants.revoked, false),
        ),
      )
      .all();
    if (
      ids.some(
        (id) =>
          !grants.some((g) => g.accountId === id && g.operations.includes(op)),
      )
    )
      refuse('Finance account permission required');
  }
  return accounts;
}
export function listFinanceAccounts(p: FinancePrincipal) {
  if (!getFinanceSettings()?.enabled) return [];
  if (!getFinanceSettings()?.restoreReviewed) return [];
  const all = getDb().select().from(s.financeAccounts).limit(101).all();
  if (all.length > 100) refuse('Account limit exceeded', 400);
  if (p.owner) return all;
  const grants = getDb()
    .select()
    .from(s.financeGrants)
    .where(
      and(
        eq(s.financeGrants.principal, p.id),
        eq(s.financeGrants.revoked, false),
      ),
    )
    .all();
  return all.filter(
    (a) =>
      a.access !== 'revoked' &&
      grants.some((g) => g.accountId === a.id && g.operations.includes('read')),
  );
}
export function createFinanceAccount(p: FinancePrincipal, input: unknown) {
  if (
    !p.owner ||
    !getFinanceSettings()?.enabled ||
    !getFinanceSettings()?.restoreReviewed
  )
    refuse('Finance owner setup required');
  const parsed = financeAccountSchema.parse(input);
  const prior = getDb()
    .select()
    .from(s.financeAccounts)
    .where(
      and(
        eq(s.financeAccounts.provider, parsed.provider),
        eq(s.financeAccounts.sourceId, parsed.sourceId),
      ),
    )
    .get();
  if (prior) {
    if (
      ['plaid', 'google', 'microsoft'].includes(parsed.provider) &&
      prior.access === 'retained'
    )
      return getDb()
        .update(s.financeAccounts)
        .set({ ...parsed, access: 'connected', syncStatus: 'idle' })
        .where(eq(s.financeAccounts.id, prior.id))
        .returning()
        .get();
    return prior;
  }
  return getDb()
    .insert(s.financeAccounts)
    .values({
      ...parsed,
      id: uuidv7(),
      access: 'connected',
      cardObligations: null,
      syncStatus: 'idle',
    })
    .returning()
    .get();
}
export function grantFinance(
  p: FinancePrincipal,
  principal: string,
  accountIds: string[],
  operations: FinanceOperation[],
  revoked = false,
) {
  if (!p.owner) refuse('Only the owner can change finance access');
  requireFinance(p, accountIds);
  if (
    !/^chat:[a-zA-Z0-9-]{1,128}$/.test(principal) &&
    !/^worker:[a-zA-Z0-9-]{1,128}$/.test(principal) && !/^client:[a-zA-Z0-9-]{1,128}$/.test(principal)
  )
    refuse('Invalid finance principal', 400);
  getDb().transaction((db) => {
    for (const accountId of accountIds)
      db.insert(s.financeGrants)
        .values({ id: uuidv7(), principal, accountId, operations, revoked })
        .onConflictDoUpdate({
          target: [s.financeGrants.principal, s.financeGrants.accountId],
          set: { operations, revoked },
        })
        .run();
  });
  return { principal, accountIds, operations, revoked };
}
export function listFinanceTransactions(
  p: FinancePrincipal,
  scope: {
    accountIds: string[];
    startOn: string;
    endOn: string;
    limit?: number;
    transactionId?: string;
    after?: { date: string; id: string };
  },
) {
  requireFinance(p, scope.accountIds);
  const limit = Math.min(1000, Math.max(1, scope.limit ?? 500));
  const rows = getDb()
    .select()
    .from(s.financeTransactions)
    .where(
      and(
        inArray(s.financeTransactions.accountId, scope.accountIds),
        gte(s.financeTransactions.postedOn, scope.startOn),
        lt(s.financeTransactions.postedOn, scope.endOn),
        scope.transactionId ? eq(s.financeTransactions.id, scope.transactionId) : undefined,
        scope.after
          ? sql`(${s.financeTransactions.postedOn},${s.financeTransactions.id}) > (${scope.after.date},${scope.after.id})`
          : undefined,
      ),
    )
    .orderBy(asc(s.financeTransactions.postedOn), asc(s.financeTransactions.id))
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);
  const refundLinks = page
    .filter((t) => t.kind === 'refund')
    .flatMap((t) => (t.refundOf ? [t.refundOf] : []));
  const originals = refundLinks.length
    ? getDb()
        .select()
        .from(s.financeTransactions)
        .where(
          and(
            inArray(s.financeTransactions.id, refundLinks),
            inArray(s.financeTransactions.accountId, scope.accountIds),
          ),
        )
        .all()
    : [];
  const overrides = page.length
    ? getDb()
        .select()
        .from(s.financeOverrides)
        .where(
          inArray(s.financeOverrides.transactionId, [
            ...page.map((t) => t.id),
            ...originals.map((t) => t.id),
          ]),
        )
        .all()
    : [];
  const rules = getDb()
    .select()
    .from(s.financeRules)
    .where(inArray(s.financeRules.accountId, scope.accountIds))
    .limit(1000)
    .all();
  const effective = page.map((t) => {
    const o = overrides.find((o) => o.transactionId === t.id),
      rule = rules.find(
        (r) =>
          r.accountId === t.accountId &&
          r.merchant === t.merchant.toLowerCase(),
      );
    return {
      ...t,
      category:
        o?.category ??
        (t.kind === 'refund' && t.refundOf
          ? (overrides.find((o) => o.transactionId === t.refundOf)?.category ??
            originals.find((p) => p.id === t.refundOf)?.category)
          : undefined) ??
        rule?.category ??
        t.category,
      kind: o?.kind ?? t.kind,
      obligationId: o?.obligationId ?? t.obligationId,
    };
  });
  const last = page.at(-1);
  return {
    rows: effective,
    next:
      rows.length > limit && last ? { date: last.postedOn, id: last.id } : null,
  };
}
/** Resolve one entity link through the same rule and override projection as lists. */
export function getFinanceTransaction(p: FinancePrincipal, id: string) {
  const record = getDb().select().from(s.financeTransactions).where(eq(s.financeTransactions.id, id)).get();
  if (!record) refuse('Transaction not found', 404);
  requireFinance(p, [record.accountId]);
  const nextDay = new Date(record.postedOn + 'T00:00:00Z');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return listFinanceTransactions(p, {accountIds:[record.accountId],startOn:record.postedOn,endOn:nextDay.toISOString().slice(0,10),limit:1,transactionId:id}).rows[0];
}
export function financeTransactionsForCalculation(
  p: FinancePrincipal,
  scope: { accountIds: string[]; startOn: string; endOn: string },
) {
  const all: FinanceTransactionRecord[] = [];
  let after: { date: string; id: string } | undefined;
  do {
    const page = listFinanceTransactions(p, { ...scope, limit: 1000, after });
    all.push(...page.rows);
    after = page.next ?? undefined;
    if (all.length > 50000)
      refuse('Narrow the calculation date/account scope', 400);
  } while (after);
  return all;
}
export function applyFinanceSync(
  p: FinancePrincipal,
  input: {
    accountIds: string[];
    generation: number;
    added: unknown[];
    removed: { accountId: string; sourceId: string }[];
    cursor?: string;
    syncAccountId?: string;
    jobId?: string;
    leaseToken?: string | null;
    asOf: string;
  },
) {
  requireFinance(p, input.accountIds, 'sync');
  if (input.added.length > 50000 || input.removed.length > 50000)
    refuse('Sync batch exceeds limit', 400);
  const parsed = input.added.map((t) => transactionSchema.parse(t));
  if (
    [...parsed, ...input.removed].some(
      (t) => !input.accountIds.includes(t.accountId),
    )
  )
    refuse('Sync contains an unselected account');
  return getDb().transaction((db) => {
    if (getFinanceSettings()?.generation !== input.generation)
      refuse('Finance generation changed during sync', 409);
    requireFinance(p, input.accountIds, 'sync');
    if(input.jobId && input.leaseToken) assertFinanceJobLease(input.jobId,input.leaseToken,input.generation);
    for (const t of parsed) {
      if (t.pendingSourceId) {
        const pending = db
          .select()
          .from(s.financeTransactions)
          .where(
            and(
              eq(s.financeTransactions.accountId, t.accountId),
              eq(s.financeTransactions.sourceId, t.pendingSourceId),
            ),
          )
          .get();
        if (pending) {
          const override = db
            .select()
            .from(s.financeOverrides)
            .where(eq(s.financeOverrides.transactionId, pending.id))
            .get();
          // Preserve the canonical internal id, human decisions and allocations.
          const existingPosted = db
            .select()
            .from(s.financeTransactions)
            .where(
              and(
                eq(s.financeTransactions.accountId, t.accountId),
                eq(s.financeTransactions.sourceId, t.sourceId),
              ),
            )
            .get();
          if (!existingPosted) {
            db.update(s.financeTransactions)
              .set({ ...t, sourceRevision: pending.sourceRevision + 1 })
              .where(eq(s.financeTransactions.id, pending.id))
              .run();
            continue;
          }
          db.update(s.financeTransactions)
            .set({ state: 'removed' })
            .where(eq(s.financeTransactions.id, pending.id))
            .run();
          if (override)
            db.insert(s.financeOverrides)
              .values({
                ...override,
                id: uuidv7(),
                transactionId: existingPosted.id,
              })
              .onConflictDoNothing()
              .run();
          const pendingAllocations = db
            .select()
            .from(s.financeAllocations)
            .where(eq(s.financeAllocations.transactionId, pending.id))
            .all();
          for (const allocation of pendingAllocations) {
            const postedAllocation = db
              .select()
              .from(s.financeAllocations)
              .where(
                and(
                  eq(s.financeAllocations.evidenceId, allocation.evidenceId),
                  eq(s.financeAllocations.transactionId, existingPosted.id),
                ),
              )
              .get();
            if (!postedAllocation)
              db.update(s.financeAllocations)
                .set({ transactionId: existingPosted.id })
                .where(eq(s.financeAllocations.id, allocation.id))
                .run();
            else if (
              allocation.decision === 'human' &&
              postedAllocation.decision !== 'human'
            ) {
              db.update(s.financeAllocations)
                .set({
                  amountMinor: allocation.amountMinor,
                  itemId: allocation.itemId,
                  decision: 'human',
                  confidence: allocation.confidence,
                  role: allocation.role,
                  revision: postedAllocation.revision + 1,
                })
                .where(eq(s.financeAllocations.id, postedAllocation.id))
                .run();
            }
          }
        }
      }
      db.insert(s.financeTransactions)
        .values({ ...t, id: uuidv7() })
        .onConflictDoUpdate({
          target: [
            s.financeTransactions.accountId,
            s.financeTransactions.sourceId,
          ],
          set: {
            ...t,
            sourceRevision: sql`${s.financeTransactions.sourceRevision}+1`,
          },
        })
        .run();
    }
    for (const t of input.removed)
      db.update(s.financeTransactions)
        .set({
          state: 'removed',
          sourceRevision: sql`${s.financeTransactions.sourceRevision}+1`,
        })
        .where(
          and(
            eq(s.financeTransactions.accountId, t.accountId),
            eq(s.financeTransactions.sourceId, t.sourceId),
          ),
        )
        .run();
    for (const id of input.accountIds)
      db.update(s.financeAccounts)
        .set({ syncStatus: 'idle', asOf: input.asOf })
        .where(eq(s.financeAccounts.id, id))
        .run();
    if (input.syncAccountId)
      db.update(s.financeSync)
        .set({
          cursor: input.cursor ?? null,
          state: 'idle',
          attempts: 0,
          leaseUntil: null,
          lastError: null,
          nextOn: new Date(
            Date.parse(input.asOf) + 6 * 60 * 60 * 1000,
          ).toISOString(),
        })
        .where(eq(s.financeSync.accountId, input.syncAccountId))
        .run();
    return {
      added: parsed.length,
      removed: input.removed.length,
      asOf: input.asOf,
    };
  });
}
function operationHash(operation: string, input: unknown) {
  return `${operation}:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
}
function replay(p: FinancePrincipal, key: string, operation: string) {
  const row = getDb()
    .select()
    .from(s.financeRevisions)
    .where(
      and(
        eq(s.financeRevisions.principal, p.id),
        eq(s.financeRevisions.mutationKey, key),
      ),
    )
    .get();
  if (row && row.operation !== operation)
    refuse('Mutation key was already used for a different change', 409);
  return row;
}
function record(
  p: FinancePrincipal,
  key: string,
  operation: string,
  entityType: import('@/db/types').FinanceRevisionRecord['entityType'],
  entityId: string,
  revision: number,
  before: unknown,
  after: unknown,
) {
  getDb()
    .insert(s.financeRevisions)
    .values({
      id: uuidv7(),
      principal: p.id,
      mutationKey: key,
      operation,
      entityType,
      entityId,
      revision,
      before,
      after,
    })
    .run();
}
export function createFinanceBudget(
  p: FinancePrincipal,
  input: {
    name: string;
    plan: FinancePlan;
    accountIds: string[];
    mutationKey: string;
  },
) {
  requireFinance(p, input.accountIds, 'write');
  const plan = budgetPlanSchema.parse(input.plan),
    op = operationHash('create_budget', { ...input, plan });
  return getDb().transaction((db) => {
    const old = replay(p, input.mutationKey, op);
    if (old) return old.after as FinanceBudgetRecord;
    const row = db
      .insert(s.financeBudgets)
      .values({
        id: uuidv7(),
        name: input.name,
        state: 'proposal',
        plan,
        accountIds: input.accountIds,
      })
      .returning()
      .get();
    record(p, input.mutationKey, op, 'budget', row.id, row.revision, null, row);
    return row;
  });
}
export function getFinanceBudget(p: FinancePrincipal, id: string) {
  const b = getDb()
    .select()
    .from(s.financeBudgets)
    .where(eq(s.financeBudgets.id, id))
    .get();
  if (!b) refuse('Budget not found', 404);
  requireFinance(p, b.accountIds);
  return b;
}
export function listFinanceBudgets(p: FinancePrincipal) {
  const ids = listFinanceAccounts(p)
    .filter((a) => a.access !== 'revoked')
    .map((a) => a.id);
  return getDb()
    .select()
    .from(s.financeBudgets)
    .orderBy(desc(s.financeBudgets.createdAt))
    .limit(100)
    .all()
    .filter((b) => b.accountIds.every((id) => ids.includes(id)));
}
export function calculateFinanceBudget(
  p: FinancePrincipal,
  id: string,
  asOf = new Date().toISOString(),
  changes?: FinanceScenarioChanges,
) {
  const b = getFinanceBudget(p, id);
  const plan = changes ? applyScenario(b.plan, changes) : b.plan;
  return {
    budget: b,
    result: calculateBudget({
      plan,
      accounts: requireFinance(p, b.accountIds),
      transactions: financeTransactionsForCalculation(p, {
        accountIds: b.accountIds,
        startOn: plan.startOn,
        endOn: plan.endOn,
      }),
      asOf,
    }),
  };
}
export function changeFinanceBudget(
  p: FinancePrincipal,
  input: {
    id: string;
    expectedRevision: number;
    mutationKey: string;
    plan?: FinancePlan;
    adopt?: boolean;
    undo?: boolean;
  },
) {
  const b = getFinanceBudget(p, input.id);
  requireFinance(p, b.accountIds, 'write');
  const op = operationHash('change_budget', input);
  return getDb().transaction((db) => {
    const old = replay(p, input.mutationKey, op);
    if (old) return old.after as FinanceBudgetRecord;
    const before = getFinanceBudget(p, input.id);
    if (before.revision !== input.expectedRevision)
      refuse('The budget changed. Review the current revision.', 409);
    if (before.state === 'closed')
      refuse('Closed budgets cannot be edited', 409);
    let plan = input.plan ? budgetPlanSchema.parse(input.plan) : before.plan;
    let state: FinanceBudgetRecord['state'] = input.adopt
      ? 'adopted'
      : before.state;
    if (input.undo) {
      const prior = db
        .select()
        .from(s.financeRevisions)
        .where(
          and(
            eq(s.financeRevisions.entityType, 'budget'),
            eq(s.financeRevisions.entityId, b.id),
            eq(s.financeRevisions.revision, b.revision),
          ),
        )
        .get();
      if (!prior?.before) refuse('No previous budget change to undo', 409);
      plan = budgetPlanSchema.parse((prior.before as FinanceBudgetRecord).plan);
      state = (prior.before as FinanceBudgetRecord).state;
    }
    const row = db
      .update(s.financeBudgets)
      .set({ plan, state, revision: before.revision + 1 })
      .where(eq(s.financeBudgets.id, b.id))
      .returning()
      .get();
    const result = {
      ...row,
      diff: financeBudgetDiff(before.plan, row.plan),
      stateChange: { before: before.state, after: row.state },
    };
    record(
      p,
      input.mutationKey,
      op,
      'budget',
      b.id,
      row.revision,
      before,
      result,
    );
    return result;
  });
}
export function saveFinanceScenario(
  p: FinancePrincipal,
  input: {
    id?: string;
    budgetId: string;
    name: string;
    changes: FinanceScenarioChanges;
    expectedRevision: number;
    mutationKey: string;
  },
) {
  const b = getFinanceBudget(p, input.budgetId);
  const changes = scenarioChangesSchema.parse(input.changes);
  applyScenario(b.plan, changes);
  requireFinance(p, b.accountIds, 'write');
  const op = operationHash('save_scenario', input);
  return getDb().transaction((db) => {
    const prior = replay(p, input.mutationKey, op);
    if (prior) return prior.after as import('@/db/types').FinanceScenarioRecord;
    const before = input.id
      ? db
          .select()
          .from(s.financeScenarios)
          .where(eq(s.financeScenarios.id, input.id))
          .get()
      : null;
    if (input.id && (!before || before.budgetId !== b.id))
      refuse('Scenario not found', 404);
    if ((before?.revision ?? 0) !== input.expectedRevision)
      refuse('Scenario changed', 409);
    const id = before?.id ?? uuidv7(),
      values = {
        budgetId: b.id,
        name: input.name,
        baseRevision: b.revision,
        changes,
        revision: before ? before.revision + 1 : 0,
      };
    const row = db
      .insert(s.financeScenarios)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: s.financeScenarios.id, set: values })
      .returning()
      .get();
    record(p, input.mutationKey, op, 'scenario', id, row.revision, before, row);
    return row;
  });
}
export function getFinanceScenario(p: FinancePrincipal, id: string) {
  const row = getDb()
    .select()
    .from(s.financeScenarios)
    .where(eq(s.financeScenarios.id, id))
    .get();
  if (!row) refuse('Scenario not found', 404);
  getFinanceBudget(p, row.budgetId);
  return row;
}
export function applyFinanceScenario(
  p: FinancePrincipal,
  input: {
    scenarioId: string;
    expectedBudgetRevision: number;
    mutationKey: string;
  },
) {
  const scenario = getFinanceScenario(p, input.scenarioId),
    b = getFinanceBudget(p, scenario.budgetId);
  if (scenario.baseRevision !== input.expectedBudgetRevision)
    refuse('Scenario uses an older budget. Rebase it before applying.', 409);
  const base = b.revision === scenario.baseRevision ? b : getDb().select().from(s.financeRevisions).where(and(eq(s.financeRevisions.entityType,'budget'),eq(s.financeRevisions.entityId,b.id),eq(s.financeRevisions.revision,scenario.baseRevision))).get()?.after as FinanceBudgetRecord | undefined;
  if(!base) refuse('The scenario base is unavailable',409);
  return changeFinanceBudget(p, {id:b.id,expectedRevision:input.expectedBudgetRevision,mutationKey:input.mutationKey,plan:applyScenario(base.plan,scenario.changes)});
}
export function saveFinanceView(
  p: FinancePrincipal,
  input: {
    id?: string;
    definition: FinanceViewDefinition;
    scope: FinanceViewScope;
    expectedRevision: number;
    mutationKey: string;
    originChatId?: string;
    scenarioId?: string;
  },
) {
  const definition = viewDefinitionSchema.parse(input.definition),
    scope = viewScopeSchema.parse(input.scope);
  requireFinance(p, scope.accountIds, 'read');
  if (scope.filters?.accountIds?.some((id) => !scope.accountIds.includes(id)))
    refuse('Saved filters cannot widen account permissions', 400);
  if (scope.evidenceId) getFinanceEvidence(p, scope.evidenceId);
  if (scope.budgetId) {
    const b = getFinanceBudget(p, scope.budgetId);
    if (b.accountIds.some((id) => !scope.accountIds.includes(id)))
      refuse('View scope must include the budget accounts', 400);
    for (const c of definition.components)
      if (
        ((c.type === 'scenario' &&
          (!c.parameter || c.parameter === 'category')) ||
          (c.type === 'metric' && c.categoryId)) &&
        !b.plan.categories.some((category) => category.id === c.categoryId)
      )
        refuse('Unknown view category', 400);
    for (const c of definition.components)
      if (
        c.type === 'scenario' &&
        ((c.parameter === 'goal' &&
          !b.plan.goals.some((g) => g.id === c.categoryId)) ||
          (c.parameter === 'obligation' &&
            !b.plan.obligations.some((o) => o.id === c.categoryId)))
      )
        refuse('Unknown scenario parameter', 400);
  } else if (
    definition.components.some((c) => ['metric', 'scenario'].includes(c.type))
  )
    refuse('Budget controls require a budget', 400);
  if (input.scenarioId) {
    const scenario = getFinanceScenario(p, input.scenarioId);
    if (scenario.budgetId !== scope.budgetId)
      refuse('Scenario belongs to a different budget', 400);
  }
  const op = operationHash('save_view', input);
  return getDb().transaction((db) => {
    const prior = replay(p, input.mutationKey, op);
    if (prior) return prior.after as import('@/db/types').FinanceViewRecord;
    const before = input.id
      ? db
          .select()
          .from(s.financeViews)
          .where(eq(s.financeViews.id, input.id))
          .get()
      : null;
    if (input.id && !before) refuse('View not found', 404);
    if (before) requireFinance(p, before.scope.accountIds);
    if ((before?.revision ?? 0) !== input.expectedRevision)
      refuse('View changed. Preserve the current view and retry.', 409);
    const id = before?.id ?? uuidv7(),
      values = {
        definition,
        scope,
        revision: before ? before.revision + 1 : 0,
        mode: 'live' as const,
        asOf: new Date().toISOString(),
        originChatId: input.originChatId ?? before?.originChatId ?? null,
        scenarioId: input.scenarioId ?? before?.scenarioId ?? null,
      };
    const row = db
      .insert(s.financeViews)
      .values({ id, ...values })
      .onConflictDoUpdate({ target: s.financeViews.id, set: values })
      .returning()
      .get();
    record(p, input.mutationKey, op, 'view', id, row.revision, before, row);
    return row;
  });
}
export function getFinanceView(p: FinancePrincipal, id: string) {
  const row = getDb()
    .select()
    .from(s.financeViews)
    .where(eq(s.financeViews.id, id))
    .get();
  if (!row) refuse('View not found', 404);
  requireFinance(p, row.scope.accountIds);
  if (row.scope.evidenceId) getFinanceEvidence(p, row.scope.evidenceId);
  return row;
}
export function listFinanceViews(p: FinancePrincipal) {
  const ids = listFinanceAccounts(p)
    .filter((a) => a.access !== 'revoked')
    .map((a) => a.id);
  return getDb()
    .select()
    .from(s.financeViews)
    .orderBy(desc(s.financeViews.updatedAt))
    .limit(100)
    .all()
    .filter((v) => v.scope.accountIds.every((id) => ids.includes(id)));
}
export function saveFinanceEvidence(
  p: FinancePrincipal,
  input: {
    data: unknown;
    attachments?: s.StoredAttachment[];
    reviewed?: boolean;
    expectedRevision?: number;
  },
) {
  const data = evidenceSchema.parse(input.data);
  requireFinance(p, [data.accountId], 'evidence');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        data.kind,
        data.orderId,
        data.merchant.toLowerCase(),
        data.currency,
        data.totalMinor,
        data.promiseMinor,
        data.occurredOn,
      ]),
    )
    .digest('hex');
  const before = getDb()
    .select()
    .from(s.financeEvidence)
    .where(
      and(
        eq(s.financeEvidence.accountId, data.accountId),
        eq(s.financeEvidence.sourceId, data.sourceId),
      ),
    )
    .get();
  if (input.reviewed) {
    requireFinance(p, [data.accountId], 'write');
    if (before && input.expectedRevision !== before.revision)
      refuse('Evidence changed. Review its current revision.', 409);
  } else if (before?.humanReviewed) return before;
  const duplicate = data.orderId
    ? getDb()
        .select()
        .from(s.financeEvidence)
        .where(
          and(
            eq(s.financeEvidence.accountId, data.accountId),
            eq(s.financeEvidence.fingerprint, fingerprint),
          ),
        )
        .get()
    : null;
  if (duplicate && duplicate.id !== before?.id) return duplicate;
  const values = {
    accountId: data.accountId,
    sourceId: data.sourceId,
    fingerprint,
    occurredOn: data.occurredOn,
    data,
    attachments: input.attachments ?? before?.attachments ?? [],
    humanReviewed: input.reviewed ?? false,
    revision: before ? before.revision + 1 : 0,
  };
  return getDb().transaction((db) => {
    const e = db
      .insert(s.financeEvidence)
      .values({ id: before?.id ?? uuidv7(), ...values })
      .onConflictDoUpdate({ target: s.financeEvidence.id, set: values })
      .returning()
      .get();
    for (const a of e.attachments)
      db.insert(s.financeAttachmentRefs)
        .values({ id: uuidv7(), evidenceId: e.id, fileName: a.file_name })
        .onConflictDoNothing()
        .run();
    return e;
  });
}
export function getFinanceEvidence(p: FinancePrincipal, id: string) {
  const e = getDb()
    .select()
    .from(s.financeEvidence)
    .where(eq(s.financeEvidence.id, id))
    .get();
  if (!e) refuse('Evidence not found', 404);
  requireFinance(p, [e.accountId], 'evidence');
  return e;
}
export function getFinanceEvidenceBySource(
  p: FinancePrincipal,
  accountId: string,
  sourceId: string,
) {
  requireFinance(p, [accountId], 'evidence');
  return (
    getDb()
      .select()
      .from(s.financeEvidence)
      .where(
        and(
          eq(s.financeEvidence.accountId, accountId),
          eq(s.financeEvidence.sourceId, sourceId),
        ),
      )
      .get() ?? null
  );
}
export function listFinanceEvidence(p: FinancePrincipal, accountIds: string[]) {
  requireFinance(p, accountIds, 'evidence');
  return getDb()
    .select()
    .from(s.financeEvidence)
    .where(inArray(s.financeEvidence.accountId, accountIds))
    .orderBy(desc(s.financeEvidence.occurredOn))
    .limit(1000)
    .all();
}
export function overrideFinanceTransaction(
  p: FinancePrincipal,
  input: {
    id: string;
    category?: string;
    kind?: FinanceTransactionRecord['kind'];
    obligationId?: string;
    rememberMerchant?: boolean;
    expectedRevision: number;
    mutationKey: string;
  },
) {
  const t = getDb()
    .select()
    .from(s.financeTransactions)
    .where(eq(s.financeTransactions.id, input.id))
    .get();
  if (!t) refuse('Transaction not found', 404);
  requireFinance(p, [t.accountId], 'write');
  const op = operationHash('override', input);
  return getDb().transaction((db) => {
    const prior = replay(p, input.mutationKey, op);
    if (prior) return prior.after as import('@/db/types').FinanceOverrideRecord;
    const before = db
      .select()
      .from(s.financeOverrides)
      .where(eq(s.financeOverrides.transactionId, t.id))
      .get();
    if ((before?.revision ?? 0) !== input.expectedRevision)
      refuse('Transaction correction changed', 409);
    const values = {
      transactionId: t.id,
      category: input.category ?? before?.category ?? null,
      kind: input.kind ?? before?.kind ?? null,
      obligationId: input.obligationId ?? before?.obligationId ?? null,
      revision: before ? before.revision + 1 : 0,
    };
    const row = db
      .insert(s.financeOverrides)
      .values({ id: before?.id ?? uuidv7(), ...values })
      .onConflictDoUpdate({
        target: s.financeOverrides.transactionId,
        set: values,
      })
      .returning()
      .get();
    if (input.rememberMerchant && input.category)
      db.insert(s.financeRules)
        .values({
          id: uuidv7(),
          accountId: t.accountId,
          merchant: t.merchant.toLowerCase(),
          category: input.category,
        })
        .onConflictDoUpdate({
          target: [s.financeRules.accountId, s.financeRules.merchant],
          set: { category: input.category },
        })
        .run();
    record(
      p,
      input.mutationKey,
      op,
      'override',
      row.id,
      row.revision,
      before,
      row,
    );
    return row;
  });
}
export function listFinanceFindings(p: FinancePrincipal, ids: string[]) {
  requireFinance(p, ids);
  return getDb()
    .select()
    .from(s.financeFindings)
    .where(inArray(s.financeFindings.accountId, ids))
    .orderBy(desc(s.financeFindings.updatedAt))
    .limit(500)
    .all();
}
export function upsertFinanceFinding(
  p: FinancePrincipal,
  input: Omit<
    import('@/db/types').FinanceFindingRecord,
    'id' | 'createdAt' | 'updatedAt' | 'handoffId' | 'snoozedUntil'
  >,
) {
  requireFinance(p, [input.accountId], 'write');
  if (
    input.state === 'resolved' &&
    !getDb()
      .select({ id: s.financeFindings.id })
      .from(s.financeFindings)
      .where(
        and(
          eq(s.financeFindings.accountId, input.accountId),
          eq(s.financeFindings.key, input.key),
        ),
      )
      .limit(1)
      .get()
  )
    return null;
  return getDb()
    .insert(s.financeFindings)
    .values({ id: uuidv7(), handoffId: null, snoozedUntil: null, ...input })
    .onConflictDoUpdate({
      target: [s.financeFindings.accountId, s.financeFindings.key],
      set: {
        message: input.message,
        amountMinor: input.amountMinor,
        dueOn: input.dueOn,
        transactionIds: input.transactionIds,
        state:
          input.state === 'open'
            ? sql`CASE WHEN ${s.financeFindings.state} = 'snoozed' AND ${s.financeFindings.snoozedUntil} > ${new Date().toISOString()} THEN 'snoozed' ELSE 'open' END`
            : input.state,
      },
    })
    .returning()
    .get();
}
export function snoozeFinanceFinding(
  p: FinancePrincipal,
  id: string,
  until: string | null,
) {
  const f = getDb()
    .select()
    .from(s.financeFindings)
    .where(eq(s.financeFindings.id, id))
    .get();
  if (!f) refuse('Finding not found', 404);
  requireFinance(p, [f.accountId], 'write');
  return getDb()
    .update(s.financeFindings)
    .set({ state: until ? 'snoozed' : 'open', snoozedUntil: until })
    .where(eq(s.financeFindings.id, id))
    .returning()
    .get();
}
export function disconnectFinanceAccount(
  p: FinancePrincipal,
  id: string,
  retain: boolean,
) {
  if (!p.owner) refuse('Only the owner can disconnect accounts');
  requireFinance(p, [id]);
  return getDb().transaction((db) => {
    db.update(s.financeSettings)
      .set({ generation: sql`${s.financeSettings.generation}+1` })
      .run();
    db.update(s.financeGrants)
      .set({ revoked: true })
      .where(eq(s.financeGrants.accountId, id))
      .run();
    db.update(s.financeSync)
      .set({ state: 'disabled', leaseUntil: null })
      .where(eq(s.financeSync.accountId, id))
      .run();
    return db
      .update(s.financeAccounts)
      .set({
        access: retain ? 'retained' : 'revoked',
        connectionId: null,
        syncStatus: 'stale',
      })
      .where(eq(s.financeAccounts.id, id))
      .returning()
      .get();
  });
}
export function deleteLiveFinanceData(p: FinancePrincipal, ids: string[]) {
  if (!p.owner) refuse('Only the owner can delete live finance data');
  requireFinance(p, ids);
  const result = getDb().transaction((db) => {
    const views = db
      .select()
      .from(s.financeViews)
      .all()
      .filter((v) => v.scope.accountIds.some((id) => ids.includes(id)));
    const budgets = db
      .select()
      .from(s.financeBudgets)
      .all()
      .filter((b) => b.accountIds.some((id) => ids.includes(id)));
    const transactionIds = db
      .select({ id: s.financeTransactions.id })
      .from(s.financeTransactions)
      .where(inArray(s.financeTransactions.accountId, ids))
      .all()
      .map((t) => t.id);
    const evidenceIds = db
      .select({ id: s.financeEvidence.id })
      .from(s.financeEvidence)
      .where(inArray(s.financeEvidence.accountId, ids))
      .all()
      .map((e) => e.id);
    const privateFiles = evidenceIds.length
      ? db
          .select()
          .from(s.financeAttachmentRefs)
          .where(inArray(s.financeAttachmentRefs.evidenceId, evidenceIds))
          .all()
      : [];
    const overrideIds = transactionIds.length
      ? db
          .select({ id: s.financeOverrides.id })
          .from(s.financeOverrides)
          .where(inArray(s.financeOverrides.transactionId, transactionIds))
          .all()
          .map((e) => e.id)
      : [];
    const allocationIds = evidenceIds.length
      ? db
          .select({ id: s.financeAllocations.id })
          .from(s.financeAllocations)
          .where(inArray(s.financeAllocations.evidenceId, evidenceIds))
          .all()
          .map((e) => e.id)
      : [];
    const relatedIds = [
      ...views.map((v) => v.id),
      ...budgets.map((b) => b.id),
      ...transactionIds,
      ...overrideIds,
      ...allocationIds,
    ];
    if (budgets.length) {
      const scenarios = db
        .select({ id: s.financeScenarios.id })
        .from(s.financeScenarios)
        .where(
          inArray(
            s.financeScenarios.budgetId,
            budgets.map((b) => b.id),
          ),
        )
        .all();
      relatedIds.push(...scenarios.map((s) => s.id));
    }
    if (relatedIds.length)
      db.delete(s.financeRevisions)
        .where(inArray(s.financeRevisions.entityId, relatedIds))
        .run();
    for (const v of views)
      db.delete(s.financeViews).where(eq(s.financeViews.id, v.id)).run();
    for (const b of budgets)
      db.delete(s.financeBudgets).where(eq(s.financeBudgets.id, b.id)).run();
    db.update(s.financeSettings)
      .set({ generation: sql`${s.financeSettings.generation}+1` })
      .run();
    db.delete(s.financeAccounts)
      .where(inArray(s.financeAccounts.id, ids))
      .run();
    for (const a of privateFiles)
      db.insert(s.financeFileDeletions)
        .values({ id: uuidv7(), fileName: a.fileName })
        .onConflictDoNothing()
        .run();
    return {
      deletedAccountIds: ids,
      retainedCopies:
        'Finance backups retain copies under their normal retention. Previously shared text, exports and downloads are separate copies. Restoring a backup requires finance review.',
      backupsDeleted: false,
    };
  });
  const cleanup = cleanupFinanceFiles();
  return { ...result, ...cleanup };
}

/** Retriable private-byte cleanup, including while the plugin is disabled. */
export function cleanupFinanceFiles() {
  const db = getDb();
  if (getFinanceSettings()?.restoreReviewed === false)
    return {
      pendingFileDeletions: db
        .select({ count: sql<number>`count(*)` })
        .from(s.financeFileDeletions)
        .get()!.count,
    };
  const preserved = new Set<string>();
  for (const row of db
    .select()
    .from(s.financeFileDeletions)
    .limit(1000)
    .all()) {
    if (preserved.has(row.fileName)) {
      db.delete(s.financeFileDeletions)
        .where(eq(s.financeFileDeletions.id, row.id))
        .run();
      continue;
    }
    try {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(row.fileName))
        throw new Error('Invalid private file name');
      fs.rmSync(path.join(getAttachmentsDir(), row.fileName), { force: true });
      db.delete(s.financeFileDeletions)
        .where(eq(s.financeFileDeletions.id, row.id))
        .run();
    } catch {
      db.update(s.financeFileDeletions)
        .set({ attempts: row.attempts + 1 })
        .where(eq(s.financeFileDeletions.id, row.id))
        .run();
    }
  }
  return {
    pendingFileDeletions: db
      .select({ count: sql<number>`count(*)` })
      .from(s.financeFileDeletions)
      .get()!.count,
  };
}

export function updateFinanceAccountSource(
  p: FinancePrincipal,
  id: string,
  input: {
    balanceMinor?: number | null;
    asOf?: string;
    cardObligations?: FinanceAccountRecord['cardObligations'];
    syncStatus?: FinanceAccountRecord['syncStatus'];
    historyStart?: string;
  },
) {
  requireFinance(p, [id], 'sync');
  if (input.balanceMinor != null) exactAmount(input.balanceMinor);
  return getDb()
    .update(s.financeAccounts)
    .set(input)
    .where(eq(s.financeAccounts.id, id))
    .returning()
    .get();
}
export function financeSnapshotTotals(
  p: FinancePrincipal,
  ids: string[],
  startOn: string,
  endOn: string,
) {
  return sumMoney(
    financeTransactionsForCalculation(p, { accountIds: ids, startOn, endOn })
      .filter((t) => t.state === 'posted' && t.kind === 'purchase')
      .map((t) => t.amountMinor),
  );
}

export function listFinanceAllocations(
  p: FinancePrincipal,
  evidenceIds: string[],
) {
  if (evidenceIds.length > 1000) refuse('Narrow evidence selection', 400);
  for (const id of evidenceIds) getFinanceEvidence(p, id);
  return evidenceIds.length
    ? getDb()
        .select()
        .from(s.financeAllocations)
        .where(inArray(s.financeAllocations.evidenceId, evidenceIds))
        .limit(5000)
        .all()
    : [];
}
export function matchFinanceEvidence(
  p: FinancePrincipal,
  input: {
    evidenceId: string;
    transactionId: string;
    amountMinor: number;
    itemId?: string;
    decision: 'human' | 'confirmed' | 'suggested' | 'rejected';
    role?: 'purchase' | 'refund' | 'recharge';
    confidence: number;
    expectedRevision: number;
    mutationKey: string;
  },
) {
  const e = getFinanceEvidence(p, input.evidenceId),
    t = getDb()
      .select()
      .from(s.financeTransactions)
      .where(eq(s.financeTransactions.id, input.transactionId))
      .get();
  if (!t) refuse('Transaction not found', 404);
  requireFinance(
    p,
    [e.accountId, t.accountId].filter((id, i, all) => all.indexOf(id) === i),
    'write',
  );
  exactAmount(input.amountMinor);
  if (
    input.amountMinor < 0 ||
    input.amountMinor > Math.abs(t.amountMinor) ||
    e.data.currency !== t.currency ||
    (input.itemId && !e.data.items.some((i) => i.id === input.itemId))
  )
    refuse('Invalid evidence allocation', 400);
  const role = input.role ?? (t.amountMinor < 0 ? 'refund' : 'purchase');
  if (
    (role === 'refund' && t.amountMinor >= 0) ||
    (role !== 'refund' && t.amountMinor <= 0)
  )
    refuse('Allocation role does not match the transaction direction', 400);
  const op = operationHash('match_evidence', input);
  return getDb().transaction((db) => {
    const old = replay(p, input.mutationKey, op);
    if (old) return old.after as import('@/db/types').FinanceAllocationRecord;
    const before = db
      .select()
      .from(s.financeAllocations)
      .where(
        and(
          eq(s.financeAllocations.evidenceId, e.id),
          eq(s.financeAllocations.transactionId, t.id),
        ),
      )
      .get();
    if ((before?.revision ?? 0) !== input.expectedRevision)
      refuse('Match decision changed', 409);
    if (before?.decision === 'human' && input.decision !== 'human')
      refuse('Automatic matching cannot overwrite a human decision', 409);
    const others = db
      .select()
      .from(s.financeAllocations)
      .where(eq(s.financeAllocations.transactionId, t.id))
      .all()
      .filter(
        (a) =>
          a.evidenceId !== e.id && ['human', 'confirmed'].includes(a.decision),
      );
    if (
      ['human', 'confirmed'].includes(input.decision) &&
      sumMoney([...others.map((a) => a.amountMinor), input.amountMinor]) >
        Math.abs(t.amountMinor)
    )
      refuse('Transaction is already allocated', 409);
    if (
      role === 'purchase' &&
      e.data.totalMinor !== null &&
      ['human', 'confirmed'].includes(input.decision)
    ) {
      const allocated = db
        .select()
        .from(s.financeAllocations)
        .where(eq(s.financeAllocations.evidenceId, e.id))
        .all()
        .filter(
          (a) =>
            a.transactionId !== t.id &&
            ['human', 'confirmed'].includes(a.decision) &&
            (a.role === 'purchase' || a.role === null),
        );
      if (
        sumMoney([...allocated.map((a) => a.amountMinor), input.amountMinor]) >
        e.data.totalMinor
      )
        refuse('Purchase evidence is already allocated', 409);
    }
    const values = {
      evidenceId: e.id,
      transactionId: t.id,
      amountMinor: input.amountMinor,
      itemId: input.itemId ?? null,
      role,
      decision: input.decision,
      confidence: input.confidence,
      revision: before ? before.revision + 1 : 0,
    };
    const row = db
      .insert(s.financeAllocations)
      .values({ id: before?.id ?? uuidv7(), ...values })
      .onConflictDoUpdate({
        target: [
          s.financeAllocations.evidenceId,
          s.financeAllocations.transactionId,
        ],
        set: values,
      })
      .returning()
      .get();
    record(
      p,
      input.mutationKey,
      op,
      'allocation',
      row.id,
      row.revision,
      before,
      row,
    );
    return row;
  });
}
export function createFinanceFollowup(p: FinancePrincipal, findingId: string) {
  const f = getDb()
    .select()
    .from(s.financeFindings)
    .where(eq(s.financeFindings.id, findingId))
    .get();
  if (!f) refuse('Finding not found', 404);
  requireFinance(p, [f.accountId], 'write');
  return getDb().transaction((db) => {
    const current = db
      .select()
      .from(s.financeFindings)
      .where(eq(s.financeFindings.id, f.id))
      .get()!;
    if (current.handoffId)
      return { handoffId: current.handoffId, status:'pending' as const, reference: `/finance?finding=${f.id}` };
    // Dynamic import is unnecessary: queries.ts re-exports this module, and the
    // imported function is only called after both modules finish initializing.
    const task = createLocalFollowup({
      findingId:f.id,reference:`/finance?finding=${f.id}`,
      title: 'Review a finance follow-up',
      body: `Open the protected finance record: /finance?finding=${f.id}`,
      hardDeadline: f.dueOn ?? undefined,
    });
    db.update(s.financeFindings)
      .set({ handoffId: task.id })
      .where(eq(s.financeFindings.id, f.id))
      .run();
    return { handoffId: task.id, status:'pending' as const, reference: `/finance?finding=${f.id}` };
  });
}
export function getFinanceFinding(p: FinancePrincipal, id: string) {
  const f = getDb()
    .select()
    .from(s.financeFindings)
    .where(eq(s.financeFindings.id, id))
    .get();
  if (!f) refuse('Finding not found', 404);
  requireFinance(p, [f.accountId]);
  if (f.evidenceId) getFinanceEvidence(p, f.evidenceId);
  return f;
}
export function listFinanceRecurring(p: FinancePrincipal, ids: string[]) {
  requireFinance(p, ids);
  return getDb()
    .select()
    .from(s.financeRecurring)
    .where(inArray(s.financeRecurring.accountId, ids))
    .limit(1000)
    .all();
}
export function storeFinanceRecurring(
  p: FinancePrincipal,
  input: Omit<
    import('@/db/types').FinanceRecurringRecord,
    'id' | 'createdAt' | 'updatedAt' | 'revision'
  >,
) {
  requireFinance(p, [input.accountId], 'write');
  return getDb()
    .insert(s.financeRecurring)
    .values({ id: uuidv7(), ...input })
    .onConflictDoUpdate({
      target: [s.financeRecurring.accountId, s.financeRecurring.key],
      set: input,
    })
    .returning()
    .get();
}
export function removeFinanceRecurring(p: FinancePrincipal, id: string) {
  const row = getDb().select().from(s.financeRecurring).where(eq(s.financeRecurring.id, id)).get();
  if (!row) return;
  requireFinance(p, [row.accountId], 'write');
  getDb().delete(s.financeRecurring).where(eq(s.financeRecurring.id, id)).run();
}
export function queueFinanceSync(p: FinancePrincipal, id: string) {
  requireFinance(p, [id], 'sync');
  const generation = getFinanceSettings()!.generation;
  return getDb()
    .insert(s.financeSync)
    .values({
      id: uuidv7(),
      accountId: id,
      generation,
      state: 'idle',
      rerunRequested:false,
      leaseToken:null,
      nextOn: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: s.financeSync.accountId,
      set: { generation, state:sql`CASE WHEN ${s.financeSync.state} = 'running' THEN 'running' ELSE 'idle' END`,rerunRequested:sql`CASE WHEN ${s.financeSync.state} = 'running' THEN 1 ELSE 0 END`, nextOn: new Date().toISOString() },
    })
    .returning()
    .get();
}
/** Private bootstrap status never includes account IDs, records or job payloads. */
export function financeJobSummary() {
  const jobs = getDb().select({state:s.financeSync.state,nextOn:s.financeSync.nextOn}).from(s.financeSync).orderBy(asc(s.financeSync.nextOn)).limit(101).all();
  const states:Record<string,number> = {};
  for (const job of jobs.slice(0,100)) states[job.state] = (states[job.state] ?? 0) + 1;
  return { states, hasMore: jobs.length > 100, nextRunAt: jobs.find(job => ['idle','retry'].includes(job.state))?.nextOn ?? null };
}
export function claimFinanceJobs(now: string, limit = 5) {
  if (!getFinanceSettings()?.enabled || !getFinanceSettings()?.restoreReviewed)
    return [];
  return getDb().transaction((db) => {
    const jobs = db
      .select()
      .from(s.financeSync)
      .where(
        and(
          inArray(s.financeSync.state, ['idle', 'retry', 'running']),
          sql`${s.financeSync.nextOn} <= ${now}`,
          sql`(${s.financeSync.leaseUntil} IS NULL OR ${s.financeSync.leaseUntil} < ${now})`,
        ),
      )
      .orderBy(asc(s.financeSync.nextOn))
      .limit(limit)
      .all();
    return jobs.map((job) =>
      db
        .update(s.financeSync)
        .set({
          state: 'running',
          leaseToken:uuidv7(),rerunRequested:false,
          leaseUntil: new Date(Date.parse(now) + 10 * 60 * 1000).toISOString(),
        })
        .where(eq(s.financeSync.id, job.id))
        .returning()
        .get(),
    );
  });
}
export function finishFinanceJob(
  jobId: string,
  input: {
    cursor?: string | null;
    failed?: boolean;
    reconnect?: boolean;
    generation: number;
    leaseToken?:string|null;
    catchup?: boolean;
    stop?: boolean;
  },
) {
  const j = getDb()
    .select()
    .from(s.financeSync)
    .where(eq(s.financeSync.id, jobId))
    .get();
  if (
    !j ||
    getFinanceSettings()?.generation !== input.generation ||
    j.generation !== input.generation || (input.leaseToken!==undefined&&j.leaseToken!==input.leaseToken)
  )
    return;
  const attempts = input.failed ? j.attempts + 1 : 0;
  getDb()
    .update(s.financeSync)
    .set({
      state:
        input.reconnect || input.stop
          ? 'disabled'
          : input.failed
            ? 'retry'
            : 'idle',
      leaseUntil: null,
      leaseToken:null,rerunRequested:false,
      attempts,
      cursor: input.cursor === undefined ? j.cursor : input.cursor,
      lastError: input.reconnect
        ? 'Reconnect required'
        : input.failed
          ? 'Sync failed. Retry scheduled.'
          : null,
      nextOn: new Date(
        Date.now() +
          (input.failed
            ? Math.min(24 * 3600000, 60000 * 2 ** Math.min(attempts, 10))
            : input.catchup || j.rerunRequested
              ? 1000
              : 6 * 3600000),
      ).toISOString(),
    })
    .where(eq(s.financeSync.id, j.id))
    .run();
}
export function acceptFinanceWebhook(provider: string, digest: string) {
  return !!getDb()
    .insert(s.financeWebhookReceipts)
    .values({ id: uuidv7(), provider, digest })
    .onConflictDoNothing()
    .returning()
    .get();
}
export function renewFinanceJobLease(jobId:string,leaseToken:string,generation:number){
 if(getFinanceSettings()?.generation!==generation)return false;
 return !!getDb().update(s.financeSync).set({leaseUntil:new Date(Date.now()+10*60*1000).toISOString()}).where(and(eq(s.financeSync.id,jobId),eq(s.financeSync.leaseToken,leaseToken),eq(s.financeSync.state,'running'))).returning().get();
}
export function assertFinanceJobLease(jobId:string,leaseToken:string,generation:number){
 const row=getDb().select().from(s.financeSync).where(eq(s.financeSync.id,jobId)).get();
 if(!row||row.generation!==generation||row.leaseToken!==leaseToken||row.state!=='running')refuse('The sync lease changed',409);
}

export function createFinanceSetupSession(
  p: FinancePrincipal,
  input: {
    connectionId: string;
    environment: 'sandbox' | 'production';
    itemId?: string;
  },
) {
  if (
    !p.owner ||
    !getFinanceSettings()?.enabled ||
    !getFinanceSettings()?.restoreReviewed
  )
    refuse('Finance owner setup required');
  return getDb()
    .insert(s.financeSetupSessions)
    .values({
      id: uuidv7(),
      ...input,
      itemId: input.itemId ?? null,
      expiresAt: new Date(Date.now() + 30 * 60000).toISOString(),
      consumed: false,
    })
    .returning()
    .get();
}
export function getFinanceSetupSession(p: FinancePrincipal, id: string) {
  if (!p.owner) refuse('Only the owner can finish account setup');
  const row = getDb()
    .select()
    .from(s.financeSetupSessions)
    .where(eq(s.financeSetupSessions.id, id))
    .get();
  if (!row || row.consumed || row.expiresAt < new Date().toISOString())
    refuse('Account setup expired or already finished', 409);
  return row;
}
export function consumeFinanceSetupSession(p: FinancePrincipal, id: string) {
  getFinanceSetupSession(p, id);
  getDb()
    .update(s.financeSetupSessions)
    .set({ consumed: true })
    .where(eq(s.financeSetupSessions.id, id))
    .run();
}
export function saveFinanceItem(
  p: FinancePrincipal,
  input: {
    itemId: string;
    connectionId: string;
    environment: 'sandbox' | 'production';
    liabilitiesEnabled: boolean;
  },
) {
  if (!p.owner) refuse('Only the owner can bind bank Items');
  return getDb()
    .insert(s.financeItems)
    .values({ id: uuidv7(), ...input, status: 'active' })
    .onConflictDoUpdate({ target: s.financeItems.itemId, set: input })
    .returning()
    .get();
}
export function getFinanceItem(p: FinancePrincipal, connectionId: string) {
  const accounts = getDb()
    .select()
    .from(s.financeAccounts)
    .where(eq(s.financeAccounts.connectionId, connectionId))
    .all();
  if (!accounts.length) refuse('Bank connection not selected');
  requireFinance(
    p,
    accounts.map((a) => a.id),
    'sync',
  );
  return (
    getDb()
      .select()
      .from(s.financeItems)
      .where(eq(s.financeItems.connectionId, connectionId))
      .get() ?? null
  );
}
export function financeConnectionAccounts(
  p: FinancePrincipal,
  connectionId: string,
) {
  const accounts = getDb()
    .select()
    .from(s.financeAccounts)
    .where(eq(s.financeAccounts.connectionId, connectionId))
    .all()
    .filter((a) => a.access === 'connected');
  if (accounts.length)
    requireFinance(
      p,
      accounts.map((a) => a.id),
    );
  return accounts;
}
export function bindFinanceMailbox(
  p: FinancePrincipal,
  input: {
    accountId: string;
    initialStartOn: string;
    query: string;
    monitoring: boolean;
  },
) {
  requireFinance(p, [input.accountId], 'sync');
  return getDb()
    .insert(s.financeMailboxes)
    .values({ id: uuidv7(), ...input })
    .onConflictDoUpdate({ target: s.financeMailboxes.accountId, set: input })
    .returning()
    .get();
}
export function getFinanceMailbox(p: FinancePrincipal, accountId: string) {
  requireFinance(p, [accountId], 'sync');
  return (
    getDb()
      .select()
      .from(s.financeMailboxes)
      .where(eq(s.financeMailboxes.accountId, accountId))
      .get() ?? null
  );
}
export function financeAttachmentProtected(fileName: string) {
  return (
    !!getDb()
      .select({ id: s.financeFileDeletions.id })
      .from(s.financeFileDeletions)
      .where(eq(s.financeFileDeletions.fileName, fileName))
      .limit(1)
      .get() ||
    !!getDb()
      .select({ id: s.financeAttachmentRefs.id })
      .from(s.financeAttachmentRefs)
      .where(eq(s.financeAttachmentRefs.fileName, fileName))
      .limit(1)
      .get()
  );
}
export function financeEvidenceAttachment(
  p: FinancePrincipal,
  evidenceId: string,
  fileName: string,
) {
  const e = getFinanceEvidence(p, evidenceId);
  const a = e.attachments.find((a) => a.file_name === fileName);
  if (!a) refuse('Evidence attachment not found', 404);
  return a;
}
export function recordFinanceCopy(
  p: FinancePrincipal,
  accountIds: string[],
  destination: string,
  reference: string | null = null,
) {
  requireFinance(p, accountIds);
  return getDb()
    .insert(s.financeCopies)
    .values({
      id: uuidv7(),
      accountIds,
      destination,
      reference,
      status: destination === 'download' ? 'external' : 'created',
    })
    .returning()
    .get();
}
export function listFinanceCopies(p: FinancePrincipal) {
  if (!p.owner) refuse('Only the owner can review shared copies');
  return getDb()
    .select()
    .from(s.financeCopies)
    .orderBy(desc(s.financeCopies.createdAt))
    .limit(500)
    .all();
}

export function retireFinanceItem(p: FinancePrincipal, connectionId: string) {
  if (!p.owner) refuse('Owner required');
  getDb()
    .delete(s.financeItems)
    .where(eq(s.financeItems.connectionId, connectionId))
    .run();
  getDb()
    .delete(s.financeSetupSessions)
    .where(eq(s.financeSetupSessions.connectionId, connectionId))
    .run();
}
export function permittedFinanceEvidenceAccounts(
  p: FinancePrincipal,
  ids: string[],
) {
  requireFinance(p, ids);
  if (p.owner) return ids;
  const grants = getDb()
    .select()
    .from(s.financeGrants)
    .where(
      and(
        eq(s.financeGrants.principal, p.id),
        inArray(s.financeGrants.accountId, ids),
        eq(s.financeGrants.revoked, false),
      ),
    )
    .all();
  return ids.filter((id) =>
    grants.some((g) => g.accountId === id && g.operations.includes('evidence')),
  );
}
export function findFinanceItemBySource(itemId: string) {
  return (
    getDb()
      .select()
      .from(s.financeItems)
      .where(eq(s.financeItems.itemId, itemId))
      .get() ?? null
  );
}
/** A Connector revoked elsewhere cannot leave finance grants or jobs active. */
export function invalidateFinanceConnection(connectionId: string) {
  const accounts = getDb()
    .select()
    .from(s.financeAccounts)
    .where(eq(s.financeAccounts.connectionId, connectionId))
    .all();
  if (!accounts.length) return;
  getDb().transaction((db) => {
    const ids = accounts.map((a) => a.id);
    db.update(s.financeSettings)
      .set({ generation: sql`${s.financeSettings.generation}+1` })
      .run();
    db.update(s.financeAccounts)
      .set({ access: 'retained', connectionId: null, syncStatus: 'reconnect' })
      .where(inArray(s.financeAccounts.id, ids))
      .run();
    db.update(s.financeGrants)
      .set({ revoked: true })
      .where(inArray(s.financeGrants.accountId, ids))
      .run();
    db.update(s.financeSync)
      .set({ state: 'disabled', leaseUntil: null })
      .where(inArray(s.financeSync.accountId, ids))
      .run();
  });
}
export function advanceFinanceSetupSession(
  p: FinancePrincipal,
  id: string,
  connectionId: string,
  itemId: string,
) {
  getFinanceSetupSession(p, id);
  getDb()
    .update(s.financeSetupSessions)
    .set({ connectionId, itemId })
    .where(eq(s.financeSetupSessions.id, id))
    .run();
}
export function setupFinanceItem(p: FinancePrincipal, id: string) {
  if (!p.owner) refuse('Owner required');
  return (
    getDb()
      .select()
      .from(s.financeItems)
      .where(eq(s.financeItems.id, id))
      .get() ?? null
  );
}
export function grantFinanceChatScope(
  p: FinancePrincipal,
  principal: string,
  accountIds: string[],
  operations: FinanceOperation[],
) {
  grantFinance(p, principal, accountIds, operations);
  getDb()
    .update(s.financeGrants)
    .set({ revoked: true })
    .where(
      and(
        eq(s.financeGrants.principal, principal),
        notInArray(s.financeGrants.accountId, accountIds),
      ),
    )
    .run();
}
export function updateManualFinanceAccount(
  p: FinancePrincipal,
  id: string,
  input: {
    balanceMinor: number | null;
    balanceIncludesPending: boolean;
    mask?: string | null;
  },
) {
  if (!p.owner) refuse('Owner required');
  const account = requireFinance(p, [id], 'write')[0];
  if (!['manual', 'synthetic'].includes(account.provider))
    refuse('Provider balances must come from the provider', 400);
  if (input.balanceMinor !== null) exactAmount(input.balanceMinor);
  return getDb()
    .update(s.financeAccounts)
    .set({ ...input, asOf: new Date().toISOString(), syncStatus: 'idle' })
    .where(eq(s.financeAccounts.id, id))
    .returning()
    .get();
}
export function recordManualFinanceTransaction(
  p: FinancePrincipal,
  input: { data: unknown; mutationKey: string },
) {
  const sourceId =
    'manual:' + createHash('sha256').update(input.mutationKey).digest('hex');
  const data = transactionSchema.parse({ ...(input.data as object), sourceId });
  requireFinance(p, [data.accountId], 'write');
  const op = operationHash('record_manual_transaction', input);
  return getDb().transaction((db) => {
    const prior = replay(p, input.mutationKey, op);
    if (prior) return prior.after as FinanceTransactionRecord;
    applyFinanceSync(financeOwner, {
      accountIds: [data.accountId],
      generation: getFinanceSettings()!.generation,
      added: [data],
      removed: [],
      asOf: new Date().toISOString(),
    });
    const row = db
      .select()
      .from(s.financeTransactions)
      .where(
        and(
          eq(s.financeTransactions.accountId, data.accountId),
          eq(s.financeTransactions.sourceId, sourceId),
        ),
      )
      .get()!;
    const account = requireFinance(p, [data.accountId])[0];
    if (account.provider === 'manual' && data.state === 'posted')
      db.update(s.financeAccounts)
        .set({ syncStatus: 'stale' })
        .where(eq(s.financeAccounts.id, account.id))
        .run();
    record(p, input.mutationKey, op, 'transaction', row.id, 0, null, row);
    return row;
  });
}
export function financeGrantCandidates(p:FinancePrincipal){if(!p.owner)refuse('Owner required');return getDb().select({id:s.financeClients.id,label:s.financeClients.label}).from(s.financeClients).where(eq(s.financeClients.revoked,false)).limit(100).all();}
export function financeGrantList(p: FinancePrincipal) {
  if (!p.owner) refuse('Owner required');
  return getDb().select().from(s.financeGrants).limit(1000).all();
}
export function revokeFinancePrincipal(p:FinancePrincipal,principal:string){
  if(!p.owner)refuse('Owner required');
  if(!/^client:[a-zA-Z0-9-]{1,128}$/.test(principal))refuse('Invalid finance principal',400);
  getDb().update(s.financeGrants).set({revoked:true}).where(eq(s.financeGrants.principal,principal)).run();
}

export function runFinanceViewMutation<T>(p:FinancePrincipal,viewId:string,key:string,input:unknown,run:()=>T){
 const view=getFinanceView(p,viewId);requireFinance(p,view.scope.accountIds,'write');
 const op=operationHash('view_callback',input);
 return getDb().transaction(()=>{
  if(replay(p,'widget:'+key,op))return undefined;
  const result=run();record(p,'widget:'+key,op,'view',view.id,view.revision,null,{completed:true});return result;
 });
}

export function queueFinanceWebhook(provider:string,digest:string,connectionId:string){
 return getDb().transaction(()=>{
  if(!acceptFinanceWebhook(provider,digest))return {duplicate:true};
  const settings=getFinanceSettings();if(!settings?.enabled||!settings.restoreReviewed)return {paused:true};
  const accounts=financeConnectionAccounts(financeOwner,connectionId);
  if(accounts.length)queueFinanceSync(financeOwner,accounts[0].id);
  return {queued:accounts.length>0};
 });
}
