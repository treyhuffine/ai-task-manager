import { AppError } from '@ri/app-kit/contract';
import { z } from 'zod/v4';
import { actor, ctx, granted, readScope, requireOwner, writeScope } from '../runtime.js';
import { coverageFor } from '../domain/coverage.js';
import { dataRevision } from '../domain/scope.js';
import { getView, listViews, projectView, saveView, DEFAULT_SORT } from '../domain/views.js';
import { getListRow, listLists, projectList, saveList, updateListMembers } from '../domain/lists.js';
import { bulkUpdate } from '../domain/records.js';
import { getOpportunityRow, getPipelineRow, listOpportunities, listPipelines, moveOpportunity, projectPipeline, saveOpportunity, savePipeline, savePipelineStages, summarizeOpportunity } from '../domain/pipelines.js';
import { getOpportunityDetail } from '../domain/detail.js';
import { resolvePersonId } from '../domain/people.js';
import {
  collectionKeySchema, columnSchema, idSchema, listSchema, localDateSchema, moneySchema, opportunityDetailSchema, opportunityFiltersSchema, opportunitySummarySchema,
  organizationFiltersSchema, peopleFiltersSchema, pipelineSchema, sortSchema, viewSchema, writeResult,
} from '../schemas.js';
import { COVERAGE, ID, LIST, OPPORTUNITY, PIPELINE, T, VIEW } from './examples.js';
import { READ_ERRORS, WRITE_ERRORS, action, listInput, listOutput } from './shared.js';

const stageInput = z.object({ id: idSchema.optional(), label: z.string().min(1).max(80), kind: z.enum(['open', 'succeeded', 'closed']) }).strict();

