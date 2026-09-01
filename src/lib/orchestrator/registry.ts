/**
 * Starter action registry for the agent orchestrator.
 *
 * Every action here is a contract: param shape (Zod) + handler. The CLI and MCP
 * generators read this array and produce their respective surfaces. When you
 * add a new action, both show up automatically.
 *
 * Handlers dispatch through `src/lib/db/queries.ts` — never raw SQL — so every
 * write goes through the same invariants the web app does (embedding upsert,
 * markdown-mirror sync, attachment derivation).
 */

import fs from 'node:fs';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import { defineAction, ActionError, type ActionContext } from './types';
import { browserActions } from './browser-actions';
import {
  TASK_STATUSES,
  TRANSITION_COMMANDS,
  isTaskLifecycleError,
  LIFECYCLE_ERROR_ACTION_CODE,
} from '@/lib/tasks/lifecycle';
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  completeTask,
  transitionTask,
  attachExecutionToTask,
  detachExecutionFromTask,
  getTaskExecutions,
  reviewExecutionOutput,
  type LifecycleActorMeta,
  listNotes,
  getNote,
  createNote,
  updateNote,
  listStream,
  getStream,
  createStream,
  updateStream,
  dismissStream,
  listAreas,
  getArea,
  createArea,
  updateArea,
  getLatestDeck,
  getDeck,
  updateDeck,
  getUserState,
  updateUserState,
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  archiveWorkspace,
  createReferenceFolder,
  updateReferenceFolder,
  archiveReferenceFolder,
  getReferenceFolder,
  ReferenceFolderError,
  listChatSessions,
  searchChatSessions,
  listRailSessions,
  getChatSession,
  getAgent,
  listChatEvents,
  listTriggersWithLastRun,
  getTrigger,
  findTriggerByName,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  listRuns,
  getRun,
  markRunFailed,
  resetTriggerFailures,
  listNotificationChannels,
  getNotificationChannel,
  getOrCreateDefaultExecutor,
  getOrCreateDefaultOrchestrator,
  getStreamAutonomy,
  effectiveAutonomyLevel,
  proposeTriageDecisions,
  recordTriageDecisionAndApply,
  undoTriageDecision,
  firstLineTitle,
  TriageError,
  listBacklinks,
  listOutgoingLinks,
  type TriageDecisionInput,
} from '@/lib/db/queries';
import { stripHighlight } from '@/lib/search/highlight';
import { beginSweep, finishSweep } from '@/lib/stream-triage/sweep';
import { triageProposalSchema } from '@/lib/stream-triage/schema';
import { getTriageMetrics } from '@/lib/stream-triage/metrics';
import { onStreamCaptured } from '@/lib/stream-triage/triggers';
import { getNotifierUserId } from '@/lib/notifications/user';
import { detectIsGit, detectBaseBranch, defaultWorktreeRoot } from '@/lib/workspaces';
import { validateCronExpression, computeNextRun } from '@/lib/scheduler/cron';
import { generateWebhookCredentials } from '@/lib/triggers/webhook';
import { isReservedTrigger, RESERVED_LOCKED_FIELDS } from '@/lib/triggers/reserved';
import { resumeCommandForHarness } from '@/lib/agents/registry';
// `dispatchRun` and the executor `abort` transitively load `@agentex/agent`,
// which has no `require` condition in its package exports. Top-level imports
// here would crash `tsx src/cli/index.ts` (CJS resolution) on every CLI
// invocation — even `flow start --dev`, which doesn't need either symbol.
// Loading them lazily inside the two action handlers that use them lets the
// dev CLI boot under tsx and matches the actual call graph: `run_trigger`
// and `cancel_run` are the only paths that touch the executor.
import { inventorySkills } from '@/lib/executor/skills';
import { fetchLiveSignals, serverFetch } from './server-client';
import { condenseEvents, derivePendingFromEvents } from './session-oversight';
import { isSessionUnread } from '@/lib/utils/session-sort';
import { listResolvedReferenceFolders } from '@/lib/reference-folders/resolve';
import path from 'node:path';
import {
  getAppRoot,
  getBrainDir,
  getDbPath,
  getConfigPath,
  getAttachmentsDir,
  getTmpDir,
} from '@/lib/config/paths';

// ── Schema fragments ─────────────────────────────────────────────

// Read filters accept every canonical status plus the legacy `active` alias
// (expanded to todo|in_progress by the query layer during the compat window).
const taskStatusFilter = z.enum([...TASK_STATUSES, 'active']);
// Generic creation may only start a task as a possibility (Consider) or a
// commitment (Todo). In progress / Done / Archived are reached through the
// semantic lifecycle commands (start / complete / archive), never at creation.
const taskCreateStatus = z.enum(['consider', 'todo']);
const taskEnergy = z.enum(['deep', 'light']);
const taskEffort = z.enum(['trivial', 'small', 'medium', 'large', 'epic']);
const noteStatus = z.enum(['active', 'archived']);

/** Build a lifecycle actor meta from the action context provenance. */
function lifecycleActor(ctx: ActionContext): LifecycleActorMeta {
  return {
    source: ctx.actor?.source ?? (ctx.remote ? 'ai' : 'human'),
    actorSessionId: ctx.actor?.sessionId ?? null,
    executionId: ctx.actor?.executionId ?? null,
    runId: ctx.actor?.runId ?? null,
  };
}

/** Map a query-layer lifecycle error to the orchestrator envelope. */
function throwAsActionError(err: unknown): never {
  if (isTaskLifecycleError(err)) {
    throw new ActionError(LIFECYCLE_ERROR_ACTION_CODE[err.code], err.message);
  }
  throw err;
}

// Inputs mirror CreateTaskInput / CreateNoteInput but only expose the fields
// it's safe for an agent to set. Derived/audit columns (createdAt, updatedAt,
// timesDeferred, completedAt, sortKey) stay out of the contract.
const taskCreateShape = {
  title: z.string().min(1),
  description: z.string().optional(),
  body: z.string().optional(),
  areaId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  status: taskCreateStatus.optional(),
  energy: taskEnergy.nullable().optional(),
  effort: taskEffort.nullable().optional(),
  hardDeadline: z.string().nullable().optional(),
  reminderAt: z.string().nullable().optional(),
  recurrence: z.string().nullable().optional(),
  contextTags: z.array(z.string()).optional(),
  userContext: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
};

const noteCreateShape = {
  title: z.string().optional(),
  body: z.string().min(1),
  url: z.string().nullable().optional(),
  areaId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  status: noteStatus.optional(),
  contextTags: z.array(z.string()).optional(),
};

// ── Actions ──────────────────────────────────────────────────────

const describe_paths = defineAction({
  name: 'describe_paths',
  description:
    'Print the resolved on-disk paths the app uses (app root, brain dir, db, config). ' +
    'Reflects <APP>_ROOT / <APP>_BRAIN_PATH / <APP>_DB_PATH env overrides.',
  params: {},
  handler: () => ({
    appRoot: getAppRoot(),
    brainDir: getBrainDir(),
    dbPath: getDbPath(),
    configPath: getConfigPath(),
    attachmentsDir: getAttachmentsDir(),
    tmpDir: getTmpDir(),
    dbExists: fs.existsSync(getDbPath()),
  }),
});

const describe_schema = defineAction({
  name: 'describe_schema',
  description:
    'Return the Drizzle schema source as text. Read-only reference for agents ' +
    'proposing new actions. Lets an agent ground itself in the real column shape ' +
    'without arbitrary SQL access.',
  params: {},
  handler: () => {
    // schema.ts is a small, self-contained file bundled with the app source.
    // Path derived from this module's location so it works from any cwd.
    const schemaPath = require.resolve('@/lib/db/schema');
    const src = fs.readFileSync(schemaPath, 'utf8');
    return { path: schemaPath, source: src };
  },
});

const list_tasks_action = defineAction({
  name: 'list_tasks',
  description: 'List tasks with optional filters (status, area, parent, energy, text search).',
  params: {
    status: z.union([taskStatusFilter, z.array(taskStatusFilter)]).optional(),
    areaId: z.string().nullable().optional(),
    parentId: z.string().nullable().optional(),
    energy: taskEnergy.optional(),
    q: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
    orderBy: z
      .enum(['sortKey', 'lastViewedAt', 'hardDeadline', 'createdAt', 'updatedAt'])
      .optional(),
  },
  handler: (_ctx, input) => listTasks(input),
});

const get_task_action = defineAction({
  name: 'get_task',
  description: 'Fetch a single task by id.',
  params: { id: z.string().min(1) },
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const task = getTask(id);
    if (!task) throw new ActionError('not_found', `Task not found: ${id}`);
    return task;
  },
});

const create_task_action = defineAction({
  name: 'create_task',
  description: 'Create a task. Embeddings + markdown mirror are updated automatically.',
  params: taskCreateShape,
  mutating: true,
  handler: (_ctx, input) => createTask(input),
});

