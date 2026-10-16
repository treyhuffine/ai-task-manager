/**
 * Ri follow-ups. The link row and its operation ID are saved first, then Ri's
 * create_task runs with that operation ID, so a retry or a second click
 * always returns the same task. There is no task engine in this app.
 */
import { AppError } from '@ri/app-kit/contract';
import { allows, newId, redact, transaction, type AccessScope } from '@ri/app-kit/data';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { z } from 'zod/v4';
import { MANUAL_SOURCE, type FollowUp } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { opt, str, type Row } from './util.js';

export function followUpRecord(row: Row): FollowUp {
  return {
    id: str(row.id), operationId: str(row.operation_id), opportunityId: opt(row.opportunity_id), interviewId: opt(row.interview_id), title: str(row.title), dueAt: opt(row.due_at),
    taskId: opt(row.task_id), state: str(row.state) as FollowUp['state'], lastError: opt(row.last_error), createdAt: str(row.created_at),
  };
}

export interface FollowUpInput {
  subject: { type: 'opportunity' | 'interview'; id: string };
  title: string;
  dueAt?: string | null;
  description?: string | null;
  operationId: string;
}

/** Step one, inside the invocation's write: the durable link with its operation ID. */
export function reserveFollowUp(input: FollowUpInput, author: string): Row {
  const { db } = app();
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM follow_up_links WHERE operation_id = ?').get(input.operationId);
    if (existing) return existing;
    let opportunityId: string, interviewId: string | null = null;
    if (input.subject.type === 'interview') {
      const interview = db.prepare('SELECT id, opportunity_id FROM interviews WHERE id = ?').get(input.subject.id);
      if (!interview) throw new AppError('not_found', 'This interview is not available');
      interviewId = str(interview.id);
      opportunityId = str(interview.opportunity_id);
    } else {
      if (!db.prepare('SELECT 1 FROM opportunities WHERE id = ?').get(input.subject.id)) throw new AppError('not_found', 'This opportunity is not available');
      opportunityId = input.subject.id;
    }
    const id = newId(), time = nowAt();
    db.prepare(`INSERT INTO follow_up_links (id, created_at, updated_at, operation_id, opportunity_id, interview_id, title, due_at, task_id, state, last_error, created_by, source_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, ?, ?)`).run(id, time, time, input.operationId, opportunityId, interviewId, input.title.trim().slice(0, 500), input.dueAt ?? null, author, MANUAL_SOURCE);
    bumpRevision();
    return db.prepare('SELECT * FROM follow_up_links WHERE id = ?').get(id)!;
  });
}

const taskResult = z.object({ id: z.string().min(1).max(128) }).passthrough();

/** Step two: ask Ri for the task with the saved operation ID, then remember its ID. */
export async function createLinkedTask(invocation: AppInvocation, link: Row, description: string | null): Promise<Row> {
  const { db } = app();
  if (link.task_id) return link;
  try {
    const task = taskResult.parse(await invocation.capability('create_task', {
      title: str(link.title),
      ...(description ? { description: description.slice(0, 4000) } : {}),
      ...(link.due_at ? { dueAt: str(link.due_at) } : {}),
      operationId: str(link.operation_id),
    }));
    db.prepare("UPDATE follow_up_links SET task_id = ?, state = 'created', last_error = NULL, updated_at = ? WHERE id = ?").run(task.id, nowAt(), str(link.id));
  } catch (error) {
    const code = (error as AppError)?.code;
    const message = code === 'forbidden' || code === 'unsupported' ? 'Ri tasks are not allowed for this app yet. Allow them in Sources, then try again' : redact(error);
    db.prepare("UPDATE follow_up_links SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?").run(message, nowAt(), str(link.id));
    bumpRevision();
    throw new AppError(code === 'forbidden' || code === 'unsupported' ? 'forbidden' : code ?? 'app_failed', message);
  }
  bumpRevision();
  return db.prepare('SELECT * FROM follow_up_links WHERE id = ?').get(str(link.id))!;
}

export function followUpRows(scope: AccessScope, filter: { opportunityId?: string; interviewId?: string }): Row[] {
  if (!allows(scope, MANUAL_SOURCE)) return [];
  const db = app().db;
  if (filter.interviewId) return db.prepare('SELECT * FROM follow_up_links WHERE interview_id = ? ORDER BY created_at DESC LIMIT 50').all(filter.interviewId);
  if (filter.opportunityId) return db.prepare('SELECT * FROM follow_up_links WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 50').all(filter.opportunityId);
  return db.prepare('SELECT * FROM follow_up_links ORDER BY created_at DESC LIMIT 50').all();
}

const taskStatus = z.object({ id: z.string(), title: z.string().optional(), status: z.string().optional() }).passthrough();
/** Whether each linked Ri task still exists, checked live and never cached. */
export async function taskAvailability(invocation: AppInvocation, rows: Row[]): Promise<Map<string, { available: boolean; status: string | null; title: string | null; reason: string | null }>> {
  const result = new Map<string, { available: boolean; status: string | null; title: string | null; reason: string | null }>();
  for (const row of rows.slice(0, 20)) {
    const taskId = opt(row.task_id);
    if (!taskId) continue;
    try {
      const task = taskStatus.parse(await invocation.capability('get_task', { id: taskId }));
      result.set(str(row.id), { available: true, status: task.status ?? null, title: task.title ?? null, reason: null });
    } catch (error) {
      const code = (error as AppError)?.code;
      result.set(str(row.id), { available: false, status: null, title: null, reason: code === 'not_found' ? 'This Ri task was deleted' : code === 'forbidden' || code === 'unsupported' ? 'Allow Ri tasks in Sources to check this task' : 'Ri could not check this task right now' });
    }
  }
  return result;
}
