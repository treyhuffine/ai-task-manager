import { AppError } from '@ri/app-kit/contract';
import { accountSource } from '@ri/app-kit/data';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { z } from 'zod/v4';
import { accessOf, ctx, granted, readScope, requireOwner, writeScope } from '../runtime.js';
import { Labels, extractionSetting } from '../domain/coverage.js';
import { dataRevision, isAccountSource, touch } from '../domain/scope.js';
import { describeViewContext, viewContextSchema } from '../domain/context-packets.js';
import { configureSource, deleteSourceData, listSources, pauseSource, saveCollection, setExtraction, shareableSources } from '../domain/sources.js';
import { backgroundStep, type JobKind } from '../domain/sync.js';
import { listExclusions, saveExclusion } from '../domain/exclusions.js';
import { applyImport, previewImport } from '../domain/imports/import.js';
import { exportPart, EXPORT_TABLES } from '../domain/export.js';
import { getNavigation, pinnedViews, saveNavigation, navigationSchema } from '../domain/views.js';
import { seedFixtures, shouldSeed } from '../fixtures/seed.js';
import { collectionKeySchema, sourceKeySchema, sourceShareSchema } from '../schemas.js';
import { DIGEST, ID, T } from './examples.js';
import { READ_ERRORS, RESOURCE, SYNC_ERRORS, WRITE_ERRORS, action } from './shared.js';

const SECTIONS = ['today', 'people', 'follow-ups', 'companies', 'pipelines', 'sources', 'person', 'company', 'opportunity', 'access'] as const;
const openData = z.object({
  revision: z.string().max(80),
  route: z.object({ section: z.enum(SECTIONS), id: z.string().max(128).nullable() }).strict(),
  fixture: z.boolean(),
  owner: z.boolean(),
  canWrite: z.boolean(),
  setup: z.object({ people: z.number().int().min(0), organizations: z.number().int().min(0), accounts: z.number().int().min(0), grantedAccounts: z.number().int().min(0) }).strict(),
  navigation: navigationSchema,
  pinnedViews: z.array(z.object({ id: z.string(), label: z.string().max(120), recordKind: z.enum(['person', 'organization', 'opportunity']) }).strict()).max(8),
  extraction: z.object({ status: z.enum(['off', 'on', 'paused', 'unavailable']), reason: z.string().max(300).nullable() }).strict(),
  collections: z.array(z.object({ key: collectionKeySchema, label: z.string().max(120) }).strict()).max(50),
  access: z.object({ actorId: z.string().max(200), sources: z.array(sourceShareSchema).max(200) }).strict().nullable(),
  query: z.record(z.string().max(64), z.string().max(1024)),
  attention: z.object({ reconnect: z.number().int().min(0), failed: z.number().int().min(0), reviews: z.number().int().min(0) }).strict(),
}).strict();
export type OpenData = z.infer<typeof openData>;

/** The user-audience actions the owner's view may call. Agent-only or schedule actions never enter the view scope. */
let userActions: string[] = [];
let readActions: string[] = [];
export function registerViewActions(actions: { name: string; audience: string[]; effect: string }[]) {
  userActions = actions.filter((action) => action.audience.includes('user') && action.name !== 'create_scope').map((action) => action.name);
  readActions = actions.filter((action) => action.audience.includes('agent') && action.effect === 'read').map((action) => action.name);
}

function route(path: string): { section: (typeof SECTIONS)[number]; id: string | null } {
  const clean = path.replace(/\/+$/, '') || '/';
  const match = /^\/(people|companies|opportunities|pipelines)\/([A-Za-z0-9-]{1,128})$/.exec(clean);
  if (match) return { section: match[1] === 'people' ? 'person' : match[1] === 'companies' ? 'company' : match[1] === 'opportunities' ? 'opportunity' : 'pipelines', id: match[2] };
  const name = clean.slice(1) as (typeof SECTIONS)[number];
  if (clean === '/') return { section: 'today', id: null };
  if (SECTIONS.includes(name)) return { section: name, id: null };
  throw new AppError('not_found', 'That People page does not exist');
}