const update_task_action = defineAction({
  name: 'update_task',
  description:
    'Update a task by id (content and metadata only). All fields optional; unspecified fields keep their value. ' +
    'Lifecycle status is NOT settable here — use transition_task (move_to_todo / move_to_consider / start / return_to_todo / reopen / archive / restore) or complete_task, so history, idempotency, and invariants hold.',
  params: {
    id: z.string().min(1),
    // `status` is intentionally excluded — generic updates never change
    // lifecycle. Any status a caller sends is dropped by Zod (unknown key).
    ...Object.fromEntries(
      Object.entries(taskCreateShape)
        .filter(([k]) => k !== 'status')
        .map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ),
  } as Omit<typeof taskCreateShape, 'status'> & { id: z.ZodString },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (ctx, input) => {
    const { id, ...rest } = input as { id: string } & Partial<z.infer<z.ZodObject<typeof taskCreateShape>>>;
    // Edits through the agent surface (CLI/MCP) are attributed to the agent
    // so the in-document chat can surface a reviewable diff + one-tap undo.
    const row = updateTask(id, rest, { source: ctx.actor?.source ?? 'ai' });
    if (!row) throw new ActionError('not_found', `Task not found: ${id}`);
    return row;
  },
});

const complete_task_action = defineAction({
  name: 'complete_task',
  description:
    'Complete a task (its outcome happened and was accepted). Records one completion. Recurring tasks advance to the next occurrence and return to Todo instead of closing. A completed agent run alone never completes a task. Safe under retry when given the same idempotency_key.',
  params: {
    id: z.string().min(1),
    note: z.string().optional(),
    idempotency_key: z.string().min(1).optional(),
    expected_status_changed_count: z.number().int().nonnegative().optional(),
    stop_owning_executions: z.boolean().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (ctx, { id, note, idempotency_key, expected_status_changed_count, stop_owning_executions }) => {
    try {
      const result = completeTask(id, {
        note,
        idempotencyKey: idempotency_key,
        expectedStatusChangedCount: expected_status_changed_count,
        stopOwningExecutions: stop_owning_executions,
        meta: lifecycleActor(ctx),
      });
      if (!result) throw new ActionError('not_found', `Task not found: ${id}`);
      return result;
    } catch (err) {
      if (err instanceof ActionError) throw err;
      throwAsActionError(err);
    }
  },
});

const transition_task_action = defineAction({
  name: 'transition_task',
  description:
    'Apply a semantic task lifecycle transition. Commands: move_to_todo (Consider->Todo, commit), move_to_consider (Todo->Consider, uncommit; rejected while the task has a deadline/recurrence/blocker/live execution), start (Consider|Todo->In progress), return_to_todo (In progress->Todo), reopen (Done->Todo), archive (Consider|Todo|In progress->Archived), restore (Archived->Todo). Use complete_task to finish. Safe under retry with the same idempotency_key; pass expected_status_changed_count for conflict detection.',
  params: {
    id: z.string().min(1),
    command: z.enum(TRANSITION_COMMANDS),
    idempotency_key: z.string().min(1).optional(),
    expected_status_changed_count: z.number().int().nonnegative().optional(),
    stop_owning_executions: z.boolean().optional(),
    reason: z.string().optional(),
  },
  mutating: true,
  cli: { positional: ['id', 'command'] },
  handler: (ctx, { id, command, idempotency_key, expected_status_changed_count, stop_owning_executions, reason }) => {
    try {
      return transitionTask({
        taskId: id,
        command,
        idempotencyKey: idempotency_key ?? uuidv7(),
        expectedStatusChangedCount: expected_status_changed_count,
        stopOwningExecutions: stop_owning_executions,
        meta: { ...lifecycleActor(ctx), reason: reason ?? null },
      });
    } catch (err) {
      throwAsActionError(err);
    }
  },
});

const attach_execution_to_task_action = defineAction({
  name: 'attach_execution_to_task',
  description:
    'Record that an execution is doing a task (ownership). Many-to-many: an execution may own several tasks (a batch with shared context) and a task may be worked by several executions. Idempotent, never a conflict. This links, it does not start: use transition_task start to move the task to In progress.',
  params: {
    execution_id: z.string().min(1),
    task_id: z.string().min(1),
  },
  mutating: true,
  cli: { positional: ['execution_id', 'task_id'] },
  handler: (_ctx, { execution_id, task_id }) => {
    try {
      return attachExecutionToTask(execution_id, task_id);
    } catch (err) {
      throwAsActionError(err);
    }
  },
});

const detach_execution_from_task_action = defineAction({
  name: 'detach_execution_from_task',
  description: 'Remove an execution↔task ownership link. Does not change the task lifecycle or the execution.',
  params: {
    execution_id: z.string().min(1),
    task_id: z.string().min(1),
  },
  mutating: true,
  cli: { positional: ['execution_id', 'task_id'] },
  handler: (_ctx, { execution_id, task_id }) => ({ removed: detachExecutionFromTask(execution_id, task_id) }),
});

const list_task_executions_action = defineAction({
  name: 'list_task_executions',
  description: 'List the executions owning a task, newest first.',
  params: { task_id: z.string().min(1) },
  cli: { positional: ['task_id'] },
  handler: (_ctx, { task_id }) => getTaskExecutions(task_id),
});

const review_execution_action = defineAction({
  name: 'review_execution',
  description:
    'Record a review disposition against an exact agent output event: accepted, changes_requested, or dismissed. Reading output is NOT review. New output after the last reviewed output creates a fresh obligation. To accept and finish the task in one step, review accepted then complete_task.',
  params: {
    execution_id: z.string().min(1),
    output_event_id: z.string().min(1),
    disposition: z.enum(['accepted', 'changes_requested', 'dismissed']),
    note: z.string().optional(),
  },
  mutating: true,
  cli: { positional: ['execution_id', 'output_event_id', 'disposition'] },
  handler: (ctx, { execution_id, output_event_id, disposition, note }) => {
    try {
      return reviewExecutionOutput({
        executionId: execution_id,
        outputEventId: output_event_id,
        disposition,
        actorSource: ctx.actor?.source ?? (ctx.remote ? 'ai' : 'human'),
        actorSessionId: ctx.actor?.sessionId ?? null,
        note,
      });
    } catch (err) {
      throwAsActionError(err);
    }
  },
});

const list_notes_action = defineAction({
  name: 'list_notes',
  description: 'List notes with optional filters (area, linked task, status).',
  params: {
    areaId: z.string().nullable().optional(),
    taskId: z.string().nullable().optional(),
    status: noteStatus.optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
    orderBy: z.enum(['lastViewedAt', 'createdAt', 'updatedAt']).optional(),
  },
  handler: (_ctx, input) => listNotes(input),
});

const get_note_action = defineAction({
  name: 'get_note',
  description: 'Fetch a single note by id.',
  params: { id: z.string().min(1) },
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const note = getNote(id);
    if (!note) throw new ActionError('not_found', `Note not found: ${id}`);
    return note;
  },
});

const list_backlinks_action = defineAction({
  name: 'list_backlinks',
  description:
    'List the tasks and notes whose body links to a given task or note (backlinks). Reads the derived link index and repairs any pending sources first.',
  params: {
    entityType: z.enum(['task', 'note']),
    entityId: z.string().min(1),
  },
  handler: (_ctx, { entityType, entityId }) => listBacklinks(entityType, entityId),
});

const list_outgoing_links_action = defineAction({
  name: 'list_outgoing_links',
  description:
    'List the tasks and notes that a given task or note links to from its body, with unresolved (deleted) targets flagged.',
  params: {
    entityType: z.enum(['task', 'note']),
    entityId: z.string().min(1),
  },
  handler: (_ctx, { entityType, entityId }) => listOutgoingLinks(entityType, entityId),
});

const create_note_action = defineAction({
  name: 'create_note',
  description: 'Create a note. Embeddings + markdown mirror are updated automatically.',
  params: noteCreateShape,
  mutating: true,
  handler: (_ctx, input) => createNote(input),
});

const update_note_action = defineAction({
  name: 'update_note',
  description:
    'Update a note by id. All fields optional. Unspecified fields keep their value. ' +
    'Set status=archived instead of deleting. There is no delete action by design.',
  params: {
    id: z.string().min(1),
    ...Object.fromEntries(
      Object.entries(noteCreateShape).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ),
  } as typeof noteCreateShape & { id: z.ZodString },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input as { id: string } & Partial<z.infer<z.ZodObject<typeof noteCreateShape>>>;
    // Agent-surface edits are attributed to the agent (see update_task).
    const row = updateNote(id, rest, { source: 'ai' });
    if (!row) throw new ActionError('not_found', `Note not found: ${id}`);
    return row;
  },
});

// ── Stream ────────────────────────────────────────────────────
//
// The capture ledger + its reconciliation surface. Every disposition
// (promote / merge / combine / journal / dismiss / incubate) flows through
// the triage query layer so provenance (stream_links), acceptance
// telemetry (triage_decisions), and undo are recorded uniformly.
//
// POLICY ENFORCEMENT LIVES HERE, NOT IN THE PROMPT: execute-actions called
// with a pass_id (a sweep) are downgraded to proposals when the
// disposition's autonomy level is 'suggest' — and the kill switch forces
// every remote (agent) call to propose. A confidently wrong agent cannot
// overstep. See docs/streaming-spec-tasks.md §3.5.

const streamStatus = z.enum(['pending', 'proposed', 'promoted', 'dismissed', 'reviewed', 'incubating']);

/** Map query-layer TriageError codes onto the action envelope. */
function rethrowTriage(err: unknown): never {
  if (err instanceof TriageError) throw new ActionError(err.code, err.message);
  throw err;
}

/**
 * The disposition chokepoint. Decides propose-vs-execute from autonomy
 * config and call context, then records + applies (or parks) the decision.
 */
