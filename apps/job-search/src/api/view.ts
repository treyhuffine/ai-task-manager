import { z } from 'zod/v4';
import { AppError, LIMITS } from '@ri/app-kit/contract';
import { defineAction } from '@ri/app-kit/sdk';
import { allows } from '@ri/app-kit/data';
import { followUpSchema, MANUAL_SOURCE, reviewItemSchema } from '../domain/model.js';
import { app, dataRevision } from '../server/state.js';
import { contextStateSchema, describeContext, exportRecords, landingSection, RESOURCE, routeOf, shareableSources, today } from '../server/view.js';
import { seedFixtures } from '../server/fixtures.js';
import { EX, examplePreparation, exampleReview, readScope } from './common.js';
import { num } from '../server/util.js';

const locationSchema = { path: z.string().regex(/^\/(?!\/)/).max(1024), query: z.record(z.string().max(64), z.string().max(1024)) };
const sectionSchema = z.enum(['today', 'opportunities', 'opportunity', 'preparation', 'materials', 'sources']);
const viewDataSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('access'),
    actorId: z.string(),
    sources: z.array(z.object({ key: z.string(), label: z.string(), kind: z.enum(['collection', 'mail', 'calendar']), description: z.string() }).strict()),
  }).strict(),
  z.object({
    mode: z.literal('app'),
    path: z.string(),
    query: z.record(z.string(), z.string()),
    section: sectionSchema,
    id: z.string().nullable(),
    landing: z.enum(['today', 'opportunities']),
    revision: z.string(),
    owner: z.boolean(),
    fictional: z.boolean(),
    setup: z.object({ opportunities: z.number().int(), materials: z.number().int(), mailConnected: z.boolean(), calendarConnected: z.boolean(), review: z.number().int() }).strict(),
  }).strict(),
]);
export type ViewData = z.infer<typeof viewDataSchema>;

/** Actions the owner's view may call. Each still checks scope and revisions on every call. */
export const VIEW_ACTIONS = [
  'list_opportunities', 'get_opportunity', 'save_opportunity', 'change_stage', 'set_stage_tracking', 'get_posting', 'record_submission',
  'list_interviews', 'save_interview', 'list_materials', 'get_material', 'save_material_version', 'compare_material_versions', 'archive_material',
  'get_preparation', 'save_preparation', 'suggest_preparation', 'list_review', 'resolve_match', 'get_correspondence',
  'list_sources', 'set_source', 'list_source_calendars', 'preview_source', 'continue_import', 'delete_source_data', 'list_scopes', 'revoke_scope',
  'preview_import', 'apply_import', 'list_imports', 'delete_import', 'create_follow_up', 'list_follow_ups', 'get_today', 'export_records',
];
const READ_ACTIONS = ['list_opportunities', 'get_opportunity', 'get_posting', 'list_interviews', 'list_materials', 'get_material', 'compare_material_versions', 'get_preparation', 'list_review', 'get_correspondence', 'list_follow_ups', 'get_today'];