export const organizeActions = [
  action({
    name: 'list_views',
    description: 'Saved views for people, companies or opportunities, searchable by name. Each stores only structured filters, a sort and columns, and is evaluated against the reader\'s permitted records. Filters a reader cannot use are named as unavailable.',
    input: z.object({ recordKind: z.enum(['person', 'organization', 'opportunity']).optional(), text: z.string().max(120).optional(), includeArchived: z.boolean().optional(), ...listInput }).strict(),
    output: z.object({ items: z.array(viewSchema).max(100), nextCursor: z.string().nullable(), revision: z.string().max(80) }).strict(),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { recordKind: 'person', limit: 50 }, output: { items: [VIEW], nextCursor: null, revision: 'o12' } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return { ...listViews(c, scope, input), revision: dataRevision(c, scope) };
    },
  }),
  action({
    name: 'save_view',
    description: 'Save the current filters, sort and columns as a named view, or edit or archive one. Only the listed filter vocabulary is accepted, never expressions or code. Saving a view copies no records and grants no access. Pinning a view is a navigation change made in the view.',
    input: z.object({
      id: idSchema.optional(), expectedRevision: z.number().int().min(0).optional(), label: z.string().max(120).optional(),
      recordKind: z.enum(['person', 'organization', 'opportunity']).optional(),
      filters: z.union([peopleFiltersSchema, organizationFiltersSchema, opportunityFiltersSchema]).optional(),
      sort: sortSchema.optional(), columns: z.array(columnSchema).max(10).optional(), listId: idSchema.nullable().optional(), pipelineId: idSchema.nullable().optional(),
      collection: collectionKeySchema.optional(), archived: z.boolean().optional(),
    }).strict(),
    output: writeResult(viewSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { label: 'Clients not spoken to in a month', recordKind: 'person', filters: { listIds: [ID.list], lastExchange: { olderThanDays: 30, includeNone: true } }, sort: { key: 'last_exchange', direction: 'asc' } }, output: { status: 'saved', record: VIEW } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'save_view', input, () => {
        const result = saveView(c, scope, input);
        const record = getView(c, scope, result.id)!;
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'list_lists',
    description: 'Named lists of people or companies, with member counts this caller may see. A list holds one record kind and is not a permission container.',
    input: z.object({ recordKind: z.enum(['person', 'organization']).optional(), includeArchived: z.boolean().optional(), ...listInput }).strict(),
    output: z.object({ items: z.array(listSchema).max(100), nextCursor: z.string().nullable(), revision: z.string().max(80) }).strict(),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { recordKind: 'person', limit: 50 }, output: { items: [LIST], nextCursor: null, revision: 'o12' } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return { ...listLists(c, scope, input), revision: dataRevision(c, scope) };
    },
  }),
  action({
    name: 'save_list',
    description: 'Create a list of people or of companies, or rename or archive one. Archiving keeps memberships and records.',
    input: z.object({ id: idSchema.optional(), expectedRevision: z.number().int().min(0).optional(), name: z.string().max(120).optional(), recordKind: z.enum(['person', 'organization']).optional(), collection: collectionKeySchema.optional(), archived: z.boolean().optional() }).strict(),
    output: writeResult(listSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { name: 'Clients', recordKind: 'person' }, output: { status: 'saved', record: { ...LIST, revision: 1, memberCount: 0 } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'save_list', input, () => {
        const result = saveList(c, scope, input);
        const record = projectList(c, scope, getListRow(c, scope, result.id)!);
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'update_list_members',
    description: 'Add, remove or reorder members of one list (at most 50 per change). Members must be visible records of the list\'s kind. Membership copies nothing and shares nothing.',
    input: z.object({ listId: idSchema, expectedRevision: z.number().int().min(0), add: z.array(idSchema).max(50).optional(), remove: z.array(idSchema).max(50).optional(), order: z.array(idSchema).max(100).optional() }).strict(),
    output: writeResult(listSchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { listId: ID.list, expectedRevision: 1, add: [ID.jordan] }, output: { status: 'saved', record: LIST } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'update_list_members', input, () => {
        const result = updateListMembers(c, scope, actor(invocation), { ...input, add: input.add?.map((id) => resolvePersonId(c, id)) });
        const record = projectList(c, scope, getListRow(c, scope, result.id)!);
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'bulk_update_records',
    description: 'Apply one change (pin, archive, add to list or remove from list) to at most 50 selected records, each with its expected revision. Failures are reported per record. There is no select-all across a query and no outreach.',
    input: z.object({
      recordKind: z.enum(['person', 'organization']),
      items: z.array(z.object({ id: idSchema, expectedRevision: z.number().int().min(0) }).strict()).min(1).max(50),
      change: z.object({ pinned: z.boolean().optional(), archived: z.boolean().optional(), addToListId: idSchema.optional(), removeFromListId: idSchema.optional() }).strict(),
    }).strict(),
    output: z.object({ results: z.array(z.object({ id: idSchema, status: z.enum(['saved', 'conflict', 'not_found', 'forbidden']), message: z.string().max(300).nullable() }).strict()).max(50), saved: z.number().int().min(0) }).strict(),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { recordKind: 'person', items: [{ id: ID.maya, expectedRevision: 3 }, { id: ID.jordan, expectedRevision: 1 }], change: { pinned: true } }, output: { results: [{ id: ID.maya, status: 'saved', message: null }, { id: ID.jordan, status: 'conflict', message: 'Changed since you selected it' }], saved: 1 } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'bulk_update_records', input, () => bulkUpdate(c, scope, actor(invocation), input));
    },
  }),
  action({
    name: 'list_pipelines',
    description: 'Optional pipelines with their ordered stages and the number of opportunities in each that this caller may see. Values are never summed.',
    input: z.object({ includeArchived: z.boolean().optional() }).strict(),
    output: z.object({ items: z.array(pipelineSchema).max(50), revision: z.string().max(80) }).strict(),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: {}, output: { items: [PIPELINE], revision: 'o12' } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return { items: listPipelines(c, scope, input.includeArchived), revision: dataRevision(c, scope) };
    },
  }),
  action({
    name: 'save_pipeline',
    description: 'Create a pipeline from editable stage suggestions (client work, introductions or blank), or rename or archive one. Archiving keeps opportunities and their follow-ups. Pipeline structure is the owner\'s choice.',
    input: z.object({ id: idSchema.optional(), expectedRevision: z.number().int().min(0).optional(), name: z.string().max(120).optional(), template: z.enum(['client_work', 'introductions', 'blank']).optional(), stages: z.array(stageInput.omit({ id: true })).max(20).optional(), collection: collectionKeySchema.optional(), archived: z.boolean().optional() }).strict(),
    output: writeResult(pipelineSchema),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { name: 'Client work', template: 'client_work' }, output: { status: 'saved', record: { ...PIPELINE, opportunityCount: 0, stages: PIPELINE.stages.map((stage) => ({ ...stage, count: 0 })) } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.mutate(invocation, 'save_pipeline', input, () => {
        const result = savePipeline(c, scope, input);
        const record = projectPipeline(c, scope, getPipelineRow(c, scope, result.id)!);
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'save_pipeline_stages',
    description: 'Rename, add, reorder or remove stages by stable ID with one revision check. A stage holding opportunities can only be removed with a replacement stage, and each move is recorded in stage history.',
    input: z.object({ pipelineId: idSchema, expectedRevision: z.number().int().min(0), stages: z.array(stageInput).min(1).max(20), replacements: z.array(z.object({ stageId: idSchema, replacementStageId: idSchema }).strict()).max(20).optional() }).strict(),
    output: writeResult(pipelineSchema),
    audience: ['user'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { pipelineId: ID.pipeline, expectedRevision: 1, stages: [{ id: ID.stageExploring, label: 'Exploring', kind: 'open' }, { id: ID.stageProposal, label: 'Proposal sent', kind: 'open' }, { id: ID.stageWon, label: 'Won', kind: 'succeeded' }] }, output: { status: 'saved', record: { ...PIPELINE, revision: 2, stages: PIPELINE.stages.map((stage) => stage.id === ID.stageProposal ? { ...stage, label: 'Proposal sent' } : stage) } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      requireOwner(scope);
      return c.mutate(invocation, 'save_pipeline_stages', input, () => {
        const result = savePipelineStages(c, scope, actor(invocation), invocation.id, input);
        const record = projectPipeline(c, scope, getPipelineRow(c, scope, result.id)!);
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'list_opportunities',
    description: 'Opportunities for a board or table, filtered by pipeline, stage, company, person or text, with the same query for both layouts. Values are shown per opportunity in their own currency and never added together.',
    input: z.object({ ...listInput, filters: opportunityFiltersSchema.optional(), sort: sortSchema.optional(), viewId: idSchema.optional() }).strict(),
    output: listOutput(opportunitySummarySchema, { total: z.number().int().min(0) }),
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { limit: 100, filters: { pipelineId: ID.pipeline } }, output: { items: [OPPORTUNITY], nextCursor: null, coverage: COVERAGE, revision: 'o12', total: 1 } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      let filters = input.filters ?? {}, sort = input.sort ?? DEFAULT_SORT.opportunity;
      if (input.viewId) {
        const view = getView(c, scope, input.viewId);
        if (!view || view.recordKind !== 'opportunity') throw new AppError('not_found', 'That view is no longer available');
        filters = { ...(view.filters as typeof filters), ...filters }; sort = input.sort ?? view.sort;
      }
      const result = listOpportunities(c, scope, { cursor: input.cursor, limit: input.limit, filters, sort });
      return { ...result, coverage: coverageFor(c, scope, granted(invocation)), revision: dataRevision(c, scope) };
    },
  }),
  action({
    name: 'get_opportunity',
    description: 'Read one opportunity with its stages, append-only stage history, notes, evidence-backed stage suggestions and linked activity.',
    input: z.object({ id: idSchema }).strict(),
    output: opportunityDetailSchema,
    audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: READ_ERRORS,
    examples: [{ input: { id: ID.opportunity }, output: { opportunity: { ...OPPORTUNITY, collection: 'manual', pipelineName: 'Client work' }, stages: PIPELINE.stages, history: [{ id: '0194d7a0-0000-7000-8000-000000004101', at: T.now, fromStage: null, toStage: 'Proposal', fromPipeline: null, toPipeline: 'Client work', actor: 'You', reason: 'Created', evidenceId: null }], notes: [], suggestions: [], activity: [], revision: 'o12' } }],
    handler(input, invocation) {
      const c = ctx(), scope = readScope(invocation);
      return getOpportunityDetail(c, scope, input.id);
    },
  }),
  action({
    name: 'save_opportunity',
    description: 'Create an opportunity in a pipeline, or edit its title, company, people, next action, target date, value or archive state. Value and currency are both set or both absent. Use move_opportunity to change stage or pipeline.',
    input: z.object({
      id: idSchema.optional(), expectedRevision: z.number().int().min(0).optional(), title: z.string().max(300).optional(), pipelineId: idSchema.optional(), stageId: idSchema.optional(),
      organizationId: idSchema.nullable().optional(), personIds: z.array(idSchema).max(20).optional(), targetDate: localDateSchema.nullable().optional(), value: moneySchema.nullable().optional(),
      nextAction: z.string().max(300).nullable().optional(), nextActionDate: localDateSchema.nullable().optional(), collection: collectionKeySchema.optional(), archived: z.boolean().optional(),
    }).strict(),
    output: writeResult(opportunitySummarySchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { title: 'Onboarding project', pipelineId: ID.pipeline, stageId: ID.stageProposal, organizationId: ID.fieldwork, personIds: [ID.jordan], nextAction: 'Send revised proposal', nextActionDate: '2026-10-16', value: { minor: 800000, currency: 'USD' } }, output: { status: 'saved', record: OPPORTUNITY } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'save_opportunity', input, () => {
        const result = saveOpportunity(c, scope, actor(invocation), invocation.id, { ...input, personIds: input.personIds?.map((id) => resolvePersonId(c, id)) });
        const record = summarizeOpportunity(c, scope, getOpportunityRow(c, scope, result.id)!);
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
  action({
    name: 'move_opportunity',
    description: 'Move an opportunity to a stage by stable stage ID, optionally into another pipeline with a destination stage. The revision check stops concurrent moves. History records who moved it and when. Moving never sends a message or completes a task.',
    input: z.object({ id: idSchema, expectedRevision: z.number().int().min(0), stageId: idSchema, pipelineId: idSchema.optional(), suggestionId: idSchema.optional() }).strict(),
    output: writeResult(opportunitySummarySchema),
    audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: WRITE_ERRORS,
    examples: [{ input: { id: ID.opportunity, expectedRevision: 3, stageId: ID.stageWon }, output: { status: 'saved', record: { ...OPPORTUNITY, revision: 4, stageId: ID.stageWon, stageLabel: 'Won', stageKind: 'succeeded', closed: true } } }],
    handler(input, invocation) {
      const c = ctx(), scope = writeScope(invocation);
      return c.mutate(invocation, 'move_opportunity', input, () => {
        const result = moveOpportunity(c, scope, actor(invocation), invocation.id, input);
        const record = summarizeOpportunity(c, scope, getOpportunityRow(c, scope, result.id)!);
        return result.status === 'conflict' ? { status: 'conflict' as const, current: record, message: result.message ?? 'Changed' } : { status: 'saved' as const, record };
      });
    },
  }),
];
export { projectView };
