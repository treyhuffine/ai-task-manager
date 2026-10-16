import { AppError } from '@ri/app-kit/contract';
import { accountSource, redact, type AccessScope, type JobRecord } from '@ri/app-kit/data';
import type { AppInvocation } from '@ri/app-kit/sdk';
import {
  calendarSyncStep, gmailSyncStep, newCalendarCheckpoint, type CalendarCheckpoint, type MailCheckpoint, type MailHeaders,
} from '@ri/app-kit/sources';
import { z } from 'zod/v4';
import { iso, type Ctx } from './context.js';
import { extractionSetting } from './coverage.js';
import { applyRulesToInteraction, linkRuleBatch } from './attribution.js';
import { generateOneBriefing, hasRunnableBriefing, scheduleUpcomingBriefings } from './briefings.js';
import { isBlocked, senderDecision } from './exclusions.js';
import { enqueueExtraction, extractOne, ownerAddresses, rememberOwnerAddress } from './extraction.js';
import { ingestEvent, ingestMail, markUnavailable } from './interactions.js';
import { refreshOrganization } from './organizations.js';
import { refreshPerson } from './people.js';
import { touch } from './scope.js';

/** Policy values for sources live here, not in SQL defaults. */
export const DEFAULT_HISTORY_DAYS = 90;
export const HISTORY_CHOICES = [30, 90, 365] as const;
export const CALENDAR_FUTURE_DAYS = 120;
export const STEP_BUDGET_MS = 20_000;
export const IDLE_MS = 4 * 60_000;
export const MAIL_QUERY = 'in:sent OR (to:me -category:promotions -category:social -category:forums)';
const BULK_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'SPAM', 'TRASH', 'DRAFT']);

export type JobKind = 'mail' | 'calendar' | 'enrich' | 'briefing' | 'attribute';
type Access = NonNullable<AppInvocation['access']>;

/** Remember setup for a granted account the first time it is seen. Choices are the owner's. */
export function ensureAccountSetup(ctx: Ctx, account: string, kind: 'mail' | 'calendar') {
  return ctx.accounts.get(account, kind) ?? ctx.accounts.setup({ account, kind, historyDays: DEFAULT_HISTORY_DAYS, calendars: kind === 'calendar' ? ['primary'] : [] });
}

function kindFor(binding: string): 'mail' | 'calendar' | null {
  return binding === 'mail' ? 'mail' : binding === 'calendar' ? 'calendar' : null;
}

/** Ensure one job per automatic account and kind, plus enrichment, briefing and linking jobs with pending work. */
export function ensureJobs(ctx: Ctx, accounts: Access['accounts'], options: { automaticOnly: boolean }) {
  for (const grant of accounts) {
    const kind = kindFor(grant.binding);
    if (!kind || (options.automaticOnly && !grant.automatic)) continue;
    const setup = ensureAccountSetup(ctx, grant.account, kind);
    const source = accountSource(grant.account);
    const job = ctx.jobs.ensure(kind, source, { idempotent: true });
    if (setup.paused && job.state !== 'paused') ctx.jobs.pause(source);
  }
  for (const row of ctx.db.all<{ kind: string; source_key: string }>("SELECT DISTINCT kind, source_key FROM work_items WHERE state = 'pending' AND kind IN ('extract','attribute','briefing') LIMIT 100")) {
    const kind = row.kind === 'extract' ? 'enrich' : row.kind;
    if (kind !== 'attribute' && extractionSetting(ctx).status !== 'on') continue;
    const job = ctx.jobs.ensure(kind, row.source_key, { idempotent: true });
    if (job.state === 'pending' && job.nextEligibleAt > iso(ctx)) ctx.jobs.wake(job.id);
  }
}

export interface StepSummary { ran: { kind: string; source: string } | null; more: boolean; summary: string }

/**
 * One bounded background step. Recovers interrupted jobs, picks the fairest
 * due job among the caller's sources (kinds alternate and the source that ran
 * longest ago goes first), runs exactly one unit and records the outcome.
 */
