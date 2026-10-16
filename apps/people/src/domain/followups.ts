import { AppError } from '@ri/app-kit/contract';
import { redact, type AccessScope } from '@ri/app-kit/data';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { z } from 'zod/v4';
import { iso, newId, type Ctx } from './context.js';
import { organizationVisible, personVisible } from './projection.js';
import { canSee, canSeeOpportunity, touch, writableCollection } from './scope.js';
import { cleanText, isLocalDate } from './text.js';
import { projectTaskLink } from './commitments.js';
import type { TaskLink } from '../schemas.js';

export interface FollowUpInput {
  subject: { kind: 'commitment' | 'person' | 'organization' | 'opportunity'; id: string };
  title: string;
  dueAt?: string | null;
  description?: string | null;
  operationId?: string;
  collection?: string;
  existingTaskId?: string;
}

function subjectCollection(ctx: Ctx, scope: AccessScope, subject: FollowUpInput['subject']): string | null {
  switch (subject.kind) {
    case 'person': if (!personVisible(ctx, scope, subject.id)) throw new AppError('not_found', 'This person is no longer available'); return null;
    case 'organization': if (!organizationVisible(ctx, scope, subject.id)) throw new AppError('not_found', 'This company is no longer available'); return null;
    case 'commitment': {
      const row = ctx.db.get<{ source_key: string; state: string }>('SELECT source_key, state FROM commitments WHERE id = ?', subject.id);
      if (!row || !canSee(scope, row.source_key)) throw new AppError('not_found', 'This commitment is no longer available');
      return null;
    }
    case 'opportunity': {
      const row = ctx.db.get<{ collection: string; pipeline_id: string }>('SELECT collection, pipeline_id FROM opportunities WHERE id = ?', subject.id);
      if (!row || !canSeeOpportunity(ctx, scope, row)) throw new AppError('not_found', 'This opportunity is no longer available');
      return row.collection;
    }
  }
}

/**
 * Step one of a follow-up: persist the link with a durable operation ID before
 * Ri is asked for anything. A retry or a second click with the same operation
 * ID, or a commitment that already has a live task, returns the same link.
 */
