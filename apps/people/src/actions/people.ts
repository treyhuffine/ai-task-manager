import { AppError } from '@ri/app-kit/contract';
import { z } from 'zod/v4';
import { actor, ctx, granted, readScope, requireOwner, writeScope } from '../runtime.js';
import { coverageFor, Labels } from '../domain/coverage.js';
import { dataRevision } from '../domain/scope.js';
import { createManualPerson, getPersonRow, listPeople, resolvePersonId, savePerson, searchPeople, summarizePeople } from '../domain/people.js';
import { createOrganization, getOrganizationRow, listOrganizations, resolveOrganizationId, saveOrganization, searchOrganizations, summarizeOrganizations } from '../domain/organizations.js';
import { refreshPerson } from '../domain/people.js';
import { saveAffiliation, projectAffiliation, type AffiliationRow } from '../domain/affiliations.js';
import { getInteractionRow, linkInteraction, listTimeline, projectInteraction } from '../domain/interactions.js';
import { applyAttribution, disableAttribution, previewAttribution } from '../domain/attribution.js';
import { getOrganizationDetail, getPersonDetail } from '../domain/detail.js';
import { getView, DEFAULT_SORT, DEFAULT_COLUMNS } from '../domain/views.js';
import { getListRow } from '../domain/lists.js';
import { writableCollection } from '../domain/scope.js';
import { mergesFor } from '../domain/merge.js';
import {
  affiliationSchema, collectionKeySchema, idSchema, localDateSchema, organizationDetailSchema, organizationFiltersSchema, organizationKindSchema, organizationSummarySchema,
  coverageSchema, peopleFiltersSchema, personDetailSchema, personSummarySchema, sortSchema, columnSchema, timelineItemSchema, writeResult, refSchema,
} from '../schemas.js';
import { AFFILIATION, COVERAGE, ID, ORGANIZATION, PERSON, TIMELINE, T, DIGEST } from './examples.js';
import { READ_ERRORS, WRITE_ERRORS, action, listInput, listOutput } from './shared.js';

const identifier = z.object({ kind: z.enum(['email', 'phone', 'linkedin']), value: z.string().min(1).max(320) }).strict();
const mergeRef = z.object({ id: idSchema, revision: z.number().int(), survivorId: idSchema, mergedId: idSchema, createdAt: z.string() }).strict();
const personDetailOutput = personDetailSchema.extend({ merges: z.array(mergeRef).max(10) }).strict();
const organizationDetailOutput = organizationDetailSchema.extend({ merges: z.array(mergeRef).max(10) }).strict();