function applyStreamDisposition(
  ctx: { remote?: boolean },
  input: Omit<TriageDecisionInput, 'actor'>,
): Record<string, unknown> {
  const remote = ctx.remote ?? true;
  const viaSweep = !!input.passId;
  const autonomy = getStreamAutonomy();
  const level = effectiveAutonomyLevel(input.disposition);
  const mustPropose = (viaSweep && level === 'suggest') || (autonomy.killSwitch && remote);

  try {
    if (mustPropose) {
      const [decision] = proposeTriageDecisions(
        [{ ...input, actor: 'agent' }],
        input.passId ?? null,
      );
      return {
        proposed: true,
        decisionId: decision.id,
        note: autonomy.killSwitch
          ? 'Autonomy kill switch is on: recorded as a proposal for the user to review.'
          : `Autonomy for ${input.disposition} is 'suggest': recorded as a proposal for the user to review.`,
      };
    }
    const actor: 'agent' | 'user' = viaSweep || remote ? 'agent' : 'user';
    const result = recordTriageDecisionAndApply(
      { ...input, actor },
      viaSweep ? 'executed' : 'accepted',
    );
    return {
      proposed: false,
      decisionId: result.decision.id,
      entity: result.entity,
      created: result.created,
      streamItems: result.streamItems,
    };
  } catch (err) {
    rethrowTriage(err);
  }
}

const list_stream_action = defineAction({
  name: 'list_stream',
  description:
    'List stream items (the capture ledger). Defaults to status=pending, the untriaged queue. ' +
    "Statuses: pending | proposed (awaiting the user's call) | promoted | reviewed (kept as a " +
    'thought) | dismissed | incubating. pass_id filters to items touched by one triage pass.',
  params: {
    status: streamStatus.optional(),
    passId: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  },
  handler: (_ctx, input) => listStream({ status: input.status ?? 'pending', ...input }),
});

const get_stream_item_action = defineAction({
  name: 'get_stream_item',
  description: 'Fetch a single stream item by id.',
  params: { id: z.string().min(1) },
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const row = getStream(id);
    if (!row) throw new ActionError('not_found', `Stream item not found: ${id}`);
    return row;
  },
});

const create_stream_item_action = defineAction({
  name: 'create_stream_item',
  description:
    'Capture text into the stream inbox. Use when something should be kept but is not clearly a ' +
    'task or a note yet. The triage pass (human or agent) decides later.',
  params: {
    rawText: z.string().min(1),
  },
  mutating: true,
  handler: (_ctx, { rawText }) => {
    const row = createStream({ rawText, source: 'chat' });
    onStreamCaptured(row.id);
    return row;
  },
});

