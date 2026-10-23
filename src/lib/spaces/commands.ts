/**
 * Changing a shared task from My Ri (docs/homes-spec.md §9.3-§9.4, P7.3).
 *
 * Its shared fields and its status are the team's, so each change is an
 * online command to the team, as this person's member, and My Ri's row then
 * shows what the team says. The checks are the team's own: a body names the
 * revision it edited and a stale one is refused with the team's current text,
 * a status change carries an idempotency key and the status it saw. A change
 * whose outcome is unknown is reconciled, never applied twice: a body the
 * team already holds is success, and a status command replays by its key.
 * A team out of reach is an outage (503), so the editor keeps the text and
 * retries. Nothing is written offline, and private planning never leaves.
 */

import fs from 'node:fs';
import path from 'node:path';
import { TRPCClientError } from '@trpc/client';
import { TRPCError } from '@trpc/server';
import { uuidv7 } from 'uuidv7';
import * as q from '@/lib/db/queries';
import type { Attachment, EntityVersionSource, SharedTaskSource, TaskRecord } from '@/db/types';
import { TaskLifecycleError, isTaskLifecycleError, type TransitionCommand } from '@/lib/tasks/lifecycle';
import { OperationError } from '@/lib/server/operation';
import { getAttachmentsDir } from '@/lib/config/paths';
import { replaceAttachmentReferences } from '@/lib/attachments/derive';
import { validateWorkResultAttachments } from '@/lib/work-results/queries';
import { ActionError } from '@/lib/orchestrator/types';
import type { PublishedResult } from '@/lib/team/published-results';
import { assertCurrentTeam, recordTeamFailure, teamFor, type ConnectedTeam } from './connect';
import { teamRequest } from './remote';
import { bodyForDocument, bodyForTeam } from './document';
import { sharedFields, type TeamTask } from './sync';

/** What My Ri can change of a shared task's own content. */
export const SHARED_EDITABLE_FIELDS = ['title', 'description', 'body', 'outcome', 'hardDeadline', 'attachments'] as const;
export interface SharedTaskPatch {
  title?: string;
  description?: string | null;
  body?: string | null;
  outcome?: string | null;
  hardDeadline?: string | null;
  /** Files stored at the team, named by a body the team holds. */
  attachments?: Attachment[] | null;
}

/** A patch, split into what goes to the team and what stays here. */
export function splitSharedTaskPatch<T extends Record<string, unknown>>(patch: T): { shared: SharedTaskPatch; personal: Partial<T> } {
  const shared: SharedTaskPatch = {};
  const personal: Partial<T> = {};
  for (const [key, value] of Object.entries(patch)) {
    if ((SHARED_EDITABLE_FIELDS as readonly string[]).includes(key)) (shared as Record<string, unknown>)[key] = value;
    else (personal as Record<string, unknown>)[key] = value;
  }
  return { shared, personal };
}

function unreachable(message: string): TRPCError {
  return new TRPCError({ code: 'SERVICE_UNAVAILABLE', message, cause: new OperationError(503, { error: 'team_unreachable', message }) });
}

async function connectedTeam(task: TaskRecord) {
  if (!task.sourceTeamId || !task.sourceTaskId) throw new q.TeamError('invalid', "That isn't a shared task.");
  if (task.sourceState === 'unavailable') throw new q.TeamError('not_found', "This task is no longer at its team. Your private planning is kept.");
  const team = await teamFor(task.sourceTeamId);
  if (!team) throw unreachable("This task's team isn't connected to My Ri. Your private planning is kept.");
  return team;
}

