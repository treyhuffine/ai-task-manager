import { z } from 'zod/v4';
import { AppError } from '@ri/app-kit/contract';
import { defineAction } from '@ri/app-kit/sdk';
import { accountSource } from '@ri/app-kit/data';
import { listCalendars } from '@ri/app-kit/sources';
import { classifyMessage } from '../domain/classify.js';
import { CLASSIFICATIONS, CLASSIFICATION_LABELS } from '../domain/model.js';
import { app } from '../server/state.js';
import { deleteSourceData, listSources, sourceSetup } from '../server/sources.js';
import { ensureJobs, MAIL_QUERY, runStep } from '../server/sync.js';
import { shareableSources } from '../server/view.js';
import { EX, exampleStep, stepSummarySchema } from './common.js';

const sourceSummarySchema = z.object({
  key: z.string(), account: z.string().nullable(), kind: z.enum(['mail', 'calendar', 'collection']), label: z.string(),
  granted: z.boolean(), automatic: z.boolean(), paused: z.boolean(), status: z.string(), historyDays: z.number().int().nullable(), calendars: z.array(z.string()),
  coverage: z.object({ from: z.string().nullable(), to: z.string().nullable(), partial: z.boolean() }).strict(),
  lastSuccessAt: z.string().nullable(), pending: z.number().int(), failed: z.number().int(), lastError: z.string().nullable(), records: z.number().int(),
}).strict();
const exampleSource = {
  key: 'account:conn-mail-1', account: 'conn-mail-1', kind: 'mail' as const, label: 'you@example.test', granted: true, automatic: true, paused: false, status: 'importing', historyDays: 90, calendars: [],
  coverage: { from: '2026-09-02T12:00:00.000Z', to: '2026-10-15T12:00:00.000Z', partial: true }, lastSuccessAt: '2026-10-15T12:00:00.000Z', pending: 1, failed: 0, lastError: null, records: 24,
};

function ownerOnly(principal: { kind: string }) {
  if (principal.kind !== 'owner-ui' && principal.kind !== 'fixture') throw new AppError('forbidden', 'Only the person who owns this app can manage its sources');
}