export function prepareFollowUp(ctx: Ctx, scope: AccessScope, input: FollowUpInput, actor: string): { link: TaskLink; created: boolean } {
  const title = cleanText(input.title, 500);
  if (!title) throw new AppError('invalid_input', 'Enter a title for the follow-up');
  if (input.dueAt && !isLocalDate(input.dueAt) && Number.isNaN(Date.parse(input.dueAt))) throw new AppError('invalid_input', 'Use a real calendar date');
  if (input.operationId) {
    const existing = ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE operation_id = ?', input.operationId);
    if (existing) {
      if (existing.subject_kind !== input.subject.kind || existing.subject_id !== input.subject.id) throw new AppError('conflict', 'This operation belongs to a different follow-up');
      return { link: projectTaskLink(existing), created: false };
    }
  }
  const owned = subjectCollection(ctx, scope, input.subject);
  if (input.subject.kind === 'commitment') {
    const live = ctx.db.get<Record<string, unknown>>("SELECT * FROM task_links WHERE subject_kind = 'commitment' AND subject_id = ? AND status IN ('pending','linked','failed') ORDER BY created_at DESC LIMIT 1", input.subject.id);
    if (live) return { link: projectTaskLink(live), created: false };
  }
  const collection = writableCollection(ctx, scope, input.collection ?? owned ?? undefined);
  const time = iso(ctx), id = newId();
  ctx.db.run(
    `INSERT INTO task_links (id, created_at, updated_at, revision, subject_kind, subject_id, operation_id, title, due_at, collection, task_id, status, task_status, last_error, last_checked_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    id, time, time, input.subject.kind, input.subject.id, input.operationId ?? newId(), title, input.dueAt ?? null, collection,
    input.existingTaskId ?? null, input.existingTaskId ? 'linked' : 'pending',
  );
  if (input.subject.kind === 'commitment') {
    ctx.db.run("UPDATE commitments SET task_link_id = ?, state = CASE WHEN state = 'suggested' THEN 'accepted' ELSE state END, revision = revision + 1, updated_at = ? WHERE id = ?", id, time, input.subject.id);
    ctx.db.run('INSERT INTO commitment_history (id, created_at, updated_at, commitment_id, from_state, to_state, actor, note, evidence_id) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL)', newId(), time, time, input.subject.id, 'accepted', actor, input.existingTaskId ? 'Linked to an existing Ri task' : 'Ri follow-up chosen');
  }
  if (input.subject.kind === 'opportunity') ctx.db.run('UPDATE opportunities SET task_link_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?', id, time, input.subject.id);
  touch(ctx, collection);
  return { link: projectTaskLink(ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE id = ?', id)!), created: true };
}

const taskResult = z.object({ id: z.union([z.string(), z.number()]).transform(String) }).passthrough();

/**
 * Step two: ask Ri for the task with the persisted operation ID, then store
 * its ID. Ri returns the same task for the same operation ID, so a retry never
 * creates a second one. Failure is recorded and retried with the same ID.
 */
export async function completeFollowUp(ctx: Ctx, invocation: AppInvocation, linkId: string, description?: string | null): Promise<TaskLink> {
  const link = ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE id = ?', linkId);
  if (!link) throw new AppError('not_found', 'This follow-up is no longer available');
  if (link.status === 'linked' && link.task_id) return projectTaskLink(link);
  if (link.status === 'unavailable') return projectTaskLink(link);
  const dueAt = link.due_at ? String(link.due_at) : undefined;
  if (invocation.principal.kind === 'fixture') {
    // The fictional preview never creates a real Ri task. Its task stays fictional, keyed by the operation ID.
    ctx.db.tx(() => {
      ctx.db.run("UPDATE task_links SET task_id = ?, status = 'linked', task_status = 'todo', last_error = NULL, last_checked_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?", String(link.operation_id), iso(ctx), iso(ctx), linkId);
      touch(ctx, String(link.collection));
    });
    return projectTaskLink(ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE id = ?', linkId)!);
  }
  try {
    const raw = await invocation.capability('create_task', {
      title: String(link.title),
      ...(description ? { description: description.slice(0, 4000) } : {}),
      ...(dueAt ? { dueAt } : {}),
      operationId: String(link.operation_id),
    });
    const task = taskResult.parse(raw);
    ctx.db.tx(() => {
      ctx.db.run("UPDATE task_links SET task_id = ?, status = 'linked', last_error = NULL, last_checked_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?", task.id, iso(ctx), iso(ctx), linkId);
      touch(ctx, String(link.collection));
    });
  } catch (error) {
    const code = (error as AppError)?.code;
    const message = code === 'forbidden' ? 'Allow People to create Ri tasks in Sources, then try again'
      : code === 'unsupported' ? 'Ri tasks are unavailable here. Try again in Ri'
      : code === 'busy' || code === 'timeout' ? 'Ri was busy. Try again'
      : redact(error);
    ctx.db.tx(() => {
      ctx.db.run("UPDATE task_links SET status = 'failed', last_error = ?, revision = revision + 1, updated_at = ? WHERE id = ?", message, iso(ctx), linkId);
      touch(ctx, String(link.collection));
    });
  }
  return projectTaskLink(ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE id = ?', linkId)!);
}

const taskStatusSchema = z.object({ status: z.string().optional(), completedAt: z.string().nullable().optional(), deletedAt: z.string().nullable().optional(), archivedAt: z.string().nullable().optional() }).passthrough();

/**
 * Refresh what Ri says about linked tasks. Ri owns task status: a missing task
 * is shown as unavailable and never recreated. Closing an opportunity or
 * completing a commitment never completes its task.
 */
export async function checkFollowUps(ctx: Ctx, invocation: AppInvocation, scope: AccessScope, ids: string[]) {
  const results: TaskLink[] = [];
  for (const id of ids.slice(0, 50)) {
    const link = ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE id = ?', id);
    if (!link || !canSee(scope, String(link.collection)) || !link.task_id) continue;
    // Fictional preview tasks are not in Ri. Their saved state is the whole story.
    if (invocation.principal.kind === 'fixture') { results.push(projectTaskLink(link)); continue; }
    let status: string | null = null, availability: 'linked' | 'unavailable' = 'linked', error: string | null = null;
    try {
      const task = taskStatusSchema.parse(await invocation.capability('get_task', { id: String(link.task_id) }));
      status = task.deletedAt ? 'deleted' : task.completedAt ? 'done' : task.archivedAt ? 'archived' : task.status ?? null;
      if (task.deletedAt) availability = 'unavailable';
    } catch (caught) {
      const code = (caught as AppError)?.code;
      if (code === 'not_found') availability = 'unavailable';
      else { error = code === 'forbidden' ? 'Allow People to read Ri tasks in Sources to see their status' : redact(caught); }
    }
    ctx.db.tx(() => {
      const time = iso(ctx);
      ctx.db.run('UPDATE task_links SET status = ?, task_status = COALESCE(?, task_status), last_error = ?, last_checked_at = ?, updated_at = ? WHERE id = ?', availability, status ? status.slice(0, 60) : null, error, time, time, id);
      if (availability !== link.status || (status && status !== link.task_status)) touch(ctx, String(link.collection));
    });
    results.push(projectTaskLink(ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE id = ?', id)!));
  }
  return results;
}

export function taskLinksFor(ctx: Ctx, scope: AccessScope, subjectKind: string, subjectId: string): TaskLink[] {
  return ctx.db.all<Record<string, unknown>>('SELECT * FROM task_links WHERE subject_kind = ? AND subject_id = ? ORDER BY created_at DESC LIMIT 30', subjectKind, subjectId)
    .filter((row) => canSee(scope, String(row.collection))).map(projectTaskLink);
}