export const openViewAction = defineAction({
  name: 'open_view',
  description: 'Open the Job Search view at a path such as /today, /opportunities, /opportunities/{id}, /interviews/{id} or /materials. Returns small setup data and a revision. Opening never starts a sync or any AI.',
  input: z.object(locationSchema).strict(),
  output: z.object({ resource: z.literal(RESOURCE), data: viewDataSchema, scope: z.object({ actions: z.array(z.string()), bindings: z.record(z.string(), z.string()).optional() }).strict() }).strict(),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: ['forbidden', 'invalid_input', 'revoked'],
  examples: [
    { input: { path: '/', query: {} }, output: { resource: RESOURCE, data: { mode: 'app', path: '/', query: {}, section: 'today', id: null, landing: 'today', revision: 'r42', owner: true, fictional: false, setup: { opportunities: 5, materials: 2, mailConnected: true, calendarConnected: true, review: 1 } }, scope: { actions: ['list_opportunities', 'get_opportunity'] } } },
    { input: { path: '/access', query: { hostActor: 'chat:0192f0aa-0000-7000-8000-00000000c4a7' } }, output: { resource: RESOURCE, data: { mode: 'access', actorId: 'chat:0192f0aa-0000-7000-8000-00000000c4a7', sources: [{ key: 'manual', label: 'Saved jobs, interviews and preparation', kind: 'collection', description: 'Opportunities, postings, stage history, interviews you added, preparation and follow-ups' }] } , scope: { actions: ['create_scope'], bindings: { actorId: 'chat:0192f0aa-0000-7000-8000-00000000c4a7' } } } },
  ],
  handler: (input, invocation) => {
    const principal = invocation.principal;
    const route = routeOf(input.path);
    if (route.section === 'access') {
      if (principal.kind !== 'owner-ui') throw new AppError('forbidden', 'Only the person who owns this app can choose what a chat may use');
      const actorId = input.query.hostActor ?? '';
      if (!/^(chat|workspace|job|background):[^\s]{1,128}$/.test(actorId)) throw new AppError('invalid_input', 'Choose a chat or agent in Ri before choosing its access');
      return { resource: RESOURCE, data: { mode: 'access' as const, actorId, sources: shareableSources(invocation.access) }, scope: { actions: ['create_scope'], bindings: { actorId } } };
    }
    if (principal.kind === 'fixture') seedFixtures();
    const scope = readScope(invocation);
    const db = app().db;
    const owner = scope.kind === 'owner';
    const opportunities = allows(scope, MANUAL_SOURCE) ? num(db.prepare('SELECT COUNT(*) AS count FROM opportunities').get()?.count) : 0;
    const materials = num(db.prepare('SELECT COUNT(*) AS count FROM material_families').get()?.count);
    const accounts = app().accounts.list();
    const granted = invocation.access?.accounts ?? [];
    const fictional = !!db.prepare('SELECT 1 FROM opportunities WHERE fictional = 1 LIMIT 1').get();
    const review = db.prepare("SELECT source_key FROM review_items WHERE status = 'open'").all().filter((row) => allows(scope, String(row.source_key))).length;
    const landing = landingSection(scope);
    const section = route.section === 'root' ? landing : route.section;
    return {
      resource: RESOURCE,
      data: {
        mode: 'app' as const, path: input.path, query: Object.fromEntries(Object.entries(input.query).filter(([key]) => ['tab', 'mode', 'view', 'q', 'stage', 'selected', 'interview', 'version'].includes(key))), section, id: route.id, landing, revision: dataRevision(), owner, fictional,
        setup: {
          opportunities, materials,
          mailConnected: granted.some((item) => item.binding === 'mail') || accounts.some((item) => item.kind === 'mail'),
          calendarConnected: granted.some((item) => item.binding === 'calendar') || accounts.some((item) => item.kind === 'calendar'),
          review,
        },
      },
      scope: { actions: owner ? VIEW_ACTIONS : READ_ACTIONS },
    };
  },
});

export const describeViewContextAction = defineAction({
  name: 'describe_view_context',
  description: 'Describe what the person is looking at in Job Search for the chat: the selected opportunities, interviews, materials or review items, re-read under the chat\'s own access, with their current revisions, labeled as app data.',
  input: z.object({ ...locationSchema, state: contextStateSchema }).strict(),
  output: z.object({
    modelContent: z.string().max(LIMITS.modelContextBytes),
    recordRefs: z.array(z.object({ instanceId: z.string().uuid(), entityType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), recordId: z.string().min(1).max(128) }).strict()).max(50),
    dataRevision: z.string(),
  }).strict(),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', visibility: 'app', errors: ['forbidden', 'revoked', 'invalid_input'],
  examples: [{
    input: { path: '/opportunities/' + EX.opportunity, query: {}, state: { section: 'opportunity', selected: [{ type: 'opportunity', id: EX.opportunity }], revisions: { [EX.opportunity]: 4 } } },
    output: { modelContent: 'Job Search app data, labeled and read only.\n## Northstar · Product designer [opportunity ' + EX.opportunity + ']\nStage: Interviewing.', recordRefs: [{ instanceId: EX.instance, entityType: 'opportunity', recordId: EX.opportunity }], dataRevision: 'r42' },
  }],
  handler: (input, invocation) => describeContext(readScope(invocation), invocation.access, input.state, input.path),
});