export const listSourcesAction = defineAction({
  name: 'list_sources',
  description: 'List this app\'s sources: the two collections the person owns and each connected account, showing whether it is granted to this app, updated automatically, paused, its history range, coverage, last success, pending and failed steps and a redacted last error.',
  input: z.object({}).strict(),
  output: z.object({ sources: z.array(sourceSummarySchema) }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app',
  examples: [{ input: {}, output: { sources: [exampleSource] } }],
  handler: (_input, invocation) => {
    ownerOnly(invocation.principal);
    return { sources: listSources(invocation.access) };
  },
});

export const setSourceAction = defineAction({
  name: 'set_source',
  description: 'Change one account\'s setup: history range (30, 90 or 365 days), the calendars to read for interviews, or pause and resume updates.',
  input: z.object({ account: z.string().min(1).max(128), kind: z.enum(['mail', 'calendar']), historyDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(), calendars: z.array(z.string().min(1).max(1024)).max(10).optional(), paused: z.boolean().optional() }).strict(),
  output: z.object({ source: sourceSummarySchema }).strict(),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app',
  examples: [{ input: { account: 'conn-mail-1', kind: 'mail', historyDays: 90 }, output: { source: exampleSource } }],
  handler: (input, invocation) => {
    ownerOnly(invocation.principal);
    return app().store.mutate(invocation, 'set_source', input, () => ({ source: sourceSetup(invocation.access, input) }));
  },
});

export const listSourceCalendarsAction = defineAction({
  name: 'list_source_calendars',
  description: 'List the calendars of one granted Google Calendar account so the person can choose which ones to read for interviews.',
  input: z.object({ account: z.string().min(1).max(128) }).strict(),
  output: z.object({ calendars: z.array(z.object({ id: z.string(), summary: z.string(), primary: z.boolean(), accessRole: z.string().nullable() }).strict()) }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app', errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: { account: 'conn-cal-1' }, output: { calendars: [{ id: 'primary', summary: 'you@example.test', primary: true, accessRole: 'owner' }] } }],
  handler: async (input, invocation) => {
    ownerOnly(invocation.principal);
    if (!invocation.access?.accounts.some((item) => item.account === input.account && item.binding === 'calendar')) throw new AppError('forbidden', 'Give this app access to the calendar in Ri first');
    return { calendars: await listCalendars(invocation, input.account, 'calendar') };
  },
});

export const previewSourceAction = defineAction({
  name: 'preview_source',
  description: 'Show up to ten recent application, recruiter, interview and offer emails from one granted mailbox, by subject and sender only, so the person can see what the app would import. Nothing is stored.',
  input: z.object({ account: z.string().min(1).max(128), historyDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).default(90) }).strict(),
  output: z.object({ matches: z.array(z.object({ subject: z.string(), from: z.string().nullable(), date: z.string().nullable(), label: z.string() }).strict()), query: z.string() }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app', errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: { account: 'conn-mail-1', historyDays: 90 }, output: { matches: [{ subject: 'Thank you for applying to Lumen', from: 'Lumen Recruiting', date: '2026-10-12', label: 'Application received' }], query: 'Application, recruiter, interview and offer mail from the last 90 days, received and sent' } }],
  handler: async (input, invocation) => {
    ownerOnly(invocation.principal);
    if (!invocation.access?.accounts.some((item) => item.account === input.account && item.binding === 'mail')) throw new AppError('forbidden', 'Give this app access to the mailbox in Ri first');
    const target = { binding: 'mail', account: input.account };
    const after = Math.floor((Date.now() - input.historyDays * 864e5) / 1000);
    const search = z.object({ messages: z.array(z.object({ id: z.string() }).passthrough()).max(500) }).passthrough().parse(await invocation.capability('gmail.search_messages', { query: `(${MAIL_QUERY}) after:${after}`, maxResults: 10 }, target));
    const matches = [];
    for (const message of search.messages.slice(0, 10)) {
      const meta = z.object({ snippet: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), internalDate: z.string().optional() }).passthrough().parse(await invocation.capability('gmail.get_message', { messageId: message.id, format: 'metadata' }, target));
      const subject = meta.headers?.Subject ?? '(no subject)';
      const classified = classifyMessage({ subject, text: meta.snippet ?? '', sent: false });
      const stamp = Date.parse(meta.headers?.Date ?? '') || (meta.internalDate ? Number(meta.internalDate) : NaN);
      const date = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toISOString().slice(0, 10) : null;
      matches.push({ subject: subject.slice(0, 200), from: (meta.headers?.From ?? '').replace(/<[^>]*>/, '').trim().slice(0, 120) || null, date, label: CLASSIFICATION_LABELS[CLASSIFICATIONS.includes(classified.classification) ? classified.classification : 'other'] });
    }
    return { matches, query: `Application, recruiter, interview and offer mail from the last ${input.historyDays} days, received and sent` };
  },
});

export const continueImportAction = defineAction({
  name: 'continue_import',
  description: 'Run one bounded import step for one account now, the same step the schedule runs: one provider page and at most ten new messages, or one small enrichment batch.',
  input: z.object({ source: z.string().regex(/^account:.{1,128}$/) }).strict(),
  output: stepSummarySchema,
  audience: ['user'], effect: 'app_write', retry: 'idempotent', timeoutMs: 40_000, visibility: 'app', errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: { source: 'account:conn-mail-1' }, output: exampleStep }],
  handler: async (input, invocation) => {
    ownerOnly(invocation.principal);
    const account = input.source.slice('account:'.length);
    if (!invocation.access?.accounts.some((item) => item.account === account)) throw new AppError('forbidden', 'This account is not connected to the app. Manage access in Ri');
    const setups = ['mail', 'calendar'].map((kind) => app().accounts.get(account, kind as 'mail' | 'calendar')).filter(Boolean);
    if (setups.length && setups.every((setup) => setup!.paused)) throw new AppError('invalid_input', 'Updates are paused for this account. Resume them first');
    ensureJobs(invocation.access, { onlyAutomatic: false, account });
    // A person's Continue retries a step that failed earlier.
    for (const job of app().jobs.list(input.source)) if (job.sourceKey === input.source && job.state === 'failed') app().jobs.resume(input.source);
    // Importing comes first. A closer AI reading runs only when nothing is left to import.
    const synced = await runStep(invocation, { sources: new Set([input.source]), wake: true, kinds: ['sync_mail', 'sync_calendar'] });
    return synced.ran ? synced : runStep(invocation, { sources: new Set([input.source]), kinds: ['enrich_mail'] });
  },
});