export async function backgroundStep(ctx: Ctx, invocation: AppInvocation, options: { scope: AccessScope; sources: ReadonlySet<string>; accounts: Access['accounts']; automaticOnly: boolean; kinds?: JobKind[]; only?: string }): Promise<StepSummary> {
  ctx.jobs.recover();
  ensureJobs(ctx, options.accounts, { automaticOnly: options.automaticOnly });
  // Briefings share one queue. A runner reaches it only when an item inside its own scope is waiting.
  const allowed = new Set([...options.sources, ...(hasRunnableBriefing(ctx, options.scope) ? ['briefings'] : [])]);
  if (options.only) { const job = ctx.jobs.list().find((item) => item.sourceKey === options.only && item.state === 'pending'); if (job) ctx.jobs.wake(job.id); }
  const job = options.only
    ? ctx.jobs.list().filter((item) => item.sourceKey === options.only && item.state === 'pending' && (!options.kinds || options.kinds.includes(item.kind as JobKind))).sort((a, b) => (a.lastRunAt ?? '').localeCompare(b.lastRunAt ?? ''))[0] ?? null
    : ctx.jobs.next(iso(ctx), { sources: allowed, kinds: options.kinds });
  if (!job) return { ran: null, more: false, summary: 'Nothing is due' };
  ctx.jobs.claim(job.id);
  try {
    const outcome = await runJob(ctx, invocation, job, options.accounts, options.scope);
    ctx.jobs.finish(job.id, { more: outcome.more, idleMs: IDLE_MS, now: ctx.now() });
    return { ran: { kind: job.kind, source: job.sourceKey }, more: outcome.more, summary: outcome.summary };
  } catch (error) {
    const code = (error as AppError)?.code;
    const account = job.sourceKey.startsWith('account:') ? job.sourceKey.slice(8) : null;
    if (account && (job.kind === 'mail' || job.kind === 'calendar')) {
      ctx.db.tx(() => {
        ctx.accounts.failed(account, job.kind as 'mail' | 'calendar', code === 'revoked' || code === 'forbidden' ? 'reconnect' : 'error', code === 'revoked' ? 'Reconnect this account in Ri to resume updates' : code === 'forbidden' ? 'Ri no longer allows People to read this account' : redact(error));
        touch(ctx, job.sourceKey);
      });
    }
    ctx.jobs.fail(job.id, error, { retryable: code !== 'revoked' && code !== 'forbidden', now: ctx.now() });
    return { ran: { kind: job.kind, source: job.sourceKey }, more: false, summary: code === 'revoked' ? 'Reconnect needed' : 'The step failed and will retry later' };
  }
}

async function runJob(ctx: Ctx, invocation: AppInvocation, job: JobRecord, accounts: Access['accounts'], scope: AccessScope): Promise<{ more: boolean; summary: string }> {
  const deadline = Math.min(Date.now() + STEP_BUDGET_MS, invocation.deadline - 5_000);
  switch (job.kind) {
    case 'mail': return mailStep(ctx, invocation, job.sourceKey.slice(8), accounts, deadline, scope);
    case 'calendar': return calendarStep(ctx, invocation, job.sourceKey.slice(8), accounts, scope);
    case 'enrich': return extractOne(ctx, invocation, new Set([job.sourceKey]), scope);
    case 'briefing': return generateOneBriefing(ctx, invocation, scope);
    case 'attribute': {
      const item = ctx.db.get<{ id: string; payload: string }>("SELECT id, payload FROM work_items WHERE kind = 'attribute' AND state = 'pending' AND source_key = ? ORDER BY priority LIMIT 1", job.sourceKey);
      if (!item) return { more: false, summary: 'No company links waiting' };
      const { ruleId } = JSON.parse(item.payload) as { ruleId: string };
      return ctx.db.tx(() => {
        const result = linkRuleBatch(ctx, ruleId);
        if (!result.more) ctx.db.run("UPDATE work_items SET state = 'done', updated_at = ? WHERE id = ?", iso(ctx), item.id);
        return { more: result.more, summary: `Linked ${result.linked} conversation${result.linked === 1 ? '' : 's'} to a company` };
      });
    }
    default: return { more: false, summary: 'Unknown step' };
  }
}

function binding(accounts: Access['accounts'], account: string, kind: 'mail' | 'calendar') {
  const grant = accounts.find((item) => item.account === account && kindFor(item.binding) === kind);
  if (!grant) throw new AppError('forbidden', 'This account is no longer granted to People');
  return grant.binding;
}

/** Commit records and the checkpoint in one transaction, so an interrupted step resumes from the last committed page. */
async function inTransaction<T>(ctx: Ctx, work: () => Promise<T>): Promise<T> {
  ctx.db.exec('BEGIN IMMEDIATE');
  try {
    const result = await work();
    ctx.db.exec('COMMIT');
    return result;
  } catch (error) {
    if (ctx.db.isTransaction) ctx.db.exec('ROLLBACK');
    throw error;
  }
}