const todaySchema = z.object({
  date: z.string(),
  zone: z.string(),
  interviews: z.array(z.object({ interviewId: z.string(), opportunityId: z.string(), company: z.string(), role: z.string(), title: z.string(), startAt: z.string(), endAt: z.string().nullable(), zone: z.string().nullable(), format: z.string(), meetingLink: z.string().nullable(), participants: z.array(z.string()), prepared: z.boolean() }).strict()),
  scheduling: z.array(z.object({ interviewId: z.string(), opportunityId: z.string(), company: z.string(), role: z.string(), title: z.string(), since: z.string() }).strict()),
  deadlines: z.array(z.object({ opportunityId: z.string(), company: z.string(), role: z.string(), date: z.string(), label: z.string(), kind: z.enum(['deadline', 'action']), overdue: z.boolean() }).strict()),
  responses: z.array(reviewItemSchema),
  followUps: z.array(followUpSchema),
  suggestions: z.array(z.object({ opportunityId: z.string(), company: z.string(), role: z.string(), appliedOn: z.string(), quietDays: z.number().int() }).strict()),
  counts: z.object({ opportunities: z.number().int(), review: z.number().int() }).strict(),
}).strict();

export const getTodayAction = defineAction({
  name: 'get_today',
  description: 'What needs attention today: upcoming interviews with their zones, invitations to choose times, explicit deadlines and chosen next actions, responses waiting for review, linked Ri follow-ups and clearly labeled follow-up suggestions. No scores, and silence never becomes a rejection or a deadline.',
  input: z.object({ zone: z.string().max(100).optional() }).strict(),
  output: todaySchema,
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: ['forbidden', 'revoked'],
  examples: [{
    input: { zone: 'America/Denver' },
    output: {
      date: '2026-10-15', zone: 'America/Denver',
      interviews: [{ interviewId: EX.interview, opportunityId: EX.opportunity, company: 'Northstar', role: 'Product designer', title: 'Portfolio discussion', startAt: '2026-10-16T16:00:00.000Z', endAt: '2026-10-16T16:45:00.000Z', zone: 'America/Denver', format: 'video', meetingLink: 'https://meet.example.test/northstar-portfolio', participants: ['Maya Chen'], prepared: examplePreparation.examples.length > 0 }],
      scheduling: [], deadlines: [{ opportunityId: EX.opportunity2, company: 'Cedar', role: 'Design lead', date: '2026-10-21', label: 'Reply to the offer by', kind: 'deadline', overdue: false }],
      responses: [exampleReview], followUps: [], suggestions: [], counts: { opportunities: 5, review: 1 },
    },
  }],
  handler: (input, invocation) => today(readScope(invocation), input.zone),
});

export const exportRecordsAction = defineAction({
  name: 'export_records',
  description: 'Export the person\'s own Job Search records as a JSON file through Ri\'s download control: opportunities with stage history, posting snapshots, interviews, submissions, preparation, materials and follow-ups. Message bodies are not included.',
  input: z.object({}).strict(),
  output: z.object({ fileName: z.string(), mimeType: z.literal('application/json'), text: z.string(), opportunities: z.number().int(), materials: z.number().int() }).strict(),
  audience: ['user'], effect: 'read', retry: 'read_safe', visibility: 'app', errors: ['forbidden', 'invalid_input'],
  examples: [{ input: {}, output: { fileName: 'job-search-export-2026-10-15.json', mimeType: 'application/json', text: '{"format":"ri-job-search-export","version":1}', opportunities: 5, materials: 2 } }],
  handler: (_input, invocation) => {
    if (invocation.principal.kind !== 'owner-ui' && invocation.principal.kind !== 'fixture') throw new AppError('forbidden', 'Only the person who owns this app can export its records');
    return exportRecords(readScope(invocation));
  },
});

export const viewActions = [openViewAction, describeViewContextAction, getTodayAction, exportRecordsAction];
export { reviewItemSchema };