const promote_stream_action = defineAction({
  name: 'promote_stream',
  description:
    'Promote a stream item into a NEW task or note. Shape the title yourself (imperative for ' +
    "tasks). The item's raw text and attachments carry over unless overridden. For tasks, choose " +
    'status: "todo" (commit to the queue, the default) or "consider" (park as a possibility). ' +
    'Consider drops any deadline/reminder. Setting hardDeadline or reminderAt REQUIRES evidence ' +
    'quoting the exact source words. Pass pass_id when working inside a sweep — policy may convert ' +
    'the call into a proposal.',
  params: {
    id: z.string().min(1),
    to: z.enum(['task', 'note']),
    /** Task promotion only: `todo` (default, commit) or `consider` (park). */
    status: z.enum(['consider', 'todo']).optional(),
    /** Shaped title. Tasks: imperative ("Ship the manifest"). Optional for notes. */
    title: z.string().optional(),
    /** Override body; defaults to the item's raw text. Clean voice transcripts here. */
    body: z.string().optional(),
    areaId: z.string().nullable().optional(),
    /** Task promotion only: create as a subtask of this task. */
    parentId: z.string().nullable().optional(),
    /** Note promotion only: link the note to this task. */
    taskId: z.string().nullable().optional(),
    energy: taskEnergy.nullable().optional(),
    effort: taskEffort.nullable().optional(),
    hardDeadline: z.string().nullable().optional(),
    reminderAt: z.string().nullable().optional(),
    /** Exact source words supporting any date claim. Required with dates. */
    evidence: z.string().optional(),
    rationale: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    passId: z.string().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (ctx, input) => {
    const item = getStream(input.id);
    if (!item) throw new ActionError('not_found', `Stream item not found: ${input.id}`);
    return applyStreamDisposition(ctx, {
      disposition: input.to === 'task' ? 'promote_task' : 'promote_note',
      streamItemIds: [input.id],
      draft: {
        title: input.title ?? (input.to === 'task' ? firstLineTitle(item.rawText) : undefined),
        body: input.body,
        status: input.status,
        areaId: input.areaId ?? null,
        parentId: input.parentId ?? null,
        taskId: input.taskId ?? null,
        energy: input.energy ?? null,
        effort: input.effort ?? null,
        hardDeadline: input.hardDeadline ?? null,
        reminderAt: input.reminderAt ?? null,
        evidence: input.evidence,
      },
      rationale: input.rationale ?? null,
      confidence: input.confidence ?? null,
      passId: input.passId ?? null,
    });
  },
});

const merge_stream_action = defineAction({
  name: 'merge_stream',
  description:
    'Append stream item(s) into an EXISTING task or note, atomically and non-destructively ' +
    '(notes append to the body, tasks under a "## Context" heading, or as a subtask with ' +
    'as_subtask=true when the fragment is independently actionable). Merge only when the target ' +
    'is unambiguous — pass expectedTargetUpdatedAt from your candidate list so a stale target is ' +
    'caught. content overrides the appended text (clean transcripts here).',
  params: {
    id: z.string().optional(),
    ids: z.array(z.string().min(1)).optional(),
    targetType: z.enum(['task', 'note']),
    targetId: z.string().min(1),
    content: z.string().optional(),
    asSubtask: z.boolean().optional(),
    /** Subtask title when asSubtask=true. */
    title: z.string().optional(),
    expectedTargetUpdatedAt: z.string().optional(),
    rationale: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    passId: z.string().optional(),
  },
  mutating: true,
  handler: (ctx, input) => {
    const itemIds = input.ids ?? (input.id ? [input.id] : []);
    if (itemIds.length === 0) throw new ActionError('invalid_params', 'Provide id or ids.');
    return applyStreamDisposition(ctx, {
      disposition: input.targetType === 'task' ? 'merge_task' : 'merge_note',
      streamItemIds: itemIds,
      targetType: input.targetType,
      targetId: input.targetId,
      draft: {
        body: input.content,
        title: input.title,
        asSubtask: input.asSubtask,
        expectedTargetUpdatedAt: input.expectedTargetUpdatedAt,
      },
      rationale: input.rationale ?? null,
      confidence: input.confidence ?? null,
      passId: input.passId ?? null,
    });
  },
});

const combine_stream_action = defineAction({
  name: 'combine_stream',
  description:
    'Fuse two or more stream items into ONE new task or note. Synthesize a coherent title and ' +
    'body from the fragments — do not concatenate raw text. Every source item stays in the ' +
    'ledger, linked to the created entity. Combine only tight semantic + temporal clusters.',
  params: {
    ids: z.array(z.string().min(1)).min(2),
    to: z.enum(['task', 'note']),
    title: z.string().optional(),
    body: z.string().optional(),
    areaId: z.string().nullable().optional(),
    energy: taskEnergy.nullable().optional(),
    effort: taskEffort.nullable().optional(),
    hardDeadline: z.string().nullable().optional(),
    reminderAt: z.string().nullable().optional(),
    evidence: z.string().optional(),
    rationale: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    passId: z.string().optional(),
  },
  mutating: true,
  handler: (ctx, input) =>
    applyStreamDisposition(ctx, {
      disposition: input.to === 'task' ? 'combine_task' : 'combine_note',
      streamItemIds: input.ids,
      draft: {
        title: input.title,
        body: input.body,
        areaId: input.areaId ?? null,
        energy: input.energy ?? null,
        effort: input.effort ?? null,
        hardDeadline: input.hardDeadline ?? null,
        reminderAt: input.reminderAt ?? null,
        evidence: input.evidence,
      },
      rationale: input.rationale ?? null,
      confidence: input.confidence ?? null,
      passId: input.passId ?? null,
    }),
});

const mark_stream_reviewed_action = defineAction({
  name: 'mark_stream_reviewed',
  description:
    'The journal disposition: keep item(s) as recorded thoughts. Nothing is created, nothing is ' +
    'owed, the capture stays searchable forever. This is a SUCCESS outcome and should be common — ' +
    'most thoughts should not become tasks.',
  params: {
    id: z.string().optional(),
    ids: z.array(z.string().min(1)).optional(),
    reason: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    passId: z.string().optional(),
  },
  mutating: true,
  handler: (ctx, input) => {
    const itemIds = input.ids ?? (input.id ? [input.id] : []);
    if (itemIds.length === 0) throw new ActionError('invalid_params', 'Provide id or ids.');
    return applyStreamDisposition(ctx, {
      disposition: 'journal',
      streamItemIds: itemIds,
      rationale: input.reason ?? null,
      confidence: input.confidence ?? null,
      passId: input.passId ?? null,
    });
  },
});

const dismiss_stream_action = defineAction({
  name: 'dismiss_stream',
  description:
    'Set aside a stream item (noise, exact duplicates). Dismissed items keep their text and stay ' +
    'searchable — this is triage, not deletion. For thoughts worth keeping, prefer ' +
    'mark_stream_reviewed.',
  params: {
    id: z.string().min(1),
    reason: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    passId: z.string().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (ctx, input) =>
    applyStreamDisposition(ctx, {
      disposition: 'dismiss',
      streamItemIds: [input.id],
      rationale: input.reason ?? null,
      confidence: input.confidence ?? null,
      passId: input.passId ?? null,
    }),
});

const incubate_stream_action = defineAction({
  name: 'incubate_stream',
  description:
    'Keep a stream item for later: it leaves the queue and returns to pending at resurface_at. ' +
    'For thoughts that are not actionable now but should not be lost.',
  params: {
    id: z.string().min(1),
    resurfaceAt: z.string().min(1),
    reason: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    passId: z.string().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (ctx, input) =>
    applyStreamDisposition(ctx, {
      disposition: 'incubate',
      streamItemIds: [input.id],
      draft: { resurfaceAt: input.resurfaceAt },
      rationale: input.reason ?? null,
      confidence: input.confidence ?? null,
      passId: input.passId ?? null,
    }),
});

const propose_stream_triage_action = defineAction({
  name: 'propose_stream_triage',
  description:
    'Batch suggest-mode proposals: decisions are parked for the user to review, nothing mutates. ' +
    'Each proposal needs a one-sentence rationale the user will read. Use the execute actions ' +
    '(promote_stream, merge_stream, ...) with pass_id instead when the disposition may auto-apply — ' +
    'policy downgrades them to proposals automatically when it must.',
  params: {
    passId: z.string().min(1),
    proposals: z.array(triageProposalSchema).min(1),
  },
  mutating: true,
  handler: (_ctx, input) => {
    try {
      const decisions = proposeTriageDecisions(
        input.proposals.map((p) => ({
          disposition: p.disposition,
          streamItemIds: p.stream_item_ids,
          targetType: p.target_type ?? null,
          targetId: p.target_id ?? null,
          draft: p.draft ?? null,
          rationale: p.rationale,
          confidence: p.confidence ?? null,
          passId: input.passId,
          actor: 'agent',
        })),
        input.passId,
      );
      return { proposed: decisions.length, decisionIds: decisions.map((d) => d.id) };
    } catch (err) {
      rethrowTriage(err);
    }
  },
});

const undo_triage_decision_action = defineAction({
  name: 'undo_triage_decision',
  description:
    'Reverse a triage decision: created entities are removed (archived when the user edited them), ' +
    'appends are reverted through entity versions when still the latest change, and the source ' +
    'captures return to pending. Never deletes a stream item.',
  params: { decisionId: z.string().min(1) },
  mutating: true,
  cli: { positional: ['decisionId'] },
  handler: (_ctx, { decisionId }) => {
    try {
      return undoTriageDecision(decisionId);
    } catch (err) {
      rethrowTriage(err);
    }
  },
});

const begin_stream_sweep_action = defineAction({
  name: 'begin_stream_sweep',
  description:
    'Open a triage sweep: returns your full instructions, the pending captures with combine/merge ' +
    'candidates, the user’s recent corrections, and the autonomy config. Call this FIRST when ' +
    'triaging the stream; conflict means another sweep is already running (stop quietly). Finish ' +
    'with finish_stream_sweep.',
  params: {
    trigger: z.enum(['debounce', 'schedule', 'threshold', 'manual', 'urgency', 'weekly']).optional(),
  },
  mutating: true,
  handler: async (_ctx, input) => {
    try {
      return await beginSweep(input.trigger ?? 'manual');
    } catch (err) {
      rethrowTriage(err);
    }
  },
});

const finish_stream_sweep_action = defineAction({
  name: 'finish_stream_sweep',
  description:
    'Close a triage sweep with a one-paragraph, user-facing summary of what happened (calm, ' +
    'concrete, no jargon). Finalizes the digest and evaluates autonomy graduation — relay any ' +
    'returned graduationLines to the user verbatim.',
  params: {
    passId: z.string().min(1),
    summary: z.string().min(1),
    itemsSeen: z.number().int().nonnegative().optional(),
  },
  mutating: true,
  handler: (_ctx, input) => {
    try {
      return finishSweep(input.passId, input.summary, input.itemsSeen);
    } catch (err) {
      rethrowTriage(err);
    }
  },
});

const get_triage_metrics_action = defineAction({
  name: 'get_triage_metrics',
  description:
    'Triage health metrics: acceptance per disposition, time-to-clarity, pending age p95, journal ' +
    'share, and the over-promotion check (stream-born vs manual task engagement). Powers the ' +
    'weekly meta-digest.',
  params: {
    windowDays: z.number().int().positive().max(365).optional(),
  },
  handler: (_ctx, input) => getTriageMetrics(input.windowDays ?? 30),
});

// ── Areas ─────────────────────────────────────────────────────

const areaStatus = z.enum(['active', 'inactive', 'archived']);

const areaShape = {
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  userContext: z.string().nullable().optional(),
  status: areaStatus.optional(),
  sortOrder: z.number().int().optional(),
};

const list_areas_action = defineAction({
  name: 'list_areas',
  description:
    'List areas (life/work domains like "Work", "Health"). Areas organize tasks and notes. ' +
    'Look up area ids here before filtering or linking.',
  params: {
    status: z.enum(['active', 'inactive', 'archived', 'all']).optional(),
  },
  handler: (_ctx, { status }) => listAreas({ status }),
});

const get_area_action = defineAction({
  name: 'get_area',
  description: 'Fetch a single area by id.',
  params: { id: z.string().min(1) },
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const area = getArea(id);
    if (!area) throw new ActionError('not_found', `Area not found: ${id}`);
    return area;
  },
});

const create_area_action = defineAction({
  name: 'create_area',
  description: 'Create an area (life/work domain) for organizing tasks and notes.',
  params: areaShape,
  mutating: true,
  handler: (_ctx, input) => createArea(input),
});

const update_area_action = defineAction({
  name: 'update_area',
  description:
    'Update an area by id. All fields optional. Archive via status=archived. There is no delete.',
  params: {
    id: z.string().min(1),
    ...Object.fromEntries(
      Object.entries(areaShape).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ),
  } as typeof areaShape & { id: z.ZodString },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input as { id: string } & Partial<z.infer<z.ZodObject<typeof areaShape>>>;
    const row = updateArea(id, rest);
    if (!row) throw new ActionError('not_found', `Area not found: ${id}`);
    return row;
  },
});

// ── Deck ──────────────────────────────────────────────────────

const deckItemShape = z.object({
  taskId: z.string(),
  rationale: z.string(),
  continuityContext: z.string().nullable(),
  source: z.enum(['ai', 'user']),
});

const deckAlternativeShape = z.object({
  taskId: z.string(),
  reason: z.string(),
});

const get_deck_action = defineAction({
  name: 'get_deck',
  description:
    "Get the deck, the day's ranked priority stack of tasks plus alternatives. " +
    'Returns the latest deck unless an id is given.',
  params: { id: z.string().min(1).optional() },
  handler: (_ctx, { id }) => {
    const deck = id ? getDeck(id) : getLatestDeck();
    if (!deck) {
      throw new ActionError('not_found', id ? `Deck not found: ${id}` : 'No deck generated yet');
    }
    return deck;
  },
});

const update_deck_action = defineAction({
  name: 'update_deck',
  description:
    'Update a deck by id: reorder or swap items, edit alternatives, or change the framing. ' +
    'Items carry source=user when the user (or an agent acting for them) placed them.',
  params: {
    id: z.string().min(1),
    items: z.array(deckItemShape).optional(),
    alternatives: z.array(deckAlternativeShape).optional(),
    framing: z.string().nullable().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id, ...rest }) => {
    const updates = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const deck = updateDeck(id, updates);
    if (!deck) throw new ActionError('not_found', `Deck not found: ${id}`);
    return deck;
  },
});

const regenerate_deck_action = defineAction({
  name: 'regenerate_deck',
  description:
    'Run the full AI prioritization pipeline and persist a fresh deck. Slow (two model calls) ' +
    'and requires OPENAI_API_KEY. Optional context shapes the ranking (e.g. "low energy, 2 hours").',
  params: {
    context: z.string().optional(),
    contextTags: z.array(z.string()).optional(),
  },
  mutating: true,
  handler: async (_ctx, input) => {
    // Lazy: the deck pipeline pulls in the AI SDKs, which the CLI
    // shouldn't load until a regeneration actually fires (same pattern
    // as the executor imports above).
    // Register the calendar provider for this process (the CLI subprocess
    // doesn't run instrumentation, so the web-path boot registration doesn't
    // reach it). Idempotent + no-op when no calendar is connected.
    const { ensureCalendarProvider } = await import('@/lib/deck/calendar-connector');
    ensureCalendarProvider();
    const { generateDeck } = await import('@/lib/ai/generate-deck');
    return generateDeck(input);
  },
});

