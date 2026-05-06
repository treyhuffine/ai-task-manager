// Shared types derived from Drizzle schema — imported by both client and server.
// Source of truth: src/lib/db/schema.ts

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type {
  userState, areas, stream, tasks, taskCompletions, notes, decks, apiKeys,
  workspaces, agents, chatSessions, chatEvents, chatAttachments,
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
export type CreateChatEventInput = Omit<InferInsertModel<typeof chatEvents>, 'id'>;

/** App-level enum of `chat_events.source`. Stored as text — no DB CHECK. */
export type ChatEventSource =
  | 'user' | 'agent' | 'thinking' | 'tool_call' | 'tool_result'
  | 'system' | 'result' | 'rate_limit' | 'error' | 'recap'
  | 'cron' | 'unknown';

/** Outcome events bump `chat_sessions.last_outcome_event_at`. */
export const OUTCOME_SOURCES: ReadonlySet<ChatEventSource> = new Set(['agent', 'result']);

// ─── Chat Attachments ─────────────────────────────────────────

export type ChatAttachmentRecord = InferSelectModel<typeof chatAttachments>;
export type CreateChatAttachmentInput = Omit<InferInsertModel<typeof chatAttachments>, 'id'>;

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