export const peopleActions = [
  action({
    name: 'list_people',
    description: 'List people in the directory with structured filters, a sort and a page cursor. Filters combine with AND, several values in one field mean OR. Results, counts and sort keys use only records this caller may see. A saved view or list can be named instead of filters.',
    input: z.object({
      ...listInput,
      filters: peopleFiltersSchema.optional(),
      sort: sortSchema.optional(),
      viewId: idSchema.optional(),
      listId: idSchema.optional(),
    }).strict(),
    output: listOutput(personSummarySchema, { total: z.number().int().min(0), unavailableFilters: z.array(z.string().max(200)).max(20), columns: z.array(columnSchema).max(10) }),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { limit: 50, filters: { listIds: [ID.list], lastExchange: { olderThanDays: 30, includeNone: true } }, sort: { key: 'last_exchange', direction: 'asc' } }, output: { items: [PERSON], nextCursor: null, coverage: COVERAGE, revision: 'o12', total: 1, unavailableFilters: [], columns: ['company', 'last_exchange', 'next_action'] } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      let filters = input.filters ?? {}, sort = input.sort ?? DEFAULT_SORT.person, columns = DEFAULT_COLUMNS.person;
      const unavailable: string[] = [];
      if (input.viewId) {
        const view = getView(c, scope, input.viewId);
        if (!view || view.recordKind !== 'person') throw new AppError('not_found', 'That view is no longer available');
        filters = { ...(view.filters as typeof filters), ...(input.filters ?? {}) };
        sort = input.sort ?? view.sort;
        columns = view.columns;
        unavailable.push(...view.unavailableFilters);
        if (view.listId) filters = { ...filters, listIds: [view.listId] };
      }
      if (input.listId) {
        if (!getListRow(c, scope, input.listId)) throw new AppError('not_found', 'That list is no longer available');
        filters = { ...filters, listIds: [input.listId] };
      }
      const result = listPeople(c, scope, { cursor: input.cursor, limit: input.limit, filters, sort });
      return { items: result.items, nextCursor: result.nextCursor, coverage: coverageFor(c, scope, granted(invocation)), revision: dataRevision(c, scope), total: result.total, unavailableFilters: [...new Set([...unavailable, ...result.unavailableFilters.map((item) => item.startsWith('list:') ? 'List unavailable' : 'Source no longer permitted')])], columns };
    },
  }),
  action({
    name: 'search_people',
    description: 'Search names, addresses, roles, companies and your notes. Text from accounts or collections this caller may not see is never matched, ranked or counted. Returns people and, optionally, companies.',
    input: z.object({ text: z.string().min(1).max(200), ...listInput, includeOrganizations: z.boolean().optional() }).strict(),
    output: listOutput(personSummarySchema, { total: z.number().int().min(0), organizations: z.array(organizationSummarySchema).max(10) }),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { text: 'Maya', limit: 20, includeOrganizations: true }, output: { items: [PERSON], nextCursor: null, coverage: COVERAGE, revision: 'o12', total: 1, organizations: [] } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      const result = searchPeople(c, scope, { text: input.text, cursor: input.cursor, limit: input.limit });
      return { ...result, coverage: coverageFor(c, scope, granted(invocation)), revision: dataRevision(c, scope), organizations: input.includeOrganizations && !input.cursor ? searchOrganizations(c, scope, input.text, 10) : [] };
    },
  }),
  action({
    name: 'get_person',
    description: 'Read one person: header, sourced affiliations with dates, identities, notes, commitments, facts, follow-ups, lists, opportunities and coverage. Only permitted sources are included. Opening a record never starts an import or AI.',
    input: z.object({ id: idSchema }).strict(),
    output: personDetailOutput,
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { id: ID.maya }, output: {
      person: { id: ID.maya, revision: 3, name: 'Maya Chen', nameOverride: null, headline: null, observedNames: [{ name: 'Maya Chen', sourceLabel: 'Personal Gmail' }], collection: 'manual', origin: 'sent_mail', originLabel: 'From mail you sent', pinned: true, archived: false, keepInTouchDays: null, createdAt: '2026-09-02T10:00:00.000Z', updatedAt: T.now },
      header: { role: 'Design lead', company: { id: ID.northstar, name: 'Northstar' }, affiliationNote: 'Affiliation observed in October 2026 correspondence', lastExchangeAt: T.mail, nextMeeting: { id: ID.meeting, at: T.meeting, title: 'Portfolio discussion' }, nextAction: PERSON.nextAction },
      identities: [{ keyId: '0194d7a0-0000-7000-8000-0000000ff001', kind: 'email', value: 'maya@northstar.example', shared: false, confirmation: 'observed', sources: ['Personal Gmail'], observedAt: T.mail }],
      affiliations: [], notes: [], commitments: [], facts: [], taskLinks: [], opportunities: [], lists: [{ id: ID.list, name: 'Collaborators' }], reviews: [], attribution: [], coverage: COVERAGE, revision: 'o12', merges: [],
    } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      const detail = getPersonDetail(c, scope, input.id, granted(invocation));
      return { ...detail, merges: scope.kind === 'owner' ? mergesFor(c, 'person', detail.person.id).map((row) => ({ id: row.id, revision: row.revision, survivorId: row.survivor_id, mergedId: row.merged_id, createdAt: row.created_at })) : [] };
    },
  }),
  action({
    name: 'save_person',
    description: 'Create a person with only a name, or edit one: a name correction, a short headline, pin, archive, keep-in-touch interval, collection, or addresses. Corrections take precedence over observed values and survive resync. Updates need the expected revision and return a conflict with the current record when it changed.',
    input: z.object({
      id: idSchema.optional(),
      expectedRevision: z.number().int().min(0).optional(),
      name: z.string().max(200).nullable().optional(),
      headline: z.string().max(120).nullable().optional(),
      pinned: z.boolean().optional(),
      archived: z.boolean().optional(),
      keepInTouchDays: z.number().int().min(7).max(730).nullable().optional(),
      collection: collectionKeySchema.optional(),
      identifiers: z.array(identifier).max(10).optional(),
      addIdentifiers: z.array(identifier).max(10).optional(),
      detachKeyIds: z.array(idSchema).max(10).optional(),
      sharedKeyIds: z.array(idSchema).max(10).optional(),
    }).strict(),
    output: writeResult(personSummarySchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [
      { input: { name: 'Elena Park', headline: 'Research lead', identifiers: [{ kind: 'email', value: 'elena.park@proton.me' }] }, output: { status: 'saved', record: { ...PERSON, id: ID.jordan, name: 'Elena Park', role: 'Research lead', company: null, affiliationStatus: null, pinned: false, lists: [], nextMeeting: null, nextAction: null, primaryEmail: 'elena.park@proton.me', sourceLabels: ['Your records'] } } },
      { input: { id: ID.maya, expectedRevision: 2, pinned: true }, output: { status: 'conflict', current: PERSON, message: 'This person changed since you opened it. Compare and try again' } },
    ],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'save_person', input, () => {
        if (!input.id) {
          if (!input.name) throw new AppError('invalid_input', 'Enter a name');
          const id = createManualPerson(c, scope, { name: input.name, headline: input.headline, collection: input.collection, identifiers: input.identifiers, pinned: input.pinned, keepInTouchDays: input.keepInTouchDays });
          return { status: 'saved' as const, record: summarizePeople(c, scope, [id])[0] };
        }
        if (input.expectedRevision === undefined) throw new AppError('invalid_input', 'Include the revision you edited');
        const result = savePerson(c, scope, { ...input, id: input.id, expectedRevision: input.expectedRevision });
        const record = summarizePeople(c, scope, [result.id])[0];
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'list_organizations',
    description: 'List companies and other organizations with known contacts, last attributed exchange and next action. Counts and dates use only permitted records. A company without known contacts is valid.',
    input: z.object({ ...listInput, filters: organizationFiltersSchema.optional(), sort: sortSchema.optional(), viewId: idSchema.optional() }).strict(),
    output: listOutput(organizationSummarySchema, { total: z.number().int().min(0), unavailableFilters: z.array(z.string().max(200)).max(20), columns: z.array(columnSchema).max(10) }),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { limit: 50 }, output: { items: [ORGANIZATION], nextCursor: null, coverage: COVERAGE, revision: 'o12', total: 1, unavailableFilters: [], columns: ['people', 'last_exchange', 'next_action'] } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      let filters = input.filters ?? {}, sort = input.sort ?? DEFAULT_SORT.organization, columns = DEFAULT_COLUMNS.organization;
      const unavailable: string[] = [];
      if (input.viewId) {
        const view = getView(c, scope, input.viewId);
        if (!view || view.recordKind !== 'organization') throw new AppError('not_found', 'That view is no longer available');
        filters = { ...(view.filters as typeof filters), ...(input.filters ?? {}) };
        sort = input.sort ?? view.sort; columns = view.columns; unavailable.push(...view.unavailableFilters);
      }
      const result = listOrganizations(c, scope, { cursor: input.cursor, limit: input.limit, filters, sort });
      return { items: result.items, nextCursor: result.nextCursor, coverage: coverageFor(c, scope, granted(invocation)), revision: dataRevision(c, scope), total: result.total, unavailableFilters: [...new Set([...unavailable, ...result.unavailableFilters.map(() => 'Source no longer permitted')])], columns };
    },
  }),
  action({
    name: 'get_organization',
    description: 'Read one company: current, former and date-uncertain people, explicitly linked commitments, opportunities, notes, follow-ups and attribution rules. A person\'s unrelated private exchanges never appear here.',
    input: z.object({ id: idSchema }).strict(),
    output: organizationDetailOutput,
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { id: ID.fieldwork }, output: {
      organization: { id: ID.fieldwork, revision: 2, name: 'Fieldwork', nameOverride: 'Fieldwork', kind: 'company', website: 'fieldwork.example', state: 'confirmed', stateLabel: 'Company details added by you', collection: 'manual', archived: false, createdAt: '2026-09-10T10:00:00.000Z', updatedAt: T.now },
      domains: [], people: { current: [AFFILIATION], former: [], uncertain: [], more: false }, nextAction: ORGANIZATION.nextAction, commitments: [],
      opportunities: [{ id: ID.opportunity, title: 'Onboarding project', stageLabel: 'Proposal', stageKind: 'open', pipelineName: 'Client work', nextAction: 'Send revised proposal', nextActionDate: '2026-10-16', value: { minor: 800000, currency: 'USD' } }],
      notes: [], taskLinks: [], lists: [], attributionRules: [], lastExchangeAt: '2026-10-11T17:00:00.000Z', coverage: COVERAGE, revision: 'o12', merges: [],
    } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      const detail = getOrganizationDetail(c, scope, input.id, granted(invocation));
      return { ...detail, merges: scope.kind === 'owner' ? mergesFor(c, 'organization', detail.organization.id).map((row) => ({ id: row.id, revision: row.revision, survivorId: row.survivor_id, mergedId: row.merged_id, createdAt: row.created_at })) : [] };
    },
  }),
  action({
    name: 'save_organization',
    description: 'Create a company or other organization with only a name, or edit its name, website, type, archive state or confirmation. No enrichment runs. Updates need the expected revision.',
    input: z.object({
      id: idSchema.optional(), expectedRevision: z.number().int().min(0).optional(),
      name: z.string().max(200).nullable().optional(), website: z.string().max(300).nullable().optional(), kind: organizationKindSchema.nullable().optional(),
      archived: z.boolean().optional(), confirm: z.boolean().optional(), collection: collectionKeySchema.optional(),
    }).strict(),
    output: writeResult(organizationSummarySchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { name: 'Fieldwork', website: 'fieldwork.example', kind: 'company' }, output: { status: 'saved', record: ORGANIZATION } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'save_organization', input, () => {
        if (!input.id) {
          if (!input.name) throw new AppError('invalid_input', 'Enter a name');
          const id = createOrganization(c, scope, { name: input.name, website: input.website, kind: input.kind, collection: input.collection });
          return { status: 'saved' as const, record: summarizeOrganizations(c, scope, [id])[0] };
        }
        if (input.expectedRevision === undefined) throw new AppError('invalid_input', 'Include the revision you edited');
        const result = saveOrganization(c, scope, { ...input, id: input.id, expectedRevision: input.expectedRevision }, refreshPerson);
        const record = summarizeOrganizations(c, scope, [result.id])[0];
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'save_affiliation',
    description: 'Record a dated affiliation between a person and a company, edit your own, end one with a valid-to date, or confirm or reject an observed one. Confirming keeps the original evidence beside your version. Rejection is durable. Old conversations never move to a new employer.',
    input: z.object({
      id: idSchema.optional(), expectedRevision: z.number().int().min(0).optional(),
      personId: idSchema.optional(), organizationId: idSchema.optional(), organizationName: z.string().max(200).optional(),
      role: z.string().max(200).nullable().optional(), validFrom: localDateSchema.nullable().optional(), validTo: localDateSchema.nullable().optional(),
      status: z.enum(['current', 'former', 'unknown']).optional(), decision: z.enum(['confirm', 'reject']).optional(), collection: collectionKeySchema.optional(),
    }).strict(),
    output: writeResult(affiliationSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { personId: ID.jordan, organizationId: ID.fieldwork, role: 'Founder', status: 'current' }, output: { status: 'saved', record: AFFILIATION } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'save_affiliation', input, () => {
        const result = saveAffiliation(c, scope, actor(invocation), input);
        const row = c.db.get<AffiliationRow>('SELECT * FROM affiliations WHERE id = ?', result.id)!;
        const record = projectAffiliation(c, scope, row, new Labels(c), c.now().toISOString().slice(0, 10));
        if (!record) throw new AppError('not_found', 'This affiliation is no longer available');
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'list_interactions',
    description: 'A paginated timeline for a person, company or opportunity: emails, meetings, your notes and your changes, sorted by event time. Calendar items say Meeting scheduled or Past calendar event and never imply attendance. Company activity includes only linked or attributed conversations, one row per thread.',
    input: z.object({
      subjectKind: z.enum(['person', 'organization', 'opportunity']), subjectId: idSchema, ...listInput,
      include: z.array(z.enum(['email', 'meeting', 'note', 'change'])).max(4).optional(), from: z.string().max(40).optional(), to: z.string().max(40).optional(),
    }).strict(),
    output: listOutput(timelineItemSchema),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { subjectKind: 'person', subjectId: ID.maya, limit: 20 }, output: { items: [TIMELINE], nextCursor: null, coverage: COVERAGE, revision: 'o12' } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      const id = input.subjectKind === 'person' ? resolvePersonId(c, input.subjectId) : input.subjectKind === 'organization' ? resolveOrganizationId(c, input.subjectId) : input.subjectId;
      if (input.subjectKind === 'person' && !getPersonRow(c, id)) throw new AppError('not_found', 'This person is no longer available');
      if (input.subjectKind === 'organization' && !getOrganizationRow(c, id)) throw new AppError('not_found', 'This company is no longer available');
      const result = listTimeline(c, scope, { subject: { kind: input.subjectKind, id }, cursor: input.cursor, limit: input.limit, include: input.include, from: input.from, to: input.to });
      return { ...result, coverage: coverageFor(c, scope, granted(invocation)), revision: dataRevision(c, scope) };
    },
  }),
  action({
    name: 'link_interaction',
    description: 'Your decision on one conversation or meeting: link it to a company or opportunity, unlink it, exclude it from a company\'s activity, confirm or deny attendance, or include a large event. Decisions survive resync.',
    input: z.object({
      interactionId: idSchema, expectedRevision: z.number().int().min(0),
      operation: z.enum(['link', 'unlink', 'exclude', 'confirm_attendance', 'not_attended', 'clear_attendance', 'include_event']),
      target: z.object({ kind: z.enum(['organization', 'opportunity']), id: idSchema }).strict().optional(), collection: collectionKeySchema.optional(),
    }).strict(),
    output: writeResult(timelineItemSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { interactionId: ID.interaction, expectedRevision: 1, operation: 'link', target: { kind: 'organization', id: ID.fieldwork } }, output: { status: 'saved', record: { ...TIMELINE, revision: 2, links: [{ kind: 'organization', id: ID.fieldwork, name: 'Fieldwork', origin: 'manual' }] } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'link_interaction', input, () => {
        const result = linkInteraction(c, scope, input, (requested) => writableCollection(c, scope, requested));
        const row = getInteractionRow(c, scope, result.id)!;
        const record = projectInteraction(c, scope, row as never, new Labels(c), c.now().toISOString());
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'preview_company_attribution',
    description: 'Preview "Include work conversations with this address": one account, one confirmed work address, one company and a date range, with representative matching exchanges, coverage and an expiring digest. Stores only the preview.',
    input: z.object({ personId: idSchema, keyId: idSchema, organizationId: idSchema, account: z.string().min(1).max(200), from: localDateSchema.nullable().optional(), to: localDateSchema.nullable().optional(), ruleId: idSchema.optional(), collection: collectionKeySchema.optional() }).strict(),
    output: z.object({
      previewId: idSchema, digest: z.string().length(64), expiresAt: z.string(),
      draft: z.object({ person: refSchema, organization: refSchema, identity: z.string().max(320), account: z.string().max(300), from: localDateSchema.nullable(), to: localDateSchema.nullable(), collection: collectionKeySchema, ruleId: idSchema.nullable() }).strict(),
      matches: z.object({ total: z.number().int().min(0), sample: z.array(timelineItemSchema).max(8) }).strict(),
      coverage: coverageSchema, note: z.string().max(400),
    }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, visibility: 'app',
    examples: [{ input: { personId: ID.jordan, keyId: '0194d7a0-0000-7000-8000-0000000ff002', organizationId: ID.fieldwork, account: 'account:fixture-work', from: '2026-09-01', to: null }, output: {
      previewId: ID.preview, digest: DIGEST, expiresAt: T.now, draft: { person: { id: ID.jordan, name: 'Jordan Bell' }, organization: { id: ID.fieldwork, name: 'Fieldwork' }, identity: 'jordan@fieldwork.example', account: 'Work Gmail', from: '2026-09-01', to: null, collection: 'manual', ruleId: null },
      matches: { total: 4, sample: [TIMELINE] }, coverage: COVERAGE, note: 'Applies to direct work exchanges with this address in this account and range, now and on later syncs.',
    } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.db.tx(() => ({ ...previewAttribution(c, scope, input), coverage: coverageFor(c, scope, granted(invocation)) }));
    },
  }),
  action({
    name: 'apply_company_attribution',
    description: 'Apply a previewed company attribution rule exactly as previewed, or disable a rule. Applying links the first bounded batch now and queues the rest. Disabling removes only that rule\'s links and keeps manual links. It never widens the previewed account or range.',
    input: z.union([
      z.object({ previewId: idSchema, digest: z.string().length(64) }).strict(),
      z.object({ ruleId: idSchema, expectedRevision: z.number().int().min(0), disable: z.literal(true) }).strict(),
    ]),
    output: z.object({ status: z.enum(['saved', 'conflict']), ruleId: idSchema, linked: z.number().int().min(0), more: z.boolean(), message: z.string().max(300).optional() }).strict(),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS, timeoutMs: 60000,
    examples: [{ input: { previewId: ID.preview, digest: DIGEST }, output: { status: 'saved', ruleId: ID.rule, linked: 4, more: false } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.mutate(invocation, 'apply_company_attribution', input, () => ('previewId' in input ? applyAttribution(c, scope, actor(invocation), input) : disableAttribution(c, scope, input)));
    },
  }),
];