const reconcile_deck_action = defineAction({
  name: 'reconcile_deck',
  description:
    "Re-check today's deck against the live calendar and adapt it to external changes " +
    '(e.g. a new meeting shrinks the day → bump the lowest-priority item, narrated and ' +
    'reversible). Deterministic, no model call, safe to run on a cadence. No-op until a ' +
    'calendar connector is registered.',
  params: {
    in_focus: z.boolean().optional(),
  },
  mutating: true,
  handler: async (_ctx, input) => {
    // Ensure the calendar provider is registered in this process (CLI
    // subprocess doesn't run instrumentation). Idempotent.
    const { ensureCalendarProvider } = await import('@/lib/deck/calendar-connector');
    ensureCalendarProvider();
    const { reconcileDeckWithExternalChanges } = await import('@/lib/deck/reconcile-external');
    return reconcileDeckWithExternalChanges({ inFocus: input.in_focus });
  },
});

const get_day_shape_action = defineAction({
  name: 'get_day_shape',
  description:
    "The user's day shape for a date or range: calendar commitments, free gaps, and free " +
    'minutes, already computed. Use this for anything about time or availability. Never ' +
    'compute free/busy from raw calendar events yourself.',
  params: {
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('YYYY-MM-DD, defaults to today'),
    days: z.number().int().min(1).max(7).optional().describe('Range length, defaults to 1'),
  },
  handler: async (_ctx, { date, days }) => {
    // Lazy: the day-shape service reaches the connectors runtime — keep it out
    // of the CLI boot graph (same pattern as the deck actions above).
    const { getCalendarRange } = await import('@/lib/calendar/service');
    const { formatGap } = await import('@/lib/deck/calendar');
    const r = await getCalendarRange({ start: date, days: days ?? 1 });
    return {
      status: r.status,
      asOf: r.asOf,
      workday: `${r.workday.start}-${r.workday.end}`,
      days: r.days.map((d) => ({
        date: d.date,
        allDay: d.allDay.map((e) => ({ title: e.title, start: e.start, end: e.end })),
        busy: d.events
          .filter((e) => e.countsAsBusy)
          .map((e) => ({ title: e.title, start: e.start, end: e.end, source: e.providerId })),
        freeGaps: d.gaps.map(formatGap),
        freeMinutes: d.freeMinutes,
        largestGapMinutes: d.largestGapMinutes,
      })),
    };
  },
});

// ── Search ────────────────────────────────────────────────────

const search_action = defineAction({
  name: 'search',
  description:
    'Hybrid semantic + keyword search across tasks, notes, and stream entries. Returns hydrated ' +
    'entities with relevance scores. Use to find context before creating or answering.',
  params: {
    query: z.string().min(1),
    limit: z.number().int().positive().max(50).optional(),
  },
  cli: { positional: ['query'] },
  handler: async (_ctx, { query, limit }) => {
    // Lazy: embedding generation pulls in the AI SDKs (vector half of the
    // hybrid). FTS-only fallback still applies when no OPENAI_API_KEY.
    const { hybridSearchWithEntities } = await import('@/lib/embeddings/search');
    return hybridSearchWithEntities(query, { limit });
  },
});

// ── User state ────────────────────────────────────────────────

const get_user_state_action = defineAction({
  name: 'get_user_state',
  description:
    "Get the user's current state: active area, active parent task, energy, available minutes, " +
    'and free-text focus description.',
  params: {},
  handler: () => getUserState() ?? null,
});

const update_user_state_action = defineAction({
  name: 'update_user_state',
  description:
    "Update the user's current state (energy, available time, active area/task, focus text). " +
    'Only these focus fields are exposed. App settings are not writable from the agent surface.',
  params: {
    activeAreaId: z.string().nullable().optional(),
    activeParentTaskId: z.string().nullable().optional(),
    activeEnergy: z.enum(['deep', 'light']).nullable().optional(),
    availableMinutes: z.number().int().nullable().optional(),
    description: z.string().optional(),
  },
  mutating: true,
  handler: (_ctx, input) => {
    const updates = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    return updateUserState(updates) ?? null;
  },
});

// ── Workspaces ────────────────────────────────────────────────

const workspaceStatus = z.enum(['active', 'archived']);

const list_workspaces_action = defineAction({
  name: 'list_workspaces',
  description: 'List workspaces with aggregated session counts. Default filter is active.',
  params: {
    status: workspaceStatus.optional(),
  },
  handler: (_ctx, { status }) => listWorkspaces({ status }),
});

const get_workspace_action = defineAction({
  name: 'get_workspace',
  description: 'Fetch a single workspace by id.',
  params: { id: z.string().min(1) },
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const ws = getWorkspace(id);
    if (!ws) throw new ActionError('not_found', `Workspace not found: ${id}`);
    return ws;
  },
});

const create_workspace_action = defineAction({
  name: 'create_workspace',
  description:
    'Create a workspace tied to a folder on disk. Git is auto-detected. For git repos the base branch is resolved from <remote>/HEAD with main/master fallback.',
  params: {
    name: z.string().min(1),
    cwd: z.string().min(1),
    emoji: z.string().nullable().optional(),
    areaId: z.string().nullable().optional(),
    baseBranch: z.string().nullable().optional(),
    remoteName: z.string().optional(),
    worktreeRoot: z.string().nullable().optional(),
  },
  mutating: true,
  handler: async (_ctx, input) => {
    const cwd = path.resolve(input.cwd);
    const isGit = await detectIsGit(cwd);
    const baseBranch = isGit
      ? input.baseBranch ?? (await detectBaseBranch(cwd, input.remoteName ?? 'origin'))
      : null;
    return createWorkspace({
      name: input.name,
      emoji: input.emoji ?? null,
      cwd,
      isGit: isGit,
      baseBranch: baseBranch,
      remoteName: isGit ? input.remoteName ?? 'origin' : null,
      worktreeRoot: isGit ? input.worktreeRoot ?? defaultWorktreeRoot(input.name) : null,
      areaId: input.areaId ?? null,
      status: 'active',
    });
  },
});

const archive_workspace_action = defineAction({
  name: 'archive_workspace',
  description: 'Archive a workspace. Sessions stay queryable. Nothing on disk is touched.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const row = archiveWorkspace(id);
    if (!row) throw new ActionError('not_found', `Workspace not found: ${id}`);
    return row;
  },
});

// ─── Reference folders ────────────────────────────────────────
// Read-only folders a workspace's agents may consult. See
// docs/reference-folders-spec.md. `workspaceId: null` = global (every
// workspace sees it).

/**
 * Translate the query layer's typed failure into the action envelope. Keeps
 * the stable codes (`invalid_params | conflict | not_found`) rather than
 * letting a raw Error escape as a 500.
 */
function rethrowReferenceFolderError(err: unknown): never {
  if (err instanceof ReferenceFolderError) throw new ActionError(err.code, err.message);
  throw err;
}

/**
 * Bare paths are a disclosure vector from an untrusted caller — an agent over
 * HTTP could point a reference at anything readable and have its contents
 * summarized back. The local CLI is trusted and may pass any path; a remote
 * caller has to go through a workspace, which the user already vouched for.
 */
function assertPathAllowed(ctx: { remote?: boolean }, path: string | null | undefined): void {
  if (!path) return;
  if (ctx.remote ?? true) {
    throw new ActionError(
      'unsupported',
      'Remote callers cannot set a bare path on a reference folder. Point at a workspace with targetWorkspaceId, or add it from the app.',
    );
  }
}

const list_reference_folders_action = defineAction({
  name: 'list_reference_folders',
  description:
    'List reference folders (read-only folders agents may consult), resolved to absolute paths with existence and git state. Pass workspaceId to see what that workspace sees (its own plus every global one); omit it for the global ones alone.',
  params: { workspaceId: z.string().nullable().optional() },
  handler: (_ctx, { workspaceId }) => listResolvedReferenceFolders(workspaceId ?? null),
});

const create_reference_folder_action = defineAction({
  name: 'create_reference_folder',
  description:
    'Add a reference folder. Give exactly one of `path` (a folder on disk) or `targetWorkspaceId` (another workspace). Omit workspaceId to make it global. Safe under retry: a repeat with the same alias in the same scope returns a conflict rather than duplicating.',
  params: {
    alias: z.string().min(1),
    workspaceId: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
    targetWorkspaceId: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  },
  mutating: true,
  handler: (ctx, input) => {
    assertPathAllowed(ctx, input.path);
    try {
      // `~` / relative expansion happens in the query layer so every caller
      // stores the same absolute form.
      return createReferenceFolder({
        alias: input.alias,
        workspaceId: input.workspaceId ?? null,
        path: input.path ?? null,
        targetWorkspaceId: input.targetWorkspaceId ?? null,
        description: input.description ?? null,
      });
    } catch (err) {
      rethrowReferenceFolderError(err);
    }
  },
});

const update_reference_folder_action = defineAction({
  name: 'update_reference_folder',
  description:
    'Update a reference folder. Only the fields you pass change. Switching targets means passing the new one and nulling the other.',
  params: {
    id: z.string().min(1),
    alias: z.string().min(1).optional(),
    path: z.string().nullable().optional(),
    targetWorkspaceId: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    workspaceId: z.string().nullable().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (ctx, { id, ...rest }) => {
    assertPathAllowed(ctx, rest.path);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) patch[k] = v;
    }
    try {
      const row = updateReferenceFolder(id, patch);
      if (!row) throw new ActionError('not_found', `Reference folder not found: ${id}`);
      return row;
    } catch (err) {
      rethrowReferenceFolderError(err);
    }
  },
});

