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
import { defineAction, ActionError } from './types';
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  completeTask,
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
  listChatSessions,
  listRailSessions,
  getChatSession,
  listChatEvents,
  listSchedulesWithLastRun,
  getSchedule,
  findScheduleByName,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listRuns,
  getRun,
  markRunFailed,
  resetScheduleFailures,
  getOrCreateDefaultExecutor,
  getOrCreateDefaultOrchestrator,
} from '@/lib/db/queries';
import { detectIsGit, detectBaseBranch, defaultWorktreeRoot } from '@/lib/workspaces';
import { validateCronExpression, computeNextRun } from '@/lib/scheduler/cron';
import { generateWebhookCredentials } from '@/lib/scheduler/webhook';
// `dispatchRun` and the executor `abort` transitively load `@agentex/agent`,
// which has no `require` condition in its package exports. Top-level imports
// here would crash `tsx src/cli/index.ts` (CJS resolution) on every CLI
// invocation — even `flow start --dev`, which doesn't need either symbol.
// Loading them lazily inside the two action handlers that use them lets the
// dev CLI boot under tsx and matches the actual call graph: `run_schedule`
// and `cancel_run` are the only paths that touch the executor.
import { inventorySkills } from '@/lib/executor/skills';
import { fetchLiveSignals, serverFetch } from './server-client';
import { condenseEvents, derivePendingFromEvents } from './session-oversight';
import { isSessionUnread } from '@/lib/utils/session-sort';
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

const taskStatus = z.enum(['active', 'done', 'archived']);
const taskEnergy = z.enum(['deep', 'light']);
const taskEffort = z.enum(['trivial', 'small', 'medium', 'large', 'epic']);
const noteStatus = z.enum(['active', 'archived']);

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
  status: taskStatus.optional(),
  energy: taskEnergy.nullable().optional(),
  effort: taskEffort.nullable().optional(),
  estimatedMinutes: z.number().int().positive().nullable().optional(),
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
    'proposing new actions — lets an agent ground itself in the real column shape ' +
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
    status: z.union([taskStatus, z.array(taskStatus)]).optional(),
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
  description: 'Update a task by id. All fields optional; unspecified fields keep their value.',
  params: {
    id: z.string().min(1),
    ...Object.fromEntries(
      Object.entries(taskCreateShape).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ),
  } as typeof taskCreateShape & { id: z.ZodString },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input as { id: string } & Partial<z.infer<z.ZodObject<typeof taskCreateShape>>>;
    // Edits through the agent surface (CLI/MCP) are attributed to the agent
    // so the in-document chat can surface a reviewable diff + one-tap undo.
    const row = updateTask(id, rest, { source: 'ai' });
    if (!row) throw new ActionError('not_found', `Task not found: ${id}`);
    return row;
  },
});

