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
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  archiveWorkspace,
  listChatSessions,
} from '@/lib/db/queries';
import { detectIsGit, detectBaseBranch, defaultWorktreeRoot } from '@/lib/workspaces';
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
// it's safe for an agent to set. Derived/audit columns (created_at, updated_at,
// times_deferred, completed_at, sort_key) stay out of the contract.
const taskCreateShape = {
  title: z.string().min(1),
  description: z.string().optional(),
  body: z.string().optional(),
  area_id: z.string().nullable().optional(),
  workspace_id: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  status: taskStatus.optional(),
  energy: taskEnergy.nullable().optional(),
  effort: taskEffort.nullable().optional(),
  estimated_minutes: z.number().int().positive().nullable().optional(),
  hard_deadline: z.string().nullable().optional(),
  reminder_at: z.string().nullable().optional(),
  recurrence: z.string().nullable().optional(),
  context_tags: z.array(z.string()).optional(),
  user_context: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
};

const noteCreateShape = {
  title: z.string().optional(),
  body: z.string().min(1),
  url: z.string().nullable().optional(),
  area_id: z.string().nullable().optional(),
  workspace_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
  status: noteStatus.optional(),
  context_tags: z.array(z.string()).optional(),
};

// ── Actions ──────────────────────────────────────────────────────

const describe_paths = defineAction({
  name: 'describe_paths',
  description:
    'Print the resolved on-disk paths the app uses (app root, brain dir, db, config). ' +
    'Reflects <APP>_ROOT / <APP>_BRAIN_PATH / <APP>_DB_PATH env overrides.',
  params: {},
  handler: () => ({
    app_root: getAppRoot(),
    brain_dir: getBrainDir(),
    db_path: getDbPath(),
    config_path: getConfigPath(),
    attachments_dir: getAttachmentsDir(),
    tmp_dir: getTmpDir(),
    db_exists: fs.existsSync(getDbPath()),
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
    area_id: z.string().nullable().optional(),
    parent_id: z.string().nullable().optional(),
    energy: taskEnergy.optional(),
    q: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
    order_by: z
      .enum(['sort_key', 'last_viewed_at', 'hard_deadline', 'created_at', 'updated_at'])
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
    const row = updateTask(id, rest);
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
    area_id: z.string().nullable().optional(),
    task_id: z.string().nullable().optional(),
    status: noteStatus.optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
    order_by: z.enum(['last_viewed_at', 'created_at', 'updated_at']).optional(),
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
    area_id: z.string().nullable().optional(),
    base_branch: z.string().nullable().optional(),
    remote_name: z.string().optional(),
    worktree_root: z.string().nullable().optional(),
  },
  mutating: true,
  handler: async (_ctx, input) => {
    const cwd = path.resolve(input.cwd);
    const isGit = await detectIsGit(cwd);
    const baseBranch = isGit
      ? input.base_branch ?? (await detectBaseBranch(cwd, input.remote_name ?? 'origin'))
      : null;
    return createWorkspace({
      name: input.name,
      emoji: input.emoji ?? null,
      cwd,
      is_git: isGit,
      base_branch: baseBranch,
      remote_name: isGit ? input.remote_name ?? 'origin' : null,
      worktree_root: isGit ? input.worktree_root ?? defaultWorktreeRoot(input.name) : null,
      area_id: input.area_id ?? null,
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
    workspace_id: z.string().min(1),
    status: workspaceStatus.optional(),
  },
  cli: { positional: ['workspace_id'] },
  handler: (_ctx, { workspace_id, status }) =>
    listChatSessions({ workspace_id, status: status ?? 'active' }),
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
  list_workspaces_action,
  get_workspace_action,
  create_workspace_action,
  archive_workspace_action,
  list_workspace_sessions_action,
];