/** The team's refusals keep their meaning. Anything that can't reach the team is an outage. */
function teamFailure(team: ConnectedTeam, err: unknown): never {
  if (err instanceof q.TeamError || isTaskLifecycleError(err)) throw err;
  const data = err instanceof TRPCClientError ? (err.data as { domainCode?: string | null } | undefined) : undefined;
  const code = data?.domainCode;
  const known: q.TeamErrorCode[] = ['invalid', 'expired', 'used', 'revoked', 'not_allowed', 'conflict', 'not_found'];
  if (code && known.includes(code as q.TeamErrorCode)) throw new q.TeamError(code as q.TeamErrorCode, (err as Error).message);
  const problem = recordTeamFailure(team.connection.id, err, team);
  if (problem) throw unreachable(`${problem.message} Your change is kept and will be sent when ${team.connection.name} is back.`);
  throw err;
}

/** Show what the team now says, keeping the private planning and why it's here. */
async function refresh(local: TaskRecord, task: TeamTask, team: ConnectedTeam): Promise<TaskRecord> {
  assertCurrentTeam(team);
  local = q.getTask(local.id) ?? local;
  const memberId = team.connection.memberId;
  const previous = local.source;
  let area = task.areaId ? { id: task.areaId, name: previous?.area?.name ?? 'Unknown Area' } : null;
  if (task.areaId && previous?.area?.id !== task.areaId) {
    try { const current = await team.client.areas.get.query({ id: task.areaId }); area = { id: current.id, name: current.name }; }
    catch { /* Keep the last known name until the next sync resolves it. */ }
  }
  assertCurrentTeam(team);
  const now = new Date().toISOString();
  const source: SharedTaskSource = {
    assigned: task.assigneeMemberId === memberId,
    addedAt: previous?.addedAt ?? null,
    bodyRevision: task.bodyRevision,
    statusChangedCount: task.statusChangedCount,
    updatedAt: task.updatedAt,
    syncedAt: now,
    area,
    assignee: task.assigneeMemberId ? (previous?.assignee?.id === task.assigneeMemberId ? previous.assignee : { id: task.assigneeMemberId, name: 'Someone' }) : null,
  };
  return q.saveTaskProjection({
    teamId: local.sourceTeamId!,
    sourceTaskId: local.sourceTaskId!,
    fields: sharedFields(local.sourceTeamId!, task),
    source,
    state: source.assigned || source.addedAt ? 'active' : 'released',
  });
}

/**
 * Change a shared task's content at its team. A body names the team revision
 * it edited (`expectedBodyRevision`, from `source.bodyRevision`).
 */
export async function updateSharedTask(local: TaskRecord, patch: SharedTaskPatch, guard: { expectedBodyRevision?: number; expectedSourceMemberId?: string } = {}, source: EntityVersionSource = 'human'): Promise<TaskRecord> {
  const team = await connectedTeam(local);
  if (guard.expectedSourceMemberId && guard.expectedSourceMemberId !== team.connection.memberId) throw new q.TeamError('not_allowed', 'The team sign-in changed. This draft is kept for its original author.');
  const teamId = local.sourceTeamId!;
  const toTeam: SharedTaskPatch = { ...patch };
  const writesBody = patch.body !== undefined;
  if (writesBody && patch.body != null) toTeam.body = bodyForTeam(patch.body, teamId);
  const expected = writesBody ? (guard.expectedBodyRevision ?? local.source?.bodyRevision ?? 0) : undefined;
  let updated: TeamTask;
  try {
    updated = (await team.client.tasks.update.mutate({
      id: local.sourceTaskId!,
      patch: toTeam,
      ...(source !== 'human' ? { actorSource: source } : {}),
      ...(expected !== undefined ? { expectedBodyRevision: expected } : {}),
    })) as TeamTask;
  } catch (err) {
    const data = err instanceof TRPCClientError ? (err.data as { domainCode?: string | null; details?: unknown } | undefined) : undefined;
    if (data?.domainCode === 'body_conflict' && data.details && typeof data.details === 'object') {
      const current = data.details as { body?: string | null; bodyRevision: number; updatedAt: string };
      // The team already holds exactly this text: an earlier send landed.
      if ((current.body ?? '') === (toTeam.body ?? '')) {
        return refresh(local, (await team.client.tasks.get.query({ id: local.sourceTaskId! })) as TeamTask, team);
      }
      throw new q.BodyRevisionConflictError('task', {
        id: local.id,
        body: bodyForDocument(current.body ?? '', teamId),
        bodyRevision: current.bodyRevision,
        updatedAt: current.updatedAt,
      });
    }
    teamFailure(team, err);
  }
  return refresh(local, updated, team);
}