const complete_task_action = defineAction({
  name: 'complete_task',
  description:
    'Mark a task complete. Recurring tasks roll to the next occurrence instead of closing.',
  params: {
    id: z.string().min(1),
    note: z.string().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id, note }) => {
    const result = completeTask(id, note);
    if (!result) throw new ActionError('not_found', `Task not found: ${id}`);
    return result;
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
    'Update a note by id. All fields optional; unspecified fields keep their value. ' +
    'Set status=archived instead of deleting — there is no delete action by design.',
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
// The quick-capture inbox: brain dumps that get triaged into tasks/notes
// or dismissed. Promotion is the one compound action here — it creates the
// target entity AND stamps the stream row's promotion links in one call,
// so the agent can't leave a half-promoted item behind (the UI does the
// same two steps client-side; see stream-list.tsx).

const streamStatus = z.enum(['pending', 'promoted', 'dismissed']);

const list_stream_action = defineAction({
  name: 'list_stream',
  description:
    'List stream items (quick-capture inbox). Defaults to status=pending — the untriaged queue.',
  params: {
    status: streamStatus.optional(),
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
    'task or a note yet — the triage pass (human or agent) decides later.',
  params: {
    rawText: z.string().min(1),
  },
  mutating: true,
  handler: (_ctx, { rawText }) => createStream({ rawText, source: 'chat' }),
});

const promote_stream_action = defineAction({
  name: 'promote_stream',
  description:
    'Promote a pending stream item into a task or a note. Creates the entity and stamps the stream ' +
    "row's promotion links in one step. Shape the title yourself (imperative for tasks); the item's " +
    'raw text and attachments carry over as the body unless overridden.',
  params: {
    id: z.string().min(1),
    to: z.enum(['task', 'note']),
    /** Shaped title. Tasks: imperative ("Ship the manifest"). Optional for notes. */
    title: z.string().optional(),
    /** Override body; defaults to the item's raw text. */
    body: z.string().optional(),
    areaId: z.string().nullable().optional(),
    /** Task promotion only: create as a subtask of this task. */
    parentId: z.string().nullable().optional(),
    /** Note promotion only: link the note to this task. */
    taskId: z.string().nullable().optional(),
    energy: taskEnergy.nullable().optional(),
    effort: taskEffort.nullable().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, input) => {
    const item = getStream(input.id);
    if (!item) throw new ActionError('not_found', `Stream item not found: ${input.id}`);
    if (item.status !== 'pending') {
      throw new ActionError(
        'conflict',
        `Stream item is already ${item.status}${item.promotedToType ? ` (→ ${item.promotedToType} ${item.promotedToId})` : ''}.`,
      );
    }

    const body = input.body ?? item.rawText;
    let promotedToType: 'task' | 'note';
    let created: Record<string, unknown> & { id: string };

    if (input.to === 'task') {
      promotedToType = 'task';
      created = createTask({
        rawInput: item.rawText,
        title: input.title ?? truncateForTitle(item.rawText),
        body,
        areaId: input.areaId ?? null,
        parentId: input.parentId ?? null,
        energy: input.energy ?? null,
        effort: input.effort ?? null,
        attachments: item.attachments ?? [],
      });
    } else {
      promotedToType = 'note';
      created = createNote({
        title: input.title,
        body,
        areaId: input.areaId ?? null,
        taskId: input.taskId ?? null,
        attachments: item.attachments ?? [],
      });
    }

    const streamRow = updateStream(item.id, {
      status: 'promoted',
      promotedToType,
      promotedToId: created.id,
      promotedAt: new Date().toISOString(),
    });

    return { stream: streamRow, [promotedToType]: created };
  },
});

const dismiss_stream_action = defineAction({
  name: 'dismiss_stream',
  description:
    'Dismiss a pending stream item (noise, duplicates, no-longer-relevant). Dismissed items keep ' +
    'their text and stay searchable — this is triage, not deletion.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const item = getStream(id);
    if (!item) throw new ActionError('not_found', `Stream item not found: ${id}`);
    if (item.status !== 'pending') {
      throw new ActionError('conflict', `Stream item is already ${item.status}.`);
    }
    return dismissStream(id, 'agent');
  },
});

/** First line of raw capture text, clipped to a title-sized length. */
function truncateForTitle(rawText: string): string {
  const firstLine = rawText.trim().split('\n')[0] ?? '';
  return firstLine.length <= 200 ? firstLine : firstLine.slice(0, 199).trimEnd() + '…';
}

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
    'List areas (life/work domains like "Work", "Health"). Areas organize tasks and notes — ' +
    'look up area ids here before filtering or linking.',
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
    'Update an area by id. All fields optional. Archive via status=archived — there is no delete.',
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
    "Get the deck — the day's ranked priority stack of tasks plus alternatives. " +
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
    'Update a deck by id — reorder or swap items, edit alternatives, or change the framing. ' +
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
    const { generateDeck } = await import('@/lib/ai/generate-deck');
    return generateDeck(input);
  },
});