export const deleteSourceDataAction = defineAction({
  name: 'delete_source_data',
  description: 'Delete everything imported from one account: messages, cached bodies, interviews from its calendar, stage changes it caused and its review items. Opportunities, notes, preparation and materials the person wrote are kept. Disconnecting the account is done in Ri.',
  input: z.object({ source: z.string().regex(/^account:.{1,128}$/), confirm: z.literal('delete') }).strict(),
  output: z.object({ removedMessages: z.number().int(), removedInterviews: z.number().int(), restoredStages: z.number().int() }).strict(),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app',
  examples: [{ input: { source: 'account:conn-mail-1', confirm: 'delete' }, output: { removedMessages: 24, removedInterviews: 1, restoredStages: 2 } }],
  handler: (input, invocation) => {
    ownerOnly(invocation.principal);
    return app().store.mutate(invocation, 'delete_source_data', input, () => deleteSourceData(input.source));
  },
});

function jobSources(invocation: Parameters<typeof runStep>[0], source?: string) {
  const scope = app().scopes.resolve(invocation, 'write');
  if (scope.kind === 'owner') throw new AppError('forbidden', 'Background steps run under the app\'s schedule');
  const sources = new Set([...scope.sources].filter((key) => !source || key === source));
  ensureJobs(invocation.access, { onlyAutomatic: true });
  return sources;
}

export const runBackgroundStepAction = defineAction({
  name: 'run_background_step',
  description: 'The schedule\'s entry point: recover interrupted steps, then run one bounded sync or enrichment step for one of the automatically updated accounts, rotating fairly between accounts and kinds of work.',
  input: z.object({}).strict(),
  output: stepSummarySchema,
  audience: ['schedule'], effect: 'app_write', retry: 'idempotent', timeoutMs: 40_000, errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: {}, output: exampleStep }],
  handler: (_input, invocation) => runStep(invocation, { sources: jobSources(invocation) }),
});

export const syncStepAction = defineAction({
  name: 'sync_step',
  description: 'Run one bounded mail or calendar sync step for an automatically updated account: one provider page and at most ten new message bodies, committed with its checkpoint.',
  input: z.object({ source: z.string().regex(/^account:.{1,128}$/).optional() }).strict(),
  output: stepSummarySchema,
  audience: ['schedule'], effect: 'app_write', retry: 'idempotent', timeoutMs: 40_000, errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: { source: 'account:conn-mail-1' }, output: exampleStep }],
  handler: (input, invocation) => runStep(invocation, { sources: jobSources(invocation, input.source), kinds: ['sync_mail', 'sync_calendar'] }),
});

export const enrichStepAction = defineAction({
  name: 'enrich_step',
  description: 'Run one bounded AI enrichment batch: read up to three job emails the rules could not classify. AI readings only ever produce suggestions, never stage changes.',
  input: z.object({ source: z.string().regex(/^account:.{1,128}$/).optional() }).strict(),
  output: stepSummarySchema,
  audience: ['schedule'], effect: 'app_write', retry: 'idempotent', timeoutMs: 40_000, errors: ['forbidden', 'revoked', 'busy', 'timeout'],
  examples: [{ input: {}, output: { ...exampleStep, ran: 'enrich_mail', read: 2, skipped: 0, more: false, message: '2 emails read more closely' } }],
  handler: (input, invocation) => runStep(invocation, { sources: jobSources(invocation, input.source), kinds: ['enrich_mail'] }),
});

const scopeRecordSchema = z.object({ id: z.string(), actorId: z.string(), label: z.string(), sources: z.array(z.string()), operations: z.array(z.enum(['read', 'write'])), revokedAt: z.string().nullable(), createdAt: z.string() }).strict();

