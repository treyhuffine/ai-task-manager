import { z } from 'zod/v4';
import { defineAction } from '@ri/app-kit/sdk';
import { AppError } from '@ri/app-kit/contract';
import { followUpSchema, id } from '../domain/model.js';
import { app } from '../server/state.js';
import { createLinkedTask, followUpRecord, followUpRows, reserveFollowUp, taskAvailability } from '../server/followups.js';
import { authorOf, EX, readScope, writeScope } from './common.js';

const dueAt = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/)]);
const exampleFollowUp = { id: EX.followUp, operationId: EX.operation, opportunityId: EX.opportunity, interviewId: null, title: 'Follow up with Lumen', dueAt: '2026-10-19', taskId: '0192f0aa-0000-7000-8000-00000000e001', state: 'created' as const, lastError: null, createdAt: '2026-10-15T09:00:00.000Z' };

export const createFollowUpAction = defineAction({
  name: 'create_follow_up',
  description: 'Create a Ri task linked to an opportunity or interview, with an optional due date. The link and its operation ID are saved first, so retrying or clicking twice returns the same task. Nothing is sent to anyone.',
  input: z.object({
    subject: z.object({ type: z.enum(['opportunity', 'interview']), id }).strict(),
    title: z.string().min(1).max(500),
    dueAt: dueAt.nullable().optional(),
    description: z.string().max(4000).optional(),
    operationId: z.string().uuid().optional(),
  }).strict(),
  output: z.object({ followUp: followUpSchema }).strict(),
  audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: ['invalid_input', 'forbidden', 'not_found', 'revoked'],
  examples: [{ input: { subject: { type: 'opportunity', id: EX.opportunity }, title: 'Follow up with Lumen', dueAt: '2026-10-19', operationId: EX.operation }, output: { followUp: exampleFollowUp } }],
  handler: async (input, invocation) => {
    writeScope(invocation);
    const author = authorOf(invocation);
    const operationId = input.operationId ?? invocation.id;
    const link = app().store.mutate(invocation, 'create_follow_up', input, () => reserveFollowUp({ ...input, operationId }, author));
    const fresh = app().db.prepare('SELECT * FROM follow_up_links WHERE id = ?').get(String(link.id));
    if (!fresh) throw new AppError('not_found', 'The follow-up link is not available');
    const created = await createLinkedTask(invocation, fresh, input.description ?? null);
    return { followUp: followUpRecord(created) };
  },
});

export const listFollowUpsAction = defineAction({
  name: 'list_follow_ups',
  description: 'List Ri follow-ups linked to opportunities or interviews, and check live whether each Ri task still exists and its status.',
  input: z.object({ opportunityId: id.optional(), interviewId: id.optional() }).strict(),
  output: z.object({ items: z.array(z.object({ followUp: followUpSchema, task: z.object({ available: z.boolean(), status: z.string().nullable(), title: z.string().nullable(), reason: z.string().nullable() }).strict().nullable() }).strict()) }).strict(),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: ['forbidden', 'revoked'],
  examples: [{ input: { opportunityId: EX.opportunity }, output: { items: [{ followUp: exampleFollowUp, task: { available: true, status: 'todo', title: 'Follow up with Lumen', reason: null } }] } }],
  handler: async (input, invocation) => {
    const rows = followUpRows(readScope(invocation), input);
    const tasks = await taskAvailability(invocation, rows);
    return { items: rows.map((row) => ({ followUp: followUpRecord(row), task: tasks.get(String(row.id)) ?? null })) };
  },
});

export const followUpActions = [createFollowUpAction, listFollowUpsAction];