const reconcile_deck_action = defineAction({
  name: 'reconcile_deck',
  description:
    "Re-check today's deck against the live calendar and adapt it to external changes " +
    '(e.g. a new meeting shrinks the day → bump the lowest-priority item, narrated and ' +
    'reversible). Deterministic — no model call, safe to run on a cadence. No-op until a ' +
    'calendar connector is registered.',
  params: {
    in_focus: z.boolean().optional(),
  },
  mutating: true,
  handler: async (_ctx, input) => {
    const { reconcileDeckWithExternalChanges } = await import('@/lib/deck/reconcile-external');
    return reconcileDeckWithExternalChanges({ inFocus: input.in_focus });
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
    'Only these focus fields are exposed — app settings are not writable from the agent surface.',
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
    'Create a workspace tied to a folder on disk. Git is auto-detected; for git repos the base branch is resolved from <remote>/HEAD with main/master fallback.',
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
  description: 'Archive a workspace. Sessions stay queryable; nothing on disk is touched.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const row = archiveWorkspace(id);
    if (!row) throw new ActionError('not_found', `Workspace not found: ${id}`);
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
    'flight), awaitingInput (blocked on a prompt), unread (output the user has not viewed — what ' +
    'the rail\'s Unread section shows, minus currently-running sessions). The returned sessionId ' +
    'is the handle for get_session_messages and send_session_message.',
  params: {},
  handler: async () => {
    const rows = listRailSessions();
    const live = await fetchLiveSignals();
    return {
      /** False ⇒ the app server was unreachable: running/awaitingInput are unknown-but-idle. */
      live: live !== null,
      executions: rows.map((r) => {
        const running = live?.runningSessionIds.includes(r.id) ?? false;
        return {
          sessionId: r.id,
          executionId: r.executionId,
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
    'tail — user/agent text, one-line tool calls, errors — plus whether the session is running or ' +
    'blocked on a permission/question prompt. Read this before nudging a session.',
  params: {
    sessionId: z.string().min(1),
    limit: z.number().int().positive().max(200).optional(),
  },
  cli: { positional: ['sessionId'] },
  handler: async (_ctx, { sessionId, limit }) => {
    const session = getChatSession(sessionId);
    if (!session) throw new ActionError('not_found', `Session not found: ${sessionId}`);

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
    'messages until its prompt is resolved — answering is the only way to unblock it.',
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
    '(allow=false declines). Only answer on the user\'s clear intent — when in doubt, surface the ' +
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
      note: 'The blocked turn resumes now — check get_session_messages for what it does next.',
    };
  },
});

const send_session_message_action = defineAction({
  name: 'send_session_message',
  description:
    'Send a message into a session — nudge a stalled execution, answer a question in prose, or steer ' +
    'direction. Delivered through the app server: it lands in the agent\'s queue mid-turn or starts a ' +
    'new turn. Fire-and-forget — poll get_session_messages for the response. Never send to your own session.',
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
        'Session is archived — resume it from the app before messaging it.',
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
      note: 'Dispatched. The session processes asynchronously — check get_session_messages shortly.',
    };
  },
});

// ── Schedules + Runs ─────────────────────────────────────────

const scheduleKind = z.enum(['manual', 'at', 'every', 'cron', 'webhook']);
const scheduleTargetKind = z.enum(['workspace', 'orchestrator']);
const scheduleConcurrencyPolicy = z.enum([
  'skip_if_running',
  'coalesce_if_active',
  'allow_concurrent',
]);
const scheduleCatchUpPolicy = z.enum(['skip_missed', 'run_all']);
const effortLevel = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const runStatusFilter = z.enum(['queued', 'running', 'completed', 'failed', 'skipped']);
const runTriggerFilter = z.enum(['manual', 'cron', 'every', 'at', 'webhook']);

const list_schedules_action = defineAction({
  name: 'list_schedules',
  description: 'List schedules with last-run rollup. Filters: enabled, kind, target, workspace_id.',
  params: {
    enabled: z.boolean().optional(),
    kind: scheduleKind.optional(),
    targetKind: scheduleTargetKind.optional(),
    workspaceId: z.string().nullable().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  },
  handler: (_ctx, input) => listSchedulesWithLastRun(input),
});

const get_schedule_action = defineAction({
  name: 'get_schedule',
  description: 'Fetch a single schedule by id (or unique name within scope).',
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
      ? getSchedule(id)
      : findScheduleByName(name!, workspaceId ?? null);
    if (!row) throw new ActionError('not_found', `Schedule not found: ${id ?? name}`);
    return row;
  },
});

const createScheduleShape = {
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  // Optional in the contract: the handler defaults to the
  // orchestrator agent (target=orchestrator) or the workspace's bound
  // executor (target=workspace) when omitted. Same form-level default
  // policy the spec describes; surfaces the same handle to CLI + UI.
  agentId: z.string().min(1).optional(),
  workspaceId: z.string().nullable().optional(),
  targetKind: scheduleTargetKind,
  prompt: z.string().min(1),
  skillHints: z.array(z.string()).nullable().optional(),
  kind: scheduleKind,
  cronExpression: z.string().nullable().optional(),
  intervalSeconds: z.number().int().positive().nullable().optional(),
  runAt: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  activeHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  activeHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  concurrencyPolicy: scheduleConcurrencyPolicy.optional(),
  catchUpPolicy: scheduleCatchUpPolicy.optional(),
  maxCatchUpRuns: z.number().int().positive().max(10).optional(),
  model: z.string().nullable().optional(),
  effort: effortLevel.nullable().optional(),
  timeoutSeconds: z.number().int().positive().nullable().optional(),
} as const;

const create_schedule_action = defineAction({
  name: 'create_schedule',
  description:
    'Create a schedule. Kind-specific fields are enforced (cron requires cron_expression, every requires interval_seconds, at requires run_at, webhook generates credentials, manual takes no cadence fields and only fires via run_schedule).',
  params: createScheduleShape,
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
      // Orchestrator schedules don't anchor to a workspace; allowing
      // a workspaceId here would let an orchestration chat be created
      // with a workspace cwd via `createChatForFire` (dispatch.ts),
      // which is the wrong execution-isolation story.
      throw new ActionError('invalid_params', 'workspace_id must be null when target_kind=orchestrator');
    }

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

    const row = createSchedule({
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
      nextRunAt,
    });

    return webhookCredentials
      ? {
          schedule: row,
          // Plaintext secret — show once, never stored. Callers must
          // persist this on their side to sign future webhook requests.
          webhookSecret: webhookCredentials.secret,
          webhookPublicId,
        }
      : { schedule: row };
  },
});