export const createScopeAction = defineAction({
  name: 'create_scope',
  description: 'Create the record access one chat or agent may use in this app: chosen collections and accounts, read or read and write. Ri saves it only when the person confirms the grant.',
  input: z.object({ actorId: z.string().min(1).max(200), sources: z.array(z.string().min(1).max(200)).min(1).max(50), operations: z.array(z.enum(['read', 'write'])).min(1).max(2), label: z.string().max(200).optional() }).strict(),
  output: z.object({ scopeRef: z.string(), label: z.string(), sources: z.array(z.string()), operations: z.array(z.enum(['read', 'write'])) }).strict(),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app',
  examples: [{ input: { actorId: 'chat:0192f0aa-0000-7000-8000-00000000c4a7', sources: ['manual', 'account:conn-mail-1'], operations: ['read'] }, output: { scopeRef: EX.scope, label: 'Saved jobs, interviews and preparation, you@example.test', sources: ['account:conn-mail-1', 'manual'], operations: ['read'] } }],
  handler: (input, invocation) => {
    if (invocation.principal.kind !== 'owner-ui') throw new AppError('forbidden', 'Only the person who owns this app can choose what a chat may use');
    const shareable = shareableSources(invocation.access);
    const unknown = input.sources.filter((source) => !shareable.some((item) => item.key === source));
    if (unknown.length) throw new AppError('invalid_input', 'Choose sources from this app\'s list');
    const label = input.label?.trim() || shareable.filter((item) => input.sources.includes(item.key)).map((item) => item.label).join(', ');
    return app().store.mutate(invocation, 'create_scope', input, () => {
      const scope = app().scopes.create({ actorId: input.actorId, label, sources: input.sources, operations: input.operations });
      return { scopeRef: scope.id, label: scope.label, sources: scope.sources, operations: scope.operations };
    });
  },
});

export const listScopesAction = defineAction({
  name: 'list_scopes',
  description: 'List the record access created for chats and agents, including revoked ones.',
  input: z.object({}).strict(),
  output: z.object({ scopes: z.array(scopeRecordSchema) }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app',
  examples: [{ input: {}, output: { scopes: [{ id: EX.scope, actorId: 'chat:0192f0aa-0000-7000-8000-00000000c4a7', label: 'Saved jobs, interviews and preparation', sources: ['manual'], operations: ['read'], revokedAt: null, createdAt: '2026-10-15T09:00:00.000Z' }] } }],
  handler: (_input, invocation) => {
    ownerOnly(invocation.principal);
    return { scopes: app().scopes.list().map((scope) => ({ id: scope.id, actorId: scope.actorId, label: scope.label, sources: scope.sources, operations: scope.operations, revokedAt: scope.revokedAt, createdAt: scope.createdAt })) };
  },
});

export const revokeScopeAction = defineAction({
  name: 'revoke_scope',
  description: 'Revoke one chat or agent\'s record access. Later calls from it are refused.',
  input: z.object({ scopeRef: z.string().min(1).max(512) }).strict(),
  output: z.object({ scopeRef: z.string(), revokedAt: z.string() }).strict(),
  audience: ['user'], effect: 'app_write', retry: 'idempotent', visibility: 'app', errors: ['not_found', 'forbidden'],
  examples: [{ input: { scopeRef: EX.scope }, output: { scopeRef: EX.scope, revokedAt: '2026-10-15T09:30:00.000Z' } }],
  handler: (input, invocation) => {
    ownerOnly(invocation.principal);
    const { scopes } = app();
    if (!scopes.get(input.scopeRef)) throw new AppError('not_found', 'This access record is not available');
    scopes.revoke(input.scopeRef);
    return { scopeRef: input.scopeRef, revokedAt: scopes.get(input.scopeRef)!.revokedAt! };
  },
});

export const sourceActions = [listSourcesAction, setSourceAction, listSourceCalendarsAction, previewSourceAction, continueImportAction, deleteSourceDataAction, runBackgroundStepAction, syncStepAction, enrichStepAction, createScopeAction, listScopesAction, revokeScopeAction];
export { accountSource };
