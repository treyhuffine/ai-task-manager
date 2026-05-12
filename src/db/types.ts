// Shared types derived from Drizzle schema — imported by both client and server.
// Source of truth: src/lib/db/schema.ts

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type {
  userState, areas, stream, tasks, taskCompletions, notes, decks, apiKeys,
  workspaces, agents, chatSessions, chatEvents,
} from '@/lib/db/schema';
export type { DeckItem, DeckAlternative, Attachment } from '@/lib/db/schema';

// ─── User State ────────────────────────────────────────────────

export type UserStateRecord = InferSelectModel<typeof userState>;
export type UpdateUserStateInput = Partial<Omit<InferInsertModel<typeof userState>, 'id'>>;

// ─── Areas ────────────────────────────────────────────────────

export type AreaRecord = InferSelectModel<typeof areas>;
export type CreateAreaInput = Omit<InferInsertModel<typeof areas>, 'id'>;
export type UpdateAreaInput = Partial<CreateAreaInput>;
export type AreaStatus = AreaRecord['status'];

// ─── Stream ───────────────────────────────────────────────────

export type StreamRecord = InferSelectModel<typeof stream>;
export type CreateStreamInput = Omit<InferInsertModel<typeof stream>, 'id'>;
export type UpdateStreamInput = Partial<CreateStreamInput>;
export type StreamSource = StreamRecord['source'];
export type StreamStatus = StreamRecord['status'];

// ─── Tasks ────────────────────────────────────────────────────

export type TaskRecord = InferSelectModel<typeof tasks>;
export type TaskListRecord = TaskRecord & { subtask_count: number; subtask_preview: string | null };
export type CreateTaskInput = Omit<InferInsertModel<typeof tasks>, 'id'>;
export type UpdateTaskInput = Partial<CreateTaskInput>;
export type TaskStatus = NonNullable<TaskRecord['status']>;
export type Energy = NonNullable<TaskRecord['energy']>;
export type Effort = NonNullable<TaskRecord['effort']>;

// ─── Task Completions ─────────────────────────────────────────

export type TaskCompletionRecord = InferSelectModel<typeof taskCompletions>;
export type CreateTaskCompletionInput = Omit<InferInsertModel<typeof taskCompletions>, 'id'>;

// ─── Notes ────────────────────────────────────────────────────

export type NoteRecord = InferSelectModel<typeof notes>;
export type CreateNoteInput = Omit<InferInsertModel<typeof notes>, 'id'>;
export type UpdateNoteInput = Partial<CreateNoteInput>;
export type NoteStatus = NonNullable<NoteRecord['status']>;

// ─── Decks ───────────────────────────────────────────────────

export type DeckRecord = InferSelectModel<typeof decks>;
export type CreateDeckInput = Omit<InferInsertModel<typeof decks>, 'id'>;
export type UpdateDeckInput = Partial<Omit<CreateDeckInput, 'created_at'>>;

// ─── API Keys ─────────────────────────────────────────────────

export type ApiKeyRecord = InferSelectModel<typeof apiKeys>;
export type CreateApiKeyInput = Omit<InferInsertModel<typeof apiKeys>, 'id' | 'prefix' | 'suffix' | 'hash'>;
// Only user-editable metadata is exposed — secret material and audit timestamps
// stay internal and cannot be mutated via the API.
export type UpdateApiKeyInput = Partial<Pick<CreateApiKeyInput, 'name' | 'description' | 'device_type'>>;
export type DeviceType = NonNullable<ApiKeyRecord['device_type']>;

// ─── Workspaces ───────────────────────────────────────────────

export type WorkspaceRecord = InferSelectModel<typeof workspaces>;
export type CreateWorkspaceInput = Omit<InferInsertModel<typeof workspaces>, 'id'>;
export type UpdateWorkspaceInput = Partial<Omit<CreateWorkspaceInput, 'created_at'>>;
export type WorkspaceStatus = WorkspaceRecord['status'];