const update_schedule_action = defineAction({
  name: 'update_schedule',
  description:
    'Patch a schedule. Cron / interval / runAt changes recompute nextRunAt automatically.',
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
    concurrencyPolicy: scheduleConcurrencyPolicy.optional(),
    catchUpPolicy: scheduleCatchUpPolicy.optional(),
    model: z.string().nullable().optional(),
    effort: effortLevel.nullable().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    disabledReason: z.string().nullable().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, input) => {
    const { id, ...rest } = input;
    const current = getSchedule(id);
    if (!current) throw new ActionError('not_found', `Schedule not found: ${id}`);

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

    const row = updateSchedule(id, { ...rest, nextRunAt });
    return row;
  },
});

const delete_schedule_action = defineAction({
  name: 'delete_schedule',
  description:
    'Delete a schedule. Existing runs survive (schedule_id nulled). Owned execution is preserved — many schedules can share executions, so removing one doesn\'t archive shared work.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const ok = deleteSchedule(id);
    if (!ok) throw new ActionError('not_found', `Schedule not found: ${id}`);
    return { id, deleted: true };
  },
});

const run_schedule_action = defineAction({
  name: 'run_schedule',
  description:
    'Fire a schedule immediately, outside its cadence. Recorded as trigger=manual (user-initiated immediate) so the run history is consistent with chat-send dispatches.',
  params: {
    id: z.string().min(1),
    triggerPayload: z.unknown().optional(),
  },
  mutating: true,
  cli: { positional: ['id'] },
  handler: async (_ctx, { id, triggerPayload }) => {
    const schedule = getSchedule(id);
    if (!schedule) throw new ActionError('not_found', `Schedule not found: ${id}`);
    // Lazy: see the import-section comment. Pulls in the executor adapter
    // and `@agentex/agent` only on actual run-trigger invocations.
    const { dispatchRun } = await import('@/lib/runs/dispatch');
    const result = await dispatchRun({
      schedule,
      trigger: 'manual',
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
    scheduleId: z.string().optional(),
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
    'Best-effort cancel of an in-flight run. The agent receives SIGTERM via the executor; the run row is marked failed with status_reason=cancelled. Already-terminal runs return their current state unchanged.',
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

const reset_schedule_failures_action = defineAction({
  name: 'reset_schedule_failures',
  description:
    'Clear the consecutive_failures counter on a schedule. Used by the "Reset failure count" affordance once the user has investigated the failures. Does not change enabled state.',
  params: { id: z.string().min(1) },
  mutating: true,
  cli: { positional: ['id'] },
  handler: (_ctx, { id }) => {
    const row = resetScheduleFailures(id);
    if (!row) throw new ActionError('not_found', `Schedule not found: ${id}`);
    return row;
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
  list_notes_action,
  get_note_action,
  create_note_action,
  update_note_action,
  list_stream_action,
  get_stream_item_action,
  create_stream_item_action,
  promote_stream_action,
  dismiss_stream_action,
  list_areas_action,
  get_area_action,
  create_area_action,
  update_area_action,
  get_deck_action,
  update_deck_action,
  regenerate_deck_action,
  reconcile_deck_action,
  search_action,
  get_user_state_action,
  update_user_state_action,
  list_workspaces_action,
  get_workspace_action,
  create_workspace_action,
  archive_workspace_action,
  list_workspace_sessions_action,
  list_executions_action,
  get_session_messages_action,
  get_pending_input_action,
  answer_pending_input_action,
  send_session_message_action,
  list_schedules_action,
  get_schedule_action,
  create_schedule_action,
  update_schedule_action,
  delete_schedule_action,
  run_schedule_action,
  list_runs_action,
  get_run_action,
  cancel_run_action,
  reset_schedule_failures_action,
  list_skills_action,
];