/**
 * One change to a shared task from anywhere in My Ri, a person's editor or
 * their agent: the shared fields go to the team first, then the private
 * planning is written here. A refused shared change writes nothing.
 */
export async function updateTaskWithShared(
  local: TaskRecord,
  patch: Record<string, unknown>,
  meta: q.EntityVersionMeta,
  guard: { expectedBodyRevision?: number; expectedSourceMemberId?: string } = {},
): Promise<TaskRecord> {
  const { shared, personal } = splitSharedTaskPatch(patch);
  // Refuse a field neither side can take before anything is sent.
  if (Object.keys(personal).length) q.assertPrivateTaskPatch(personal);
  let row = Object.keys(shared).length ? await updateSharedTask(local, shared, guard, meta.source) : local;
  if (Object.keys(personal).length) row = q.updateTask(local.id, personal, meta) ?? row;
  return row;
}

/** A status command names the status count it saw here, which this row must still have. */
async function assertSeenStatus(team: ConnectedTeam, local: TaskRecord, expected: number | undefined, command: TransitionCommand | 'complete', idempotencyKey?: string) {
  if (expected === undefined || expected === local.statusChangedCount) return;
  // The first response can be lost after the home saved it, or a sync can
  // observe the remote change before retry. Check the team's ledger without
  // applying a new command before refusing a stale local count.
  if (idempotencyKey && await team.client.tasks.commandRecorded.query({ id: local.sourceTaskId!, idempotencyKey, command })) return;
  throw new TaskLifecycleError('conflict', "This task's status changed since it was read. Read it again and retry.", {
    from: local.status,
  });
}

function outcome(after: TaskRecord, result: Omit<q.LifecycleOutcome, 'task'>): q.LifecycleOutcome {
  return { ...result, task: after, statusChangedCount: after.statusChangedCount };
}

/** Move a shared task's status at its team. Retrying with the same key replays it. */
export async function transitionSharedTask(
  local: TaskRecord,
  command: TransitionCommand,
  opts: { idempotencyKey?: string; reason?: string; expectedStatusChangedCount?: number; source?: EntityVersionSource } = {},
): Promise<q.LifecycleOutcome> {
  const team = await connectedTeam(local);
  try {
    await assertSeenStatus(team, local, opts.expectedStatusChangedCount, command, opts.idempotencyKey);
    const result = await team.client.tasks.transition.mutate({
      id: local.sourceTaskId!,
      command,
      ...(opts.source && opts.source !== 'human' ? { actorSource: opts.source } : {}),
      idempotencyKey: opts.idempotencyKey ?? uuidv7(),
      expectedStatusChangedCount: local.source?.statusChangedCount,
      ...(opts.reason ? { reason: opts.reason } : {}),
    });
    const task = (result as { task: TeamTask; replayed?: boolean }).task;
    return outcome(await refresh(local, task, team), result);
  } catch (err) {
    teamFailure(team, err);
  }
}

/**
 * Complete a shared task at its team. Its private subtasks and running work
 * here are left as they are: shared completion completes nothing private.
 */
export async function completeSharedTask(
  local: TaskRecord,
  opts: { idempotencyKey?: string; note?: string; expectedStatusChangedCount?: number; source?: EntityVersionSource } = {},
): Promise<q.LifecycleOutcome> {
  const team = await connectedTeam(local);
  try {
    await assertSeenStatus(team, local, opts.expectedStatusChangedCount, 'complete', opts.idempotencyKey);
    const result = await team.client.tasks.complete.mutate({
      id: local.sourceTaskId!,
      ...(opts.source && opts.source !== 'human' ? { actorSource: opts.source } : {}),
      idempotencyKey: opts.idempotencyKey ?? uuidv7(),
      expectedStatusChangedCount: local.source?.statusChangedCount,
      ...(opts.note ? { note: opts.note } : {}),
    });
    const task = (result as { task: TeamTask; replayed?: boolean }).task;
    return outcome(await refresh(local, task, team), result);
  } catch (err) {
    teamFailure(team, err);
  }
}