/**
 * Workspace row + aggregated info from its child sessions. The list view
 * uses these counts to render the workspace-header badges and decide
 * whether the row should hide its (empty) child slot.
 */
export interface WorkspaceWithCounts extends WorkspaceRecord {
  session_count: number;
  needs_review_candidate_count: number;
  active_session_count: number;
}

// ─── Agents ───────────────────────────────────────────────────

export type AgentRecord = InferSelectModel<typeof agents>;
export type CreateAgentInput = Omit<InferInsertModel<typeof agents>, 'id'>;
export type UpdateAgentInput = Partial<Omit<CreateAgentInput, 'created_at'>>;
export type AgentKind = AgentRecord['kind'];

// ─── Chat Sessions ────────────────────────────────────────────

export type ChatSessionRecord = InferSelectModel<typeof chatSessions>;
export type CreateChatSessionInput = Omit<InferInsertModel<typeof chatSessions>, 'id'>;
export type UpdateChatSessionInput = Partial<Omit<CreateChatSessionInput, 'started_at'>>;
export type ChatSessionType = ChatSessionRecord['type'];
export type ChatSessionStatus = ChatSessionRecord['status'];

// ─── Chat Events ──────────────────────────────────────────────

export type ChatEventRecord = InferSelectModel<typeof chatEvents>;
/**
 * Insert shape for `chat_events`. `id` is optional — `insertChatEvent`
 * mints a UUIDv7 when the caller doesn't provide one. Callers that
 * want client/server id parity (optimistic UI, replay-from-disk) pass
 * the id explicitly so both sides write the same row identity.
 */
export type CreateChatEventInput = Omit<InferInsertModel<typeof chatEvents>, 'id'> & { id?: string };

/** App-level enum of `chat_events.source`. Stored as text — no DB CHECK. */
export type ChatEventSource =
  | 'user' | 'agent' | 'thinking' | 'tool_call' | 'tool_result'
  | 'system' | 'result' | 'rate_limit' | 'error' | 'recap'
  | 'permission_request' | 'permission_response'
  | 'question_request' | 'question_response'
  | 'auth_required'
  | 'cron' | 'unknown';

/** Outcome events bump `chat_sessions.last_outcome_event_at`. */
export const OUTCOME_SOURCES: ReadonlySet<ChatEventSource> = new Set(['agent', 'result']);

/**
 * Permission modes for execution sessions.
 *
 * - `bypass`   — auto-allow every tool. No --permission-mode flag passed
 *                to Claude. Default for new sessions; matches the legacy
 *                Flow behavior where the executor never prompted.
 * - `default`  — Claude prompts via stdio for every mutating tool. The
 *                pending-input UI surfaces the prompt.
 * - `accept_edits` — Claude auto-allows Write/Edit/MultiEdit inside cwd;
 *                Bash/etc still prompt. Maps to `--permission-mode acceptEdits`.
 * - `plan`     — Claude refuses to mutate state and produces a plan for
 *                user approval. Maps to `--permission-mode plan`. Plus
 *                EnterPlanMode/ExitPlanMode tools become available.
 *
 * AskUserQuestion always surfaces to the user regardless of mode.
 */
export type PermissionMode = NonNullable<ChatSessionRecord['permission_mode']>;

export const PERMISSION_MODES = ['bypass', 'default', 'accept_edits', 'plan'] as const satisfies readonly PermissionMode[];

export type EffortLevel = NonNullable<ChatSessionRecord['effort']>;

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly EffortLevel[];

// ─── Filters (query params) ──────────────────────────────────

export interface AreaFilter {
  status?: AreaStatus | 'all';
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  area_id?: string | null;
  parent_id?: string | null;
  energy?: Energy;
  q?: string;
  limit?: number;
  offset?: number;
  order_by?: string;
}

export interface NoteFilter {
  area_id?: string | null;
  task_id?: string | null;
  status?: NoteStatus;
  limit?: number;
  offset?: number;
  order_by?: string;
}

export interface StreamFilter {
  status?: StreamStatus;
  limit?: number;
  offset?: number;
}