const archive_reference_folder_action = defineAction({
  name: 'archive_reference_folder',
  description:
    'Archive a reference folder so agents stop being told about it. Nothing on disk is touched, and the alias becomes reusable.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    if (!getReferenceFolder(id)) {
      throw new ActionError('not_found', `Reference folder not found: ${id}`);
    }
    const row = archiveReferenceFolder(id);
    if (!row) throw new ActionError('not_found', `Reference folder not found: ${id}`);
    return row;
  },
});

const list_workspace_sessions_action = defineAction({
  name: 'list_workspace_sessions',
  description: 'List active execution sessions in a workspace, newest activity first.',
  params: {
    workspaceId: z.string().min(1),
    status: workspaceStatus.optional(),
  },
  cli: { positional: ['workspaceId'] },
  handler: (_ctx, { workspaceId, status }) =>
    listChatSessions({ workspaceId, status: status ?? 'active' }),
});

const search_sessions_action = defineAction({
  name: 'search_sessions',
  description:
    'Full-text search across chat + execution transcripts (the message content of user and agent ' +
    'turns, including imported Claude, Codex, and OpenCode history). Returns matching sessions, each with the best-' +
    'matching passage as a snippet, ranked by relevance — use it to find "the chat where we discussed ' +
    'X". Searches active AND archived by default. Follow up with get_session_messages(sessionId) to ' +
    'read a match in full.',
  params: {
    query: z.string().min(1),
    status: workspaceStatus.optional(),
    workspaceId: z.string().optional(),
    source: z.enum(['native', 'imported', 'claude', 'codex', 'opencode']).optional(),
    limit: z.number().int().positive().max(50).optional(),
  },
  cli: { positional: ['query'] },
  handler: (_ctx, { query, status, workspaceId, source, limit }) =>
    searchChatSessions({ query, status, workspaceId, source, limit }).map((r) => ({
      sessionId: r.id,
      label: r.label ?? r.execution?.label ?? null,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      status: r.status,
      imported: r.surfaceKind === 'imported_agent',
      source: r.surfaceRef,
      snippet: stripHighlight(r.snippet),
      score: r.score,
      lastActivityAt: r.lastOutcomeEventAt ?? r.startedAt,
    })),
});

// ── Execution oversight ───────────────────────────────────────
//
// The orchestrator watching + steering the executing agents. Live state
// (running turns, pending prompts, the harness subprocess cache) is owned
// by the app server's process, so these actions split by concern:
// transcript reads hit the DB directly (work from any process), live
// flags and message delivery go through the server's HTTP API (see
// `server-client.ts` for the full process-ownership story).

const list_executions_action = defineAction({
  name: 'list_executions',
  description:
    'List active execution sessions across all workspaces with status flags: running (turn in ' +
    'flight), awaitingInput (blocked on a prompt), unread (output the user has not viewed, what ' +
    'the rail\'s Unread section shows, minus currently-running sessions). The returned sessionId ' +
    'is the handle for get_session_messages, send_session_message, and [[execution:SESSION_ID]] links. ' +
    'When available, resumeCommand is the provider CLI command for the external session id.',
  params: {},
  handler: async () => {
    const rows = listRailSessions();
    const live = await fetchLiveSignals();
    return {
      /** False ⇒ the app server was unreachable: running/awaitingInput are unknown-but-idle. */
      live: live !== null,
      executions: rows.map((r) => {
        const running = live?.runningSessionIds.includes(r.id) ?? false;
        const agentHarness = getAgent(r.agentId)?.harness ?? null;
        return {
          sessionId: r.id,
          executionId: r.executionId,
          externalSessionId: r.externalSessionId,
          agentHarness,
          resumeCommand: resumeCommandForHarness(agentHarness, r.externalSessionId),
          label: r.label,
          workspace: { id: r.workspaceId, name: r.workspaceName },
          branch: r.execution?.branchName ?? null,
          prNumber: r.execution?.prNumber ?? null,
          startedAt: r.startedAt,
          lastActivityAt: r.lastOutcomeEventAt ?? r.startedAt,
          running,
          awaitingInput: live?.pendingSessionIds.includes(r.id) ?? false,
          // Same derivation as the UI (isSessionUnread), same streaming
          // overlay as the rail's Unread section: a mid-turn session is
          // about to produce a fresh outcome, so it doesn't count as
          // unread yet. Keeps the agent's answer to "what's unread?"
          // identical to what the user sees in the rail.
          unread: !running && isSessionUnread(r),
        };
      }),
    };
  },
});

const get_session_messages_action = defineAction({
  name: 'get_session_messages',
  description:
    'Read the latest messages of a session (execution or orchestrator chat) as a condensed transcript ' +
    'tail (user/agent text, one-line tool calls, errors), plus whether the session is running or ' +
    'blocked on a permission/question prompt. The response includes app and provider ids plus a ' +
    'provider resume command when one is available. Read this before nudging a session.',
  params: {
    sessionId: z.string().min(1),
    limit: z.number().int().positive().max(200).optional(),
  },
  cli: { positional: ['sessionId'] },
  handler: async (_ctx, { sessionId, limit }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError('not_found', `Session not found: ${sessionId}`);
    const agentHarness = getAgent(session.agentId)?.harness ?? null;

    const events = listChatEvents(sessionId, { limit: limit ?? 40 });
    const pending = derivePendingFromEvents(events);
    const live = await fetchLiveSignals();

    return {
      session: {
        id: session.id,
        label: session.label,
        type: session.type,
        status: session.status,
        workspaceId: session.workspaceId,
        executionId: session.executionId,
        externalSessionId: session.externalSessionId,
        agentHarness,
        resumeCommand: resumeCommandForHarness(agentHarness, session.externalSessionId),
      },
      /** Null ⇒ server unreachable (live state unknown; nothing can be running while it is down). */
      running: live ? live.runningSessionIds.includes(sessionId) : null,
      awaitingInput: live ? live.pendingSessionIds.includes(sessionId) : pending !== null,
      /** What the session is blocked on, when derivable from the transcript. */
      pendingDetail: pending,
      messages: condenseEvents(events),
    };
  },
});

const get_pending_input_action = defineAction({
  name: 'get_pending_input',
  description:
    'List the permission/question prompts a session is blocked on right now (live server state). ' +
    'Each entry carries a requestId for answer_pending_input. A blocked turn does NOT see queued ' +
    'messages until its prompt is resolved. Answering is the only way to unblock it.',
  params: { sessionId: z.string().min(1) },
  cli: { positional: ['sessionId'] },
  handler: async (_ctx, { sessionId }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError('not_found', `Session not found: ${sessionId}`);
    return serverFetch<unknown[]>(`/sessions/${sessionId}/pending-input`);
  },
});