// ─── Publish result (§9.5) ────────────────────────────────────

export interface PublishSharedResultInput {
  /** One per Publish, kept across retries. */
  requestId: string;
  summary?: string | null;
  link?: { label: string; url: string } | null;
  /** This person's files in My Ri, copied to the team only when published. */
  personalAttachments?: Attachment[];
  /** Files already stored at the team, uploaded while choosing. */
  teamAttachments?: Attachment[];
}

const FILE_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

/** Store a copy of one of this person's files at the team, as their member. */
export async function copyToTeam(team: NonNullable<Awaited<ReturnType<typeof teamFor>>>, file: Attachment, requestId?: string): Promise<Attachment> {
  validateWorkResultAttachments('', [file], 'local');
  if (!FILE_NAME.test(file.fileName)) throw new q.TeamError('invalid', 'That file is not one of your uploads.');
  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(path.join(getAttachmentsDir(), file.fileName));
  } catch {
    throw new q.TeamError('not_found', `${file.originalName} is no longer in My Ri.`);
  }
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: file.mimeType }), file.originalName);
  const res = await teamRequest(`${team.connection.url}/api/attachments`, { method: 'POST', body: form, token: team.token, teamName: team.connection.name, headers: requestId ? { 'x-ri-upload-id': JSON.stringify([requestId, file.fileName]) } : undefined });
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) throw new ActionError('conflict', `${team.connection.name} could not take ${file.originalName} right now. Retry with the same publication ID.`, undefined, { retryable: true });
    const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new q.TeamError('invalid', error ? `${team.connection.name} didn't take ${file.originalName}: ${error}` : `${team.connection.name} didn't take ${file.originalName}.`);
  }
  return (await res.json()) as Attachment;
}

/**
 * Publish a result to a shared task's team: only what the person chose, a
 * summary, a link or files. Their conversation, agent, private planning and
 * local paths stay here, and the task's status doesn't change.
 */
export async function publishSharedTaskResult(local: TaskRecord, input: PublishSharedResultInput): Promise<PublishedResult> {
  const team = await connectedTeam(local);
  try {
    validateWorkResultAttachments('', input.personalAttachments ?? [], 'local');
    const copied: Attachment[] = [];
    const names = new Map<string, string>();
    for (const file of input.personalAttachments ?? []) {
      assertCurrentTeam(team);
      const copy = await copyToTeam(team, file, input.requestId);
      copied.push(copy);
      names.set(file.fileName, copy.fileName);
    }
    assertCurrentTeam(team);
    const { result } = await team.client.tasks.publishResult.mutate({
      taskId: local.sourceTaskId!,
      requestId: input.requestId,
      summary: input.summary != null ? replaceAttachmentReferences(input.summary, names) : null,
      links: input.link ? [input.link] : [],
      attachments: [...copied, ...(input.teamAttachments ?? [])],
    });
    return result;
  } catch (err) {
    if (err instanceof ActionError) throw new q.TeamError(err.code === 'not_found' ? 'not_found' : 'invalid', err.message);
    if (err instanceof q.TeamError) throw err;
    teamFailure(team, err);
  }
}

/** What a shared task's team has had published to it, newest first. */
export async function sharedTaskPublishedResults(local: TaskRecord): Promise<PublishedResult[]> {
  const team = await connectedTeam(local);
  try {
    return await team.client.tasks.publishedResults.query({ taskId: local.sourceTaskId! });
  } catch (err) {
    teamFailure(team, err);
  }
}