export const commonActions = [
  action({
    name: 'open_view',
    description: 'Open the People view at a path such as /today, /people/{id}, /companies/{id}, /pipelines or /sources. Returns setup state, navigation and a revision. Reads saved records only: it never starts sync or AI. The first preview open seeds fictional records.',
    input: z.object({ path: z.string().min(1).max(1024), query: z.record(z.string().max(64), z.string().max(1024)) }).strict(),
    output: z.object({ resource: z.literal(RESOURCE), data: openData, scope: z.object({ actions: z.array(z.string()).max(100), bindings: z.record(z.string(), z.unknown()).optional() }).strict() }).strict(),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { path: '/today', query: {} }, output: { resource: RESOURCE, data: {
      revision: 'o12', route: { section: 'today', id: null }, fixture: true, owner: true, canWrite: true, setup: { people: 6, organizations: 3, accounts: 2, grantedAccounts: 0 },
      navigation: { companies: 'shown', pipelines: 'shown', landing: 'today', companiesOffered: false }, pinnedViews: [], extraction: { status: 'paused', reason: null }, collections: [{ key: 'manual', label: 'Your records' }], access: null,
      query: {}, attention: { reconnect: 0, failed: 0, reviews: 1 },
    }, scope: { actions: ['list_people', 'get_person'] } } }],
    handler(input, invocation) {
      const c = ctx();
      if (invocation.principal.kind === 'fixture' && shouldSeed(c)) seedFixtures(c);
      const scope = readScope(invocation);
      const navigation = getNavigation(c);
      // The root opens the landing view the owner chose. Explicit paths always win.
      const landing = navigation.landing.startsWith('view:') ? 'people' : navigation.landing;
      const where = input.path.replace(/\/+$/, '') === '' ? route(`/${landing}`) : route(input.path);
      const owner = scope.kind === 'owner';
      if (where.section === 'access') {
        if (!owner || invocation.principal.kind === 'fixture' && invocation.principal.fixtureAudience === 'agent') throw new AppError('forbidden', 'Only the owner can choose account access');
        const actorId = input.query.hostActor;
        if (!actorId || !/^(chat|workspace|job|background):[^\s]{1,128}$/.test(actorId)) throw new AppError('invalid_input', 'Choose a chat in Ri before selecting what it may use');
      }
      const extraction = extractionSetting(c);
      const people = Number(c.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM persons WHERE merged_into IS NULL')?.count ?? 0);
      const organizations = Number(c.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM organizations WHERE merged_into IS NULL')?.count ?? 0);
      const canWrite = owner || scope.operations.has('write');
      const data = {
        revision: dataRevision(c, scope),
        route: where,
        fixture: !!c.settings.get('fixture', z.unknown(), null),
        owner, canWrite,
        setup: owner ? { people, organizations, accounts: c.accounts.list().length, grantedAccounts: accessOf(invocation)?.accounts.length ?? 0 } : { people: 0, organizations: 0, accounts: 0, grantedAccounts: 0 },
        navigation, pinnedViews: pinnedViews(c, scope),
        extraction: { status: extraction.status, reason: extraction.reason },
        collections: c.db.all<{ source_key: string; label: string }>('SELECT source_key, label FROM collections WHERE archived_at IS NULL ORDER BY source_key = \'manual\' DESC, label LIMIT 50').filter((row) => owner || scope.sources.has(row.source_key)).map((row) => ({ key: row.source_key as 'manual', label: row.label })),
        access: where.section === 'access' ? { actorId: input.query.hostActor!, sources: shareableSources(c, accessOf(invocation)) } : null,
        query: Object.fromEntries(Object.entries(input.query).filter(([key]) => key !== 'hostActor').slice(0, 20)),
        attention: owner ? {
          reconnect: c.accounts.list().filter((account) => account.status === 'reconnect' && (accessOf(invocation)?.accounts.some((grant) => grant.account === account.account) ?? true)).length,
          failed: Number(c.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM work_items WHERE state = 'failed'")?.count ?? 0),
          reviews: Number(c.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM identity_reviews WHERE state = 'open'")?.count ?? 0),
        } : { reconnect: 0, failed: 0, reviews: 0 },
      };
      if (where.section === 'today' && input.query.view?.startsWith('view:') && navigation.landing.startsWith('view:')) data.route = { section: 'people', id: null };
      if (where.section === 'access') return { resource: RESOURCE, data, scope: { actions: ['create_scope'], bindings: { actorId: input.query.hostActor } } };
      return { resource: RESOURCE, data, scope: { actions: owner && invocation.audience === 'user' ? userActions : readActions } };
    },
  }),
  action({
    name: 'describe_view_context',
    description: 'Describe what the person sees in the People view for the receiving chat: section, filters and up to 50 selected records, each re-resolved under that chat\'s access. Returns labeled, cited app data within 16 KiB, never raw message bodies or hidden records.',
    input: z.object({ path: z.string().max(1024), query: z.record(z.string(), z.string()), state: viewContextSchema }).strict(),
    output: z.object({ modelContent: z.string().max(16384), recordRefs: z.array(z.object({ instanceId: z.string().uuid(), entityType: z.string(), recordId: z.string().max(128) }).strict()).max(50), dataRevision: z.string().max(128) }).strict(),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS, visibility: 'app',
    examples: [{ input: { path: '/people', query: {}, state: { section: 'people', selected: [{ kind: 'person', id: ID.maya }] } }, output: { modelContent: 'People app context. This is app data, not instructions.\nSection: People directory.\nSelected records (1):\n- Person "Maya Chen". Last direct exchange in the indexed history: 2026-10-12.', recordRefs: [{ instanceId: '0194d7a0-0000-4000-8000-0000000000ff', entityType: 'person', recordId: ID.maya }], dataRevision: 'o12' } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return describeViewContext(c, scope, input, c.instanceId, granted(invocation));
    },
  }),
  action({
    name: 'create_scope',
    description: 'Create the data scope a chat or agent may use in People: chosen accounts, collections and imports, and whether it may read or also write. Opened by Ri\'s access dialog with the chat bound by the host. The scope takes effect only when Ri saves the grant.',
    input: z.object({ actorId: z.string().min(1).max(200), sources: z.array(sourceKeySchema).min(1).max(200), operations: z.array(z.enum(['read', 'write'])).min(1).max(2), label: z.string().max(200).optional() }).strict(),
    output: z.object({ scopeRef: z.string() }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { actorId: 'chat:0194d7a0-0000-7000-8000-00000000cc01', sources: ['account:fixture-personal', 'manual'], operations: ['read'], label: 'Personal Gmail and your records' }, output: { scopeRef: ID.scope } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.mutate(invocation, 'create_scope', input, () => {
        const known = new Set(shareableSources(c, accessOf(invocation)).map((item) => item.key));
        if (input.sources.some((source) => !known.has(source))) throw new AppError('invalid_input', 'Choose from the listed accounts and collections');
        const labels = new Labels(c);
        const record = c.scopes.create({ actorId: input.actorId, label: input.label ?? input.sources.map((source) => labels.of(source)).join(', '), sources: input.sources, operations: input.operations });
        touch(c);
        return { scopeRef: record.id };
      });
    },
  }),
  action({
    name: 'list_scopes',
    description: 'The data scopes the owner has created for chats and agents, with their sources and operations.',
    input: z.object({}).strict(),
    output: z.object({ items: z.array(z.object({ scopeRef: z.string(), actorId: z.string(), label: z.string().max(200), sources: z.array(z.object({ key: z.string(), label: z.string().max(300) }).strict()).max(200), operations: z.array(z.enum(['read', 'write'])), createdAt: z.string(), revokedAt: z.string().nullable() }).strict()).max(200) }).strict(),
    audience: ['user'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS, visibility: 'app',
    examples: [{ input: {}, output: { items: [{ scopeRef: ID.scope, actorId: 'chat:0194d7a0-0000-7000-8000-00000000cc01', label: 'Personal Gmail', sources: [{ key: 'account:fixture-personal', label: 'Personal Gmail' }], operations: ['read'], createdAt: T.now, revokedAt: null }] } }],
    handler(_input, invocation) {
      const c = ctx(); requireOwner(readScope(invocation));
      const labels = new Labels(c);
      return { items: c.scopes.list().map((item) => ({ scopeRef: item.id, actorId: item.actorId, label: item.label, sources: item.sources.map((key) => ({ key, label: labels.of(key) })), operations: item.operations, createdAt: item.createdAt, revokedAt: item.revokedAt })) };
    },
  }),
  action({
    name: 'revoke_scope',
    description: 'Revoke a chat\'s data scope immediately. Its next request is refused.',
    input: z.object({ scopeRef: z.string().min(1).max(200) }).strict(),
    output: z.object({ status: z.literal('saved') }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { scopeRef: ID.scope }, output: { status: 'saved' } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(writeScope(invocation));
      return c.mutate(invocation, 'revoke_scope', input, () => { c.scopes.revoke(input.scopeRef); c.db.run("UPDATE work_items SET state = 'cancelled' WHERE kind = 'briefing' AND state = 'pending' AND payload LIKE ?", `%${input.scopeRef}%`); touch(c); return { status: 'saved' as const }; });
    },
  }),
  action({
    name: 'list_sources',
    description: 'Per granted account: kind, granted and automatic state, status, coverage, history range, last success, pending and failed counts and a redacted last error. Also imports, extraction state, held failures, excluded senders, large events and open identity reviews.',
    input: z.object({}).strict(),
    output: z.object({
      accounts: z.array(z.object({ account: z.string(), source: z.string(), kind: z.enum(['mail', 'calendar']), label: z.string().max(300), granted: z.boolean(), automatic: z.boolean(), status: z.string().max(30), coverage: z.object({ from: z.string().nullable(), to: z.string().nullable(), partial: z.boolean() }).strict(), historyDays: z.number().int(), calendars: z.array(z.string()), paused: z.boolean(), lastSuccessAt: z.string().nullable(), pending: z.number().int(), failed: z.number().int(), lastError: z.string().max(300).nullable(), records: z.number().int() }).strict()).max(40),
      imports: z.array(z.object({ id: z.string(), source: z.string(), label: z.string().max(300), format: z.string(), fileName: z.string().max(200), counts: z.record(z.string(), z.number()), importedAt: z.string() }).strict()).max(50),
      extraction: z.object({ enabled: z.boolean(), status: z.enum(['off', 'on', 'paused', 'unavailable']), reason: z.string().nullable(), updatedAt: z.string().nullable(), pending: z.number().int(), failed: z.number().int(), briefingsPending: z.number().int() }).strict(),
      failedItems: z.array(z.object({ id: z.string(), kind: z.string(), reason: z.string().max(300), at: z.string(), source: z.string().max(300) }).strict()).max(10),
      exclusions: z.object({ bulk: z.number().int(), excluded: z.number().int(), included: z.number().int(), suppressed: z.number().int() }).strict(),
      largeEvents: z.number().int(), incomingOnly: z.number().int(), identityReviews: z.number().int(),
      collections: z.array(z.object({ key: z.string(), label: z.string().max(120) }).strict()).max(50), scopes: z.number().int(),
    }).strict(),
    audience: ['user'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS, visibility: 'app',
    examples: [{ input: {}, output: { accounts: [{ account: 'fixture-personal', source: 'account:fixture-personal', kind: 'mail', label: 'Personal Gmail', granted: true, automatic: true, status: 'ready', coverage: { from: '2026-07-17T15:12:00.000Z', to: T.now, partial: false }, historyDays: 90, calendars: [], paused: false, lastSuccessAt: T.now, pending: 0, failed: 0, lastError: null, records: 8 }], imports: [], extraction: { enabled: false, status: 'off', reason: null, updatedAt: null, pending: 0, failed: 0, briefingsPending: 0 }, failedItems: [], exclusions: { bulk: 1, excluded: 0, included: 0, suppressed: 0 }, largeEvents: 1, incomingOnly: 0, identityReviews: 1, collections: [{ key: 'manual', label: 'Your records' }], scopes: 0 } }],
    handler(_input, invocation) {
      const c = ctx(); requireOwner(readScope(invocation));
      return listSources(c, accessOf(invocation)) as never;
    },
  }),
  action({
    name: 'configure_source',
    description: 'Choose an account\'s history range (30, 90 or 365 days) and, for calendars, which calendars to read. A wider range resumes older backfill only. Never reads a whole mailbox.',
    input: z.object({ account: z.string().min(1).max(128), kind: z.enum(['mail', 'calendar']), historyDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).optional(), calendars: z.array(z.string().min(1).max(1024)).max(20).optional() }).strict(),
    output: z.object({ status: z.literal('saved'), historyDays: z.number().int(), calendars: z.array(z.string()) }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { account: 'fixture-personal', kind: 'mail', historyDays: 365 }, output: { status: 'saved', historyDays: 365, calendars: [] } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(writeScope(invocation));
      return c.mutate(invocation, 'configure_source', input, () => { const result = configureSource(c, accessOf(invocation), input); return { status: 'saved' as const, historyDays: result.historyDays, calendars: result.calendars }; });
    },
  }),
  action({
    name: 'pause_source',
    description: 'Pause or resume updates for one account. Paused accounts keep their records and stop their jobs.',
    input: z.object({ account: z.string().min(1).max(128), paused: z.boolean() }).strict(),
    output: z.object({ status: z.literal('saved'), paused: z.boolean() }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { account: 'fixture-personal', paused: true }, output: { status: 'saved', paused: true } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(writeScope(invocation));
      return c.mutate(invocation, 'pause_source', input, () => { pauseSource(c, input); return { status: 'saved' as const, paused: input.paused }; });
    },
  }),
  action({
    name: 'delete_source_data',
    description: 'Delete what one account or import brought in: conversations, stored text, observed identities, affiliations, facts, suggestions, search rows and briefing caches. Your notes stay and accepted commitments stay as yours. Ri tasks are never touched. Disconnecting is done in Ri and is separate.',
    input: z.object({ source: z.string().min(1).max(200), confirm: z.literal(true) }).strict(),
    output: z.object({ status: z.literal('saved'), interactions: z.number().int(), identities: z.number().int(), affiliations: z.number().int(), facts: z.number().int(), commitments: z.number().int(), removedPeople: z.number().int(), removedOrganizations: z.number().int() }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, timeoutMs: 120000, visibility: 'app',
    examples: [{ input: { source: 'account:fixture-work', confirm: true }, output: { status: 'saved', interactions: 5, identities: 3, affiliations: 0, facts: 0, commitments: 1, removedPeople: 1, removedOrganizations: 0 } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(writeScope(invocation));
      return c.mutate(invocation, 'delete_source_data', input, () => ({ status: 'saved' as const, ...deleteSourceData(c, input.source) }));
    },
  }),
  action({
    name: 'set_extraction',
    description: 'Turn relationship extraction on or pause it. It is off until chosen and separate from read-only sync. On, it sends bounded excerpts of new relevant conversations to Ri\'s bounded AI to suggest commitments and facts with evidence. Pausing cancels queued work and stops new AI calls.',
    input: z.object({ enabled: z.boolean() }).strict(),
    output: z.object({ status: z.enum(['off', 'on', 'paused', 'unavailable']), enabled: z.boolean() }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { enabled: true }, output: { status: 'on', enabled: true } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(writeScope(invocation));
      return c.mutate(invocation, 'set_extraction', input, () => { const setting = setExtraction(c, input.enabled); return { status: setting.status, enabled: setting.enabled }; });
    },
  }),
  action({
    name: 'continue_import',
    description: 'Run one bounded update step now for one account (or extraction), the same step the schedule runs: one provider page and at most ten new messages, or one extraction batch. Never loops.',
    input: z.object({ source: z.string().min(1).max(200) }).strict(),
    output: z.object({ ran: z.object({ kind: z.string(), source: z.string() }).strict().nullable(), more: z.boolean(), summary: z.string().max(300) }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: SYNC_ERRORS, timeoutMs: 40000, visibility: 'app',
    examples: [{ input: { source: 'account:fixture-personal' }, output: { ran: { kind: 'mail', source: 'account:fixture-personal' }, more: true, summary: 'Read 10 messages' } }],
    async handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation); requireOwner(scope);
      const accounts = accessOf(invocation)?.accounts ?? [];
      if (isAccountSource(input.source) && !accounts.some((grant) => accountSource(grant.account) === input.source)) throw new AppError('forbidden', 'Grant People access to this account in Ri first');
      return backgroundStep(c, invocation, { scope, sources: new Set([input.source]), accounts, automaticOnly: false, only: input.source });
    },
  }),
  ...(['run_background_step', 'sync_step', 'enrich_step'] as const).map((name) => action({
    name,
    description: name === 'run_background_step'
      ? 'The schedule\'s single entry point. Recovers interrupted jobs, ensures a job per automatic account, picks the fairest due job (kinds alternate, the account updated longest ago goes first) and runs one bounded step: one sync page or one extraction batch. Returns a short summary.'
      : name === 'sync_step' ? 'One bounded mail or calendar sync step for the scheduled caller\'s accounts.' : 'One bounded extraction or briefing step for the scheduled caller\'s accounts.',
    input: z.object({}).strict(),
    output: z.object({ ran: z.object({ kind: z.string(), source: z.string() }).strict().nullable(), more: z.boolean(), summary: z.string().max(300) }).strict(),
    audience: ['schedule'], effect: 'app_write', retry: 'idempotent', errors: SYNC_ERRORS, timeoutMs: 40000,
    examples: [{ input: {}, output: { ran: { kind: 'mail', source: 'account:fixture-personal' }, more: false, summary: 'Read 3 messages' } }],
    async handler(_input: Record<string, never>, invocation: AppInvocation) {
      const c = ctx();
      const scope = readScope(invocation);
      const accounts = accessOf(invocation)?.accounts ?? [];
      const sources = scope.kind === 'owner' ? new Set(accounts.map((grant) => accountSource(grant.account))) : scope.sources;
      const kinds: JobKind[] | undefined = name === 'sync_step' ? ['mail', 'calendar'] : name === 'enrich_step' ? ['enrich', 'briefing', 'attribute'] : undefined;
      return backgroundStep(c, invocation, { scope, sources, accounts, automaticOnly: true, kinds });
    },
  })),
  action({
    name: 'list_exclusions',
    description: 'Senders and domains left out: bulk or automated senders counted automatically, your exclusions and inclusions, and suppressed addresses. Each can be changed.',
    input: z.object({ decision: z.enum(['auto', 'excluded', 'included', 'suppressed']).optional(), cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(),
    output: z.object({ items: z.array(z.object({ id: z.string(), kind: z.enum(['sender', 'domain']), value: z.string().max(320), decision: z.enum(['auto', 'excluded', 'included', 'suppressed']), reason: z.string().max(200), seenCount: z.number().int(), lastSeenAt: z.string().nullable() }).strict()).max(100), nextCursor: z.string().nullable() }).strict(),
    audience: ['user'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS, visibility: 'app',
    examples: [{ input: { limit: 50 }, output: { items: [{ id: '0194d7a0-0000-7000-8000-00000000ee01', kind: 'sender', value: 'news@designweekly.example', decision: 'auto', reason: 'mailing list, unsubscribe link', seenCount: 3, lastSeenAt: T.now }], nextCursor: null } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(readScope(invocation));
      return listExclusions(c, input);
    },
  }),
  action({
    name: 'save_exclusion',
    description: 'Exclude, include or suppress a sender or domain, or clear your decision. Included senders are processed even when their mail looks automated. Decisions persist across syncs.',
    input: z.object({ value: z.string().min(1).max(320), kind: z.enum(['sender', 'domain']), decision: z.enum(['excluded', 'included', 'suppressed', 'clear']) }).strict(),
    output: z.object({ status: z.literal('saved'), value: z.string(), decision: z.enum(['auto', 'excluded', 'included', 'suppressed']) }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { value: 'news@designweekly.example', kind: 'sender', decision: 'excluded' }, output: { status: 'saved', value: 'news@designweekly.example', decision: 'excluded' } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(writeScope(invocation));
      return c.mutate(invocation, 'save_exclusion', input, () => { const row = saveExclusion(c, input); return { status: 'saved' as const, value: row.normalized, decision: row.decision }; });
    },
  }),
  action({
    name: 'save_collection',
    description: 'Create, rename or archive a collection of your own records. Collections are what you can share with a chat separately, such as Work or Family.',
    input: z.object({ key: collectionKeySchema.optional(), label: z.string().min(1).max(80), archived: z.boolean().optional() }).strict(),
    output: z.object({ status: z.literal('saved'), key: collectionKeySchema }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { label: 'Work' }, output: { status: 'saved', key: 'collection:0194d7a0-0000-7000-8000-00000000dd01' } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(writeScope(invocation));
      return c.mutate(invocation, 'save_collection', input, () => ({ status: 'saved' as const, key: saveCollection(c, input) as 'manual' }));
    },
  }),
  action({
    name: 'preview_import',
    description: 'Read a selected CSV, vCard or LinkedIn connections export (up to 512 KiB) and plan every row before anything is written: create, update an exact address match, propose a merge for a same-name match, or skip. Shows counts, company matches, the column mapping and unmapped columns. Stores the plan under an expiring preview ID and digest.',
    input: z.object({ fileName: z.string().min(1).max(200), mimeType: z.string().max(100), base64: z.string().max(Math.ceil((512 * 1024) / 3) * 4 + 4), format: z.enum(['auto', 'csv', 'vcard', 'linkedin']).optional(), collection: collectionKeySchema.optional(), listName: z.string().max(120).nullable().optional() }).strict(),
    output: z.object({
      previewId: z.string(), digest: z.string().length(64), expiresAt: z.string(), format: z.enum(['csv', 'vcard', 'linkedin']), fileName: z.string(), collection: z.string(),
      counts: z.object({ create: z.number().int(), update: z.number().int(), proposedMerge: z.number().int(), skipped: z.number().int(), unsupported: z.number().int() }).strict(),
      rows: z.array(z.object({ row: z.number().int(), name: z.string().nullable(), emails: z.array(z.string()).max(3), company: z.string().nullable(), role: z.string().nullable(), action: z.enum(['create', 'update', 'proposed_merge', 'skipped', 'unsupported']), reason: z.string().nullable(), match: z.object({ id: z.string(), name: z.string() }).strict().nullable(), candidates: z.array(z.object({ id: z.string(), name: z.string() }).strict()).max(5), invalid: z.array(z.string()).max(3) }).strict()).max(100),
      moreRows: z.number().int(),
      companies: z.array(z.object({ key: z.string(), name: z.string(), action: z.enum(['new', 'existing']), organization: z.object({ id: z.string(), name: z.string() }).strict().nullable(), candidates: z.array(z.object({ id: z.string(), name: z.string() }).strict()).max(5) }).strict()).max(100),
      mapping: z.record(z.string(), z.string()), unmapped: z.array(z.string()).max(30), note: z.string().max(400), previouslyImported: z.string().nullable(),
    }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, timeoutMs: 60000, visibility: 'app',
    examples: [{ input: { fileName: 'Connections.csv', mimeType: 'text/csv', base64: Buffer.from('First Name,Last Name,URL,Email Address,Company,Position,Connected On\nMaya,Chen,https://www.linkedin.com/in/maya-chen-fictional,,Northstar,Design lead,12 Oct 2026\n').toString('base64'), format: 'auto' }, output: {
      previewId: ID.preview, digest: DIGEST, expiresAt: T.now, format: 'linkedin', fileName: 'Connections.csv', collection: 'manual', counts: { create: 1, update: 0, proposedMerge: 0, skipped: 0, unsupported: 0 },
      rows: [{ row: 1, name: 'Maya Chen', emails: [], company: 'Northstar', role: 'Design lead', action: 'create', reason: null, match: null, candidates: [], invalid: [] }], moreRows: 0,
      companies: [{ key: 'northstar', name: 'Northstar', action: 'new', organization: null, candidates: [] }], mapping: { 'First Name': 'first', 'Last Name': 'last', URL: 'linkedin', 'Email Address': 'email', Company: 'company', Position: 'role', 'Connected On': 'observedOn' }, unmapped: [],
      note: 'A LinkedIn export is a snapshot. Roles keep their export date and are not treated as current employment. Missing emails are normal.', previouslyImported: null,
    } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.db.tx(() => previewImport(c, scope, input));
    },
  }),
  action({
    name: 'apply_import',
    description: 'Apply exactly the stored import plan once, with your row and company decisions. People, companies, affiliations, notes and list memberships are written together. Re-applying returns the first result. Same-name matches are only merged on rows you chose.',
    input: z.object({
      previewId: z.string().min(1).max(128), digest: z.string().length(64),
      decisions: z.array(z.object({ row: z.number().int().min(1), action: z.enum(['create', 'skip', 'merge']), personId: z.string().max(128).optional() }).strict()).max(5000).optional(),
      companyDecisions: z.array(z.object({ key: z.string().max(200), action: z.enum(['new', 'existing', 'none']), organizationId: z.string().max(128).optional() }).strict()).max(1000).optional(),
    }).strict(),
    output: z.object({ status: z.literal('saved'), importId: z.string(), source: z.string(), label: z.string().max(300), counts: z.object({ created: z.number().int(), updated: z.number().int(), merged: z.number().int(), skipped: z.number().int(), unsupported: z.number().int(), companies: z.number().int() }).strict() }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, timeoutMs: 120000, visibility: 'app',
    examples: [{ input: { previewId: ID.preview, digest: DIGEST }, output: { status: 'saved', importId: '0194d7a0-0000-7000-8000-00000000ef01', source: 'import:0194d7a0-0000-7000-8000-00000000ef01', label: 'LinkedIn export, October 15, 2026', counts: { created: 1, updated: 0, merged: 0, skipped: 0, unsupported: 0, companies: 1 } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.mutate(invocation, 'apply_import', input, () => applyImport(c, scope, input));
    },
  }),
  action({
    name: 'export_records',
    description: 'One part of a scoped owner export: CSV tables for people, companies, affiliations, lists, opportunities, stages and stage history, and JSON for notes, evidence references and decisions. Each part has stable IDs and a format version and ends at a record boundary. A filtered view exports only what it shows. Message bodies are never exported. This is not a full backup.',
    input: z.object({ table: z.enum(EXPORT_TABLES), cursor: z.string().max(2048).optional(), viewId: z.string().max(128).optional() }).strict(),
    output: z.object({ fileName: z.string().max(200), mimeType: z.enum(['text/csv', 'application/json']), content: z.string(), rows: z.number().int(), nextCursor: z.string().nullable(), formatVersion: z.literal(1), fetched: z.number().int() }).strict(),
    audience: ['user'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS, visibility: 'app',
    examples: [{ input: { table: 'people' }, output: { fileName: 'people-people.csv', mimeType: 'text/csv', content: 'format_version,id,name\n1,0194d7a0-0000-7000-8000-00000000a001,Maya Chen\n', rows: 1, nextCursor: null, formatVersion: 1, fetched: 1 } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      requireOwner(scope);
      return exportPart(c, scope, input);
    },
  }),
  action({
    name: 'save_navigation',
    description: 'Add or hide the Companies and Pipelines views, pin or unpin saved views, and choose the landing view. Navigation only: records, grants, sync and task links are unchanged.',
    input: z.object({ companies: z.enum(['shown', 'hidden']).optional(), pipelines: z.enum(['shown', 'hidden']).optional(), landing: z.string().max(80).optional(), companiesOffered: z.boolean().optional(), pinViewIds: z.array(z.string().max(128)).max(8).optional(), unpinViewIds: z.array(z.string().max(128)).max(8).optional() }).strict(),
    output: navigationSchema,
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { pipelines: 'shown' }, output: { companies: 'hidden', pipelines: 'shown', landing: 'today', companiesOffered: false } }],
    handler(input, invocation) {
      const c = ctx(); requireOwner(writeScope(invocation));
      return c.mutate(invocation, 'save_navigation', input, () => saveNavigation(c, input));
    },
  }),
];