async function mailStep(ctx: Ctx, invocation: AppInvocation, account: string, accounts: Access['accounts'], deadline: number, scope: AccessScope) {
  const setup = ensureAccountSetup(ctx, account, 'mail');
  const source = accountSource(account);
  const persons = new Set<string>(), organizations = new Set<string>();
  let extracted = 0;
  return inTransaction(ctx, async () => {
    const owner = new Set(ownerAddresses(ctx));
    const checkpoint = setup.checkpoint as MailCheckpoint | null;
    if (checkpoint?.emailAddress) owner.add(checkpoint.emailAddress.toLowerCase());
    const result = await gmailSyncStep({
      invocation, account, binding: binding(accounts, account, 'mail'), checkpoint, windowDays: setup.historyDays, query: MAIL_QUERY, deadline,
      now: () => ctx.now(),
      seen: (id) => ctx.mailIndex.seen(account, id),
      relevant: (headers: MailHeaders) => {
        if (headers.labelIds.some((label) => BULK_LABELS.has(label))) return false;
        if (headers.labelIds.includes('SENT')) return true;
        return !(headers.from && isBlocked(senderDecision(ctx, headers.from.normalized)));
      },
      ingest: (message) => {
        if (message.sent && message.from) { rememberOwnerAddress(ctx, message.from.address); owner.add(message.from.normalized.toLowerCase()); }
        const outcome = ingestMail(ctx, source, message, owner);
        for (const person of outcome.persons) persons.add(person);
        if (outcome.interactionId && outcome.outcome === 'kept') {
          for (const org of applyRulesToInteraction(ctx, outcome.interactionId)) organizations.add(org);
          if (outcome.extract && enqueueExtraction(ctx, outcome.interactionId, source, message.digest, message.receivedAt)) extracted++;
        }
        ctx.mailIndex.record(account, message.id, message.threadId, outcome.outcome, { receivedAt: message.receivedAt, digest: message.digest });
      },
      skip: (id, threadId) => ctx.mailIndex.record(account, id, threadId, 'skipped'),
      removed: (id) => {
        for (const person of markUnavailable(ctx, source, id)) persons.add(person);
        ctx.mailIndex.record(account, id, id, 'removed');
      },
    });
    if (result.checkpoint.emailAddress) rememberOwnerAddress(ctx, result.checkpoint.emailAddress);
    ctx.accounts.commit(account, 'mail', result.checkpoint, result.checkpoint.backfill.complete ? 'ready' : 'importing', result.checkpoint.emailAddress);
    for (const person of persons) refreshPerson(ctx, person);
    for (const org of organizations) refreshOrganization(ctx, org);
    scheduleUpcomingBriefings(ctx, scope);
    touch(ctx, source);
    const parts = [result.lane === 'profile' ? 'Found the mailbox position' : `Read ${result.read} message${result.read === 1 ? '' : 's'}`, result.skipped ? `left out ${result.skipped}` : '', result.removed ? `${result.removed} no longer available` : '', extracted ? `${extracted} queued for extraction` : ''].filter(Boolean);
    return { more: result.more, summary: parts.join(', ') };
  });
}

const calendarMapSchema = z.record(z.string(), z.unknown());
async function calendarStep(ctx: Ctx, invocation: AppInvocation, account: string, accounts: Access['accounts'], scope: AccessScope) {
  const setup = ensureAccountSetup(ctx, account, 'calendar');
  const source = accountSource(account);
  const map: Record<string, CalendarCheckpoint> = calendarMapSchema.safeParse(setup.checkpoint).success && setup.checkpoint ? { ...(setup.checkpoint as Record<string, CalendarCheckpoint>) } : {};
  const calendars = setup.calendars.length ? setup.calendars : ['primary'];
  for (const id of Object.keys(map)) if (!calendars.includes(id)) delete map[id];
  // Rotate: an unfinished calendar first, then the one updated longest ago.
  const calendarId = [...calendars].sort((a, b) => {
    const left = map[a], right = map[b];
    const rank = (checkpoint?: CalendarCheckpoint) => (!checkpoint ? 0 : checkpoint.pageToken || !checkpoint.completedAt ? 1 : 2);
    return rank(left) - rank(right) || (left?.lastSuccessAt ?? '').localeCompare(right?.lastSuccessAt ?? '');
  })[0];
  const persons = new Set<string>();
  return inTransaction(ctx, async () => {
    const checkpoint = map[calendarId] ?? newCalendarCheckpoint(calendarId, setup.historyDays, CALENDAR_FUTURE_DAYS, ctx.now());
    const result = await calendarSyncStep({
      invocation, account, binding: binding(accounts, account, 'calendar'), checkpoint, now: () => ctx.now(),
      ingest: (event) => { for (const person of ingestEvent(ctx, source, calendarId, event, checkpoint.timeZone).persons) persons.add(person); },
    });
    map[calendarId] = result.checkpoint;
    const complete = calendars.every((id) => map[id]?.completedAt && !map[id]?.pageToken);
    ctx.accounts.commit(account, 'calendar', map, complete ? 'ready' : 'importing');
    for (const person of persons) refreshPerson(ctx, person);
    scheduleUpcomingBriefings(ctx, scope);
    touch(ctx, source);
    return { more: result.more || !complete, summary: `Checked ${result.events} calendar event${result.events === 1 ? '' : 's'}${result.cancelled ? `, ${result.cancelled} canceled` : ''}` };
  });
}