const answer_pending_input_action = defineAction({
  name: 'answer_pending_input',
  description:
    'Resolve a pending permission or question prompt on a session. Permissions: allow=true/false ' +
    '(message = deny reason). Questions: allow=true with answers keyed by the question text ' +
    '(allow=false declines). Only answer on the user\'s clear intent. When in doubt, surface the ' +
    'prompt to the user instead.',
  params: {
    sessionId: z.string().min(1),
    requestId: z.string().min(1),
    allow: z.boolean(),
    /** Reason shown to the blocked agent when denying. */
    message: z.string().optional(),
    /** AskUserQuestion answers keyed by question text. Ignored for permissions. */
    answers: z.record(z.string()).optional(),
  },
  mutating: true,
  cli: { positional: ['sessionId', 'requestId'] },
  handler: async (_ctx, { sessionId, requestId, allow, message, answers }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError('not_found', `Session not found: ${sessionId}`);
    await serverFetch(`/sessions/${sessionId}/pending-input/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ allow, message, answers }),
    });
    return {
      resolved: true,
      sessionId,
      requestId,
      note: 'The blocked turn resumes now. Check get_session_messages for what it does next.',
    };
  },
});

const send_session_message_action = defineAction({
  name: 'send_session_message',
  description:
    'Send a message into a session: nudge a stalled execution, answer a question in prose, or steer ' +
    'direction. Delivered through the app server: it lands in the agent\'s queue mid-turn or starts a ' +
    'new turn. Fire-and-forget. Poll get_session_messages for the response. Never send to your own session.',
  params: {
    sessionId: z.string().min(1),
    content: z.string().min(1),
  },
  mutating: true,
  cli: { positional: ['sessionId'] },
  handler: async (_ctx, { sessionId, content }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError('not_found', `Session not found: ${sessionId}`);
    if (session.status === 'archived') {
      throw new ActionError(
        'conflict',
        'Session is archived. Resume it from the app before messaging it.',
      );
    }

    // Through the server, never executor.dispatch from here: the messages
    // route owns marker expansion, label derivation, health checks, and
    // run-row accounting — and the server process owns the harness
    // subprocess. Dispatching from a CLI-invoked handler would spawn a
    // duplicate harness process against the same session.
    const event = await serverFetch<{ id: string }>(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });

    return {
      delivered: true,
      sessionId,
      eventId: event?.id ?? null,
      note: 'Dispatched. The session processes asynchronously. Check get_session_messages shortly.',
    };
  },
});

// ── Triggers + Runs ─────────────────────────────────────────

const triggerKind = z.enum(['manual', 'at', 'every', 'cron', 'webhook']);
const triggerTargetKind = z.enum(['workspace', 'orchestrator']);
const triggerConcurrencyPolicy = z.enum([
  'skip_if_running',
  'coalesce_if_active',
  'allow_concurrent',
]);
const triggerCatchUpPolicy = z.enum(['skip_missed', 'run_all']);
const effortLevel = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const runStatusFilter = z.enum(['queued', 'running', 'completed', 'failed', 'skipped']);
const runTriggerFilter = z.enum(['manual', 'cron', 'every', 'at', 'webhook']);

/**
 * Validate a `deliverResultTo[]` digest binding (notifier channel ids) before
 * it lands on a trigger. The binding is only honored for orchestrator-target
 * runs — `notifyRunTerminal` (src/lib/notifications/emit.ts) reads it solely on
 * the orchestrator branch; workspace runs route via the `execution.finished`
 * matrix instead. Rejecting a non-empty binding on a workspace target (rather
 * than silently dropping it) keeps "I set a Telegram digest" honest. Every id
 * must resolve to a real channel so a typo fails loudly instead of delivering
 * nowhere. Returns the de-duped list to store.
 */
function validateDeliverResultTo(
  ids: string[],
  targetKind: z.infer<typeof triggerTargetKind>,
): string[] {
  if (ids.length === 0) return [];
  if (targetKind !== 'orchestrator') {
    throw new ActionError(
      'invalid_params',
      'deliver_result_to is only honored for target_kind=orchestrator. Workspace runs notify via the execution.finished matrix, not a digest binding',
    );
  }
  const deduped = [...new Set(ids)];
  for (const id of deduped) {
    if (!getNotificationChannel(id)) {
      throw new ActionError(
        'not_found',
        `notification channel not found: ${id} (use list_notification_channels to discover ids)`,
      );
    }
  }
  return deduped;
}

const list_triggers_action = defineAction({
  name: 'list_triggers',
  description: 'List triggers with last-run rollup. Filters: enabled, kind, target, workspace_id.',
  params: {
    enabled: z.boolean().optional(),
    kind: triggerKind.optional(),
    targetKind: triggerTargetKind.optional(),
    workspaceId: z.string().nullable().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  },
  handler: (_ctx, input) => listTriggersWithLastRun(input),
});

const get_trigger_action = defineAction({
  name: 'get_trigger',
  description: 'Fetch a single trigger by id (or unique name within scope).',
  params: {
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    workspaceId: z.string().nullable().optional(),
  },
  handler: (_ctx, { id, name, workspaceId }) => {
    if (!id && !name) {
      throw new ActionError('invalid_params', 'Provide id or name');
    }
    const row = id
      ? getTrigger(id)
      : findTriggerByName(name!, workspaceId ?? null);
    if (!row) throw new ActionError('not_found', `Trigger not found: ${id ?? name}`);
    return row;
  },
});

const createTriggerShape = {
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  // Optional in the contract: the handler defaults to the
  // orchestrator agent (target=orchestrator) or the workspace's bound
  // executor (target=workspace) when omitted. Same form-level default
  // policy the spec describes; surfaces the same handle to CLI + UI.
  agentId: z.string().min(1).optional(),
  workspaceId: z.string().nullable().optional(),
  targetKind: triggerTargetKind,
  prompt: z.string().min(1),
  skillHints: z.array(z.string()).nullable().optional(),
  kind: triggerKind,
  cronExpression: z.string().nullable().optional(),
  intervalSeconds: z.number().int().positive().nullable().optional(),
  runAt: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  activeHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  activeHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  concurrencyPolicy: triggerConcurrencyPolicy.optional(),
  catchUpPolicy: triggerCatchUpPolicy.optional(),
  maxCatchUpRuns: z.number().int().positive().max(10).optional(),
  model: z.string().nullable().optional(),
  effort: effortLevel.nullable().optional(),
  timeoutSeconds: z.number().int().positive().nullable().optional(),
  // Notifier digest binding: notification_channel ids the run result is
  // delivered to when an orchestrator-target run completes
  // (`trigger.run_completed`). Discover ids via list_notification_channels.
  // Only honored for target_kind=orchestrator (see validateDeliverResultTo).
  deliverResultTo: z.array(z.string().min(1)).optional(),
} as const;

const create_trigger_action = defineAction({
  name: 'create_trigger',
  description:
    'Create a trigger. Kind-specific fields are enforced (cron requires cron_expression, every requires interval_seconds, at requires run_at, webhook generates credentials, manual takes no cadence fields and only fires via run_trigger).',
  params: createTriggerShape,
  mutating: true,
  handler: (_ctx, input) => {
    // Per-kind validation: catch bad rows here rather than at the tick.
    if (input.kind === 'cron') {
      if (!input.cronExpression) {
        throw new ActionError('invalid_params', 'cron_expression is required when kind=cron');
      }
      const v = validateCronExpression(input.cronExpression, input.timezone ?? 'UTC');
      if (!v.valid) throw new ActionError('invalid_params', `Invalid cron: ${v.error}`);
    } else if (input.kind === 'every') {
      if (!input.intervalSeconds) {
        throw new ActionError('invalid_params', 'interval_seconds is required when kind=every');
      }
    } else if (input.kind === 'at') {
      if (!input.runAt) {
        throw new ActionError('invalid_params', 'run_at is required when kind=at');
      }
    }

    // Workspace target needs workspace_id; orchestrator must not have one.
    if (input.targetKind === 'workspace' && !input.workspaceId) {
      throw new ActionError('invalid_params', 'workspace_id is required when target_kind=workspace');
    }
    if (input.targetKind === 'orchestrator' && input.workspaceId) {
      // Orchestrator triggers don't anchor to a workspace; allowing
      // a workspaceId here would let an orchestration chat be created
      // with a workspace cwd via `createChatForFire` (dispatch.ts),
      // which is the wrong execution-isolation story.
      throw new ActionError('invalid_params', 'workspace_id must be null when target_kind=orchestrator');
    }

    // Resolve + verify the digest binding before we persist anything.
    const deliverResultTo = validateDeliverResultTo(
      input.deliverResultTo ?? [],
      input.targetKind,
    );

    // Resolve agentId default. Form-level (not schema-level) so the
    // orchestrator/workspace defaults match the spec without forcing
    // every caller to know the agent registry layout.
    const agentId =
      input.agentId ??
      (input.targetKind === 'orchestrator'
        ? getOrCreateDefaultOrchestrator().id
        : getOrCreateDefaultExecutor('claude_code').id);

    // Webhook credentials generated server-side; the plaintext secret
    // is returned exactly once on the create response.
    let webhookCredentials: ReturnType<typeof generateWebhookCredentials> | null = null;
    let webhookPublicId: string | null = null;
    let webhookSecretHash: string | null = null;
    if (input.kind === 'webhook') {
      webhookCredentials = generateWebhookCredentials();
      webhookPublicId = webhookCredentials.publicId;
      webhookSecretHash = webhookCredentials.secretHash;
    }

    // Compute first nextRunAt so the tick has something to act on.
    const draft = {
      kind: input.kind,
      cronExpression: input.cronExpression ?? null,
      intervalSeconds: input.intervalSeconds ?? null,
      runAt: input.runAt ?? null,
      timezone: input.timezone ?? 'UTC',
      lastFiredAt: null as string | null,
    };
    const nextRunAt = computeNextRun(draft);

    const row = createTrigger({
      name: input.name,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      agentId,
      workspaceId: input.workspaceId ?? null,
      targetKind: input.targetKind,
      prompt: input.prompt,
      skillHints: input.skillHints ?? null,
      kind: input.kind,
      cronExpression: input.cronExpression ?? null,
      intervalSeconds: input.intervalSeconds ?? null,
      runAt: input.runAt ?? null,
      timezone: input.timezone ?? 'UTC',
      activeHoursStart: input.activeHoursStart ?? null,
      activeHoursEnd: input.activeHoursEnd ?? null,
      concurrencyPolicy: input.concurrencyPolicy ?? 'coalesce_if_active',
      catchUpPolicy: input.catchUpPolicy ?? 'skip_missed',
      maxCatchUpRuns: input.maxCatchUpRuns ?? 3,
      webhookPublicId,
      webhookSecretHash,
      model: input.model ?? null,
      effort: input.effort ?? null,
      // Null when the caller omits it — no wall-clock cap. The
      // runtime `runWithTimeout` skips the race when seconds is null
      // or <= 0; the run completes whenever the executor returns.
      timeoutSeconds: input.timeoutSeconds ?? null,
      deliverResultTo,
      nextRunAt,
    });

    return webhookCredentials
      ? {
          trigger: row,
          // Plaintext secret — show once, never stored. Callers must
          // persist this on their side to sign future webhook requests.
          webhookSecret: webhookCredentials.secret,
          webhookPublicId,
        }
      : { trigger: row };
  },
});

const update_trigger_action = defineAction({
  name: 'update_trigger',
  description:
    'Patch a trigger. Cron / interval / runAt changes recompute nextRunAt automatically.',
  params: {
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    prompt: z.string().min(1).optional(),
    skillHints: z.array(z.string()).nullable().optional(),
    cronExpression: z.string().nullable().optional(),
    intervalSeconds: z.number().int().positive().nullable().optional(),
    runAt: z.string().nullable().optional(),
    timezone: z.string().nullable().optional(),
    activeHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    activeHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    concurrencyPolicy: triggerConcurrencyPolicy.optional(),
    catchUpPolicy: triggerCatchUpPolicy.optional(),
    model: z.string().nullable().optional(),
    effort: effortLevel.nullable().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    disabledReason: z.string().nullable().optional(),
    // Replace the notifier digest binding (full set, not a delta). Pass []
    // to unbind. Validated against the trigger's existing target_kind.
    deliverResultTo: z.array(z.string().min(1)).optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input;
    const current = getTrigger(id);
    if (!current) throw new ActionError('not_found', `Trigger not found: ${id}`);

    // App-managed rows: schedule + delivery are user-owned, identity/behavior
    // is not. Reject edits to locked fields; the friendly editor (e.g. Deck
    // settings) owns those. Internal callers bypass this via raw updateTrigger.
    if (isReservedTrigger(id)) {
      const locked = RESERVED_LOCKED_FIELDS.filter(
        (f) => (rest as Record<string, unknown>)[f] !== undefined,
      );
      if (locked.length > 0) {
        throw new ActionError(
          'conflict',
          `This trigger is managed by the app. You can change its schedule and delivery, but not: ${locked.join(', ')}.`,
        );
      }
    }

    // Verify the digest binding against the (immutable) target_kind before write.
    if (rest.deliverResultTo !== undefined) {
      rest.deliverResultTo = validateDeliverResultTo(rest.deliverResultTo, current.targetKind);
    }

    // Validate cron if it's changing.
    const cronExpression =
      rest.cronExpression !== undefined ? rest.cronExpression : current.cronExpression;
    if (cronExpression && current.kind === 'cron') {
      const tz = rest.timezone ?? current.timezone ?? 'UTC';
      const v = validateCronExpression(cronExpression, tz);
      if (!v.valid) throw new ActionError('invalid_params', `Invalid cron: ${v.error}`);
    }

    // Recompute nextRunAt when the trigger config changes.
    const triggerChanged =
      rest.cronExpression !== undefined ||
      rest.intervalSeconds !== undefined ||
      rest.runAt !== undefined ||
      rest.timezone !== undefined;
    let nextRunAt = current.nextRunAt;
    if (triggerChanged) {
      nextRunAt = computeNextRun({
        kind: current.kind,
        cronExpression: cronExpression ?? null,
        intervalSeconds:
          rest.intervalSeconds !== undefined ? rest.intervalSeconds : current.intervalSeconds,
        runAt: rest.runAt !== undefined ? rest.runAt : current.runAt,
        timezone: rest.timezone !== undefined ? rest.timezone : current.timezone,
        lastFiredAt: current.lastFiredAt,
      });
    }

    const row = updateTrigger(id, { ...rest, nextRunAt });
    return row;
  },
});

const delete_trigger_action = defineAction({
  name: 'delete_trigger',
  description:
    'Delete a trigger. Existing runs survive (trigger_id nulled). Owned execution is preserved. Many triggers can share executions, so removing one doesn\'t archive shared work.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    // App-managed rows are disabled, never deleted — otherwise the next boot's
    // ensure-seed would re-create the row and silently undo the user's intent.
    if (isReservedTrigger(id)) {
      throw new ActionError(
        'conflict',
        'This trigger is managed by the app. Disable it instead of deleting.',
      );
    }
    const ok = deleteTrigger(id);
    if (!ok) throw new ActionError('not_found', `Trigger not found: ${id}`);
    return { id, deleted: true };
  },
});

const run_trigger_action = defineAction({
  name: 'run_trigger',
  description:
    'Fire a trigger immediately, outside its cadence. Recorded as trigger=manual (user-initiated immediate) so the run history is consistent with chat-send dispatches.',
  params: {
    id: z.string().min(1),
    triggerPayload: z.unknown().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: async (_ctx, { id, triggerPayload }) => {
    const trigger = getTrigger(id);
    if (!trigger) throw new ActionError('not_found', `Trigger not found: ${id}`);
    // Lazy: see the import-section comment. Pulls in the executor adapter
    // and `@agentex/agent` only on actual run-trigger invocations.
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    const result = await dispatchRun({
      trigger,
      triggerKind: 'manual',
      triggerPayload: (triggerPayload as Record<string, unknown> | string | undefined) ?? null,
    });
    return { run: result.run, chatSessionId: result.chatSession?.id ?? null };
  },
});

const list_runs_action = defineAction({
  name: 'list_runs',
  description: 'List runs with filters. Defaults to newest-first across all sources.',
  params: {
    status: z.union([runStatusFilter, z.array(runStatusFilter)]).optional(),
    trigger: z.union([runTriggerFilter, z.array(runTriggerFilter)]).optional(),
    triggerId: z.string().optional(),
    agentId: z.string().optional(),
    executionId: z.string().optional(),
    workspaceId: z.string().optional(),
    since: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  },
  handler: (_ctx, input) => listRuns(input),
});

const get_run_action = defineAction({
  name: 'get_run',
  description: 'Fetch a single run by id, including usage and outcome metadata.',
  params: { id: z.string().min(1) },
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const row = getRun(id);
    if (!row) throw new ActionError('not_found', `Run not found: ${id}`);
    return row;
  },
});

const cancel_run_action = defineAction({
  name: 'cancel_run',
  description:
    'Best-effort cancel of an in-flight run. The agent receives SIGTERM via the executor. The run row is marked failed with status_reason=cancelled. Already-terminal runs return their current state unchanged.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: async (_ctx, { id }) => {
    const run = getRun(id);
    if (!run) throw new ActionError('not_found', `Run not found: ${id}`);
    if (run.status !== 'running' && run.status !== 'queued') {
      return run;
    }
    if (run.chatSessionId) {
      try {
        // Lazy: see the import-section comment. Pulls in `@agentex/agent`
        // only when a cancel actually needs to talk to a running session.
        const { abort: abortChatSession } = await import('@/lib/executor/adapter');
        await abortChatSession(run.chatSessionId);
      } catch (err) {
        console.warn(`[cancel_run] abort failed for ${run.chatSessionId}:`, err);
      }
    }
    return (
      markRunFailed(id, {
        errorCode: 'cancelled',
        errorMessage: 'Cancelled by user',
        statusReason: 'cancelled',
      }) ?? run
    );
  },
});

const reset_trigger_failures_action = defineAction({
  name: 'reset_trigger_failures',
  description:
    'Clear the consecutive_failures counter on a trigger. Used by the "Reset failure count" affordance once the user has investigated the failures. Does not change enabled state.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const row = resetTriggerFailures(id);
    if (!row) throw new ActionError('not_found', `Trigger not found: ${id}`);
    return row;
  },
});

const list_notification_channels_action = defineAction({
  name: 'list_notification_channels',
  description:
    "List the user's notification channels (Telegram connector, web push, in-app). Returns each channel's id, provider, label, target config and enabled state. Use the id to bind a trigger's result digest via create_trigger / update_trigger deliver_result_to. Channels themselves are created in the app UI (Telegram linking needs an OAuth-style claim flow).",
  params: {
    kind: z.enum(['connector', 'web_push', 'in_app']).optional(),
    providerId: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  },
  handler: (_ctx, { kind, providerId, enabled }) => {
    let channels = listNotificationChannels({ userId: getNotifierUserId(), enabled });
    if (kind) channels = channels.filter((c) => c.kind === kind);
    if (providerId) channels = channels.filter((c) => c.providerId === providerId);
    return { channels };
  },
});

const list_skills_action = defineAction({
  name: 'list_skills',
  description:
    'Return the merged skill inventory (brain-level + workspace-level) visible to the orchestrator. Workspace overrides global on name collision.',
  params: {
    workspaceCwd: z.string().nullable().optional(),
  },
  handler: (_ctx, { workspaceCwd }) => inventorySkills(workspaceCwd ?? null),
});

export const actions = [
  describe_paths,
  describe_schema,
  list_tasks_action,
  get_task_action,
  create_task_action,
  update_task_action,
  complete_task_action,
  transition_task_action,
  attach_execution_to_task_action,
  detach_execution_from_task_action,
  list_task_executions_action,
  review_execution_action,
  list_notes_action,
  get_note_action,
  list_backlinks_action,
  list_outgoing_links_action,
  create_note_action,
  update_note_action,
  list_stream_action,
  get_stream_item_action,
  create_stream_item_action,
  promote_stream_action,
  merge_stream_action,
  combine_stream_action,
  mark_stream_reviewed_action,
  dismiss_stream_action,
  incubate_stream_action,
  propose_stream_triage_action,
  undo_triage_decision_action,
  begin_stream_sweep_action,
  finish_stream_sweep_action,
  get_triage_metrics_action,
  list_areas_action,
  get_area_action,
  create_area_action,
  update_area_action,
  get_deck_action,
  update_deck_action,
  regenerate_deck_action,
  reconcile_deck_action,
  get_day_shape_action,
  search_action,
  get_user_state_action,
  update_user_state_action,
  list_workspaces_action,
  get_workspace_action,
  create_workspace_action,
  archive_workspace_action,
  list_reference_folders_action,
  create_reference_folder_action,
  update_reference_folder_action,
  archive_reference_folder_action,
  list_workspace_sessions_action,
  search_sessions_action,
  list_executions_action,
  get_session_messages_action,
  get_pending_input_action,
  answer_pending_input_action,
  send_session_message_action,
  list_triggers_action,
  get_trigger_action,
  create_trigger_action,
  update_trigger_action,
  delete_trigger_action,
  run_trigger_action,
  list_runs_action,
  get_run_action,
  cancel_run_action,
  reset_trigger_failures_action,
  list_notification_channels_action,
  list_skills_action,
  ...browserActions,
];
