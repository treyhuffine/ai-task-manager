// Shared types derived from Drizzle schema — imported by both client and server.
// Source of truth: src/lib/db/schema.ts

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type {
  userState, agentHarnessSettings, agentHarnessOperations, areas, stream, tasks, taskCompletions, notes, decks, apiKeys,
  workspaces, agents, executions, chatSessions, chatEvents, chatRefs,
  triggers, runs, previewTargets, entityVersions,
  notificationChannels, webPushSubscriptions, notificationDeliveries,
  triagePasses, triageDecisions, streamLinks,
  Attachment,
} from '@/lib/db/schema';
export type { DeckItem, DeckAlternative, DeckChange, DeckOrigin, CalendarBlock, Attachment, StoredAttachment, RunArtifactRef, PreviewUrl, EntityVersionSnapshot, StoredNotificationEvent, StoredRenderedNotification, TriageDraft, StreamAutonomyConfig, StreamAutonomyLevel, TriageDisposition } from '@/lib/db/schema';

/**
 * Override the `attachments` column type on a record. Drizzle infers the
 * on-disk `StoredAttachment[]` shape; the app sees camelCase `Attachment[]`
 * because `queries.ts` hydrates on read.
 *
 * Preserves whether the field is required (selects) or optional (inserts —
 * the column has a `default([])` so callers don't have to specify it).
 */
// Probe whether `attachments` is optional on `T`. When the key is optional,
// `Pick<T, 'attachments'>` is assignable from an empty object — hence the
// `Record<string, never>` (typed "no properties") on the left of `extends`.
type WithCamelAttachments<T> =
  T extends { attachments?: unknown }
    ? Omit<T, 'attachments'> & (Record<string, never> extends Pick<T, 'attachments' & keyof T> ? { attachments?: Attachment[] | null } : { attachments: Attachment[] | null })
    : T;

// ─── User State ────────────────────────────────────────────────

export type UserStateRecord = InferSelectModel<typeof userState>;
export type UpdateUserStateInput = Partial<Omit<InferInsertModel<typeof userState>, 'id'>>;

export type AgentHarnessSettingsRecord = InferSelectModel<typeof agentHarnessSettings>;
export type UpsertAgentHarnessSettingsInput = Omit<InferInsertModel<typeof agentHarnessSettings>, 'id'> & { id?: string };
export type AgentHarnessOperationRecord = InferSelectModel<typeof agentHarnessOperations>;

// ─── Areas ────────────────────────────────────────────────────

export type AreaRecord = WithCamelAttachments<InferSelectModel<typeof areas>>;
export type CreateAreaInput = WithCamelAttachments<Omit<InferInsertModel<typeof areas>, 'id'>>;
export type UpdateAreaInput = Partial<CreateAreaInput>;
export type AreaStatus = AreaRecord['status'];

// ─── Stream ───────────────────────────────────────────────────

export type StreamRecord = WithCamelAttachments<InferSelectModel<typeof stream>>;
export type CreateStreamInput = WithCamelAttachments<Omit<InferInsertModel<typeof stream>, 'id'>>;
export type UpdateStreamInput = Partial<CreateStreamInput>;
export type StreamSource = StreamRecord['source'];
export type StreamStatus = StreamRecord['status'];

// ─── Stream Triage ────────────────────────────────────────────

export type TriagePassRecord = InferSelectModel<typeof triagePasses>;
export type CreateTriagePassInput = Omit<InferInsertModel<typeof triagePasses>, 'id'>;
export type TriagePassTrigger = TriagePassRecord['trigger'];
export type TriagePassStatus = TriagePassRecord['status'];

export type TriageDecisionRecord = InferSelectModel<typeof triageDecisions>;
export type CreateTriageDecisionInput = Omit<InferInsertModel<typeof triageDecisions>, 'id'>;
export type TriageDecisionState = TriageDecisionRecord['state'];
export type TriageActor = TriageDecisionRecord['actor'];

export type StreamLinkRecord = InferSelectModel<typeof streamLinks>;
export type CreateStreamLinkInput = Omit<InferInsertModel<typeof streamLinks>, 'id'>;
export type StreamLinkRelation = StreamLinkRecord['relation'];

/** A stream link joined with its entity's display title, for outcome
 *  annotations ("Added to Onboarding UX") without a per-item fetch. */
export interface StreamOutcome {
  entityType: 'task' | 'note';
  entityId: string;
  relation: StreamLinkRelation;
  entityTitle: string | null;
  decisionId: string | null;
}

/** Stream row plus derived outcome annotations for the ledger UI. */
export type StreamRecordWithOutcomes = StreamRecord & { outcomes: StreamOutcome[] };

// ─── Tasks ────────────────────────────────────────────────────

export type TaskRecord = WithCamelAttachments<InferSelectModel<typeof tasks>>;
export type TaskListRecord = TaskRecord & { subtaskCount: number; subtaskPreview: string | null };
export type CreateTaskInput = WithCamelAttachments<Omit<InferInsertModel<typeof tasks>, 'id'>>;
export type UpdateTaskInput = Partial<CreateTaskInput>;
export type TaskStatus = NonNullable<TaskRecord['status']>;
export type Energy = NonNullable<TaskRecord['energy']>;
export type Effort = NonNullable<TaskRecord['effort']>;

// ─── Task Completions ─────────────────────────────────────────

export type TaskCompletionRecord = InferSelectModel<typeof taskCompletions>;
export type CreateTaskCompletionInput = Omit<InferInsertModel<typeof taskCompletions>, 'id'>;

// ─── Notes ────────────────────────────────────────────────────

export type NoteRecord = WithCamelAttachments<InferSelectModel<typeof notes>>;
export type CreateNoteInput = WithCamelAttachments<Omit<InferInsertModel<typeof notes>, 'id'>>;
export type UpdateNoteInput = Partial<CreateNoteInput>;
export type NoteStatus = NonNullable<NoteRecord['status']>;

// ─── Entity Versions ──────────────────────────────────────────

export type EntityVersionRecord = InferSelectModel<typeof entityVersions>;
export type CreateEntityVersionInput = Omit<InferInsertModel<typeof entityVersions>, 'id' | 'createdAt'>;
export type EntityVersionSource = NonNullable<EntityVersionRecord['source']>;
export type EntityVersionEntityType = EntityVersionRecord['entityType'];

// ─── Decks ───────────────────────────────────────────────────

export type DeckRecord = InferSelectModel<typeof decks>;
export type CreateDeckInput = Omit<InferInsertModel<typeof decks>, 'id'>;
export type UpdateDeckInput = Partial<Omit<CreateDeckInput, 'createdAt'>>;

// ─── API Keys ─────────────────────────────────────────────────

export type ApiKeyRecord = InferSelectModel<typeof apiKeys>;
export type CreateApiKeyInput = Omit<InferInsertModel<typeof apiKeys>, 'id' | 'prefix' | 'suffix' | 'hash'>;
// Only user-editable metadata is exposed — secret material and audit timestamps
// stay internal and cannot be mutated via the API.
export type UpdateApiKeyInput = Partial<Pick<CreateApiKeyInput, 'name' | 'description' | 'deviceType'>>;
export type DeviceType = NonNullable<ApiKeyRecord['deviceType']>;

// ─── Workspaces ───────────────────────────────────────────────

export type WorkspaceRecord = WithCamelAttachments<InferSelectModel<typeof workspaces>>;
export type CreateWorkspaceInput = WithCamelAttachments<Omit<InferInsertModel<typeof workspaces>, 'id'>>;
export type UpdateWorkspaceInput = Partial<Omit<CreateWorkspaceInput, 'createdAt'>>;
export type WorkspaceStatus = WorkspaceRecord['status'];
export type { WorkspaceConnectorScope, WorkspaceConnectorScopeAccount } from '@/lib/db/schema';

/**
 * Workspace row + aggregated info from its child sessions. The list view
 * uses these counts to render the workspace-header badges and decide
 * whether the row should hide its (empty) child slot.
 */
export interface WorkspaceWithCounts extends WorkspaceRecord {
  sessionCount: number;
  needsReviewCandidateCount: number;
  activeSessionCount: number;
}

// ─── Agents ───────────────────────────────────────────────────

export type AgentRecord = InferSelectModel<typeof agents>;
export type CreateAgentInput = Omit<InferInsertModel<typeof agents>, 'id'>;
export type UpdateAgentInput = Partial<Omit<CreateAgentInput, 'createdAt'>>;
export type AgentKind = AgentRecord['kind'];

// ─── Executions ───────────────────────────────────────────────

export type ExecutionRecord = InferSelectModel<typeof executions>;
export type CreateExecutionInput = Omit<InferInsertModel<typeof executions>, 'id'> & { id?: string };
export type UpdateExecutionInput = Partial<Omit<CreateExecutionInput, 'createdAt'>>;
export type ExecutionStatus = ExecutionRecord['status'];

// ─── Preview Targets ──────────────────────────────────────────

export type PreviewTargetRecord = InferSelectModel<typeof previewTargets>;
export type CreatePreviewTargetInput = Omit<InferInsertModel<typeof previewTargets>, 'id'> & { id?: string };
export type UpdatePreviewTargetInput = Partial<Omit<CreatePreviewTargetInput, 'createdAt' | 'executionId'>>;

// ─── Chat Sessions ────────────────────────────────────────────

export type ChatSessionRecord = InferSelectModel<typeof chatSessions>;
export type CreateChatSessionInput = Omit<InferInsertModel<typeof chatSessions>, 'id'>;
export type UpdateChatSessionInput = Partial<Omit<CreateChatSessionInput, 'startedAt'>>;
export type ChatSessionType = ChatSessionRecord['type'];
export type ChatSessionStatus = ChatSessionRecord['status'];

/**
 * A chat_session joined to its execution, with the execution's durable
 * git/worktree/PR/takeover state flattened onto the top level. This is the
 * read shape every consumer of worktree/branch/PR/takeover state uses
 * (`getChatSessionWithExecution`).
 */
export type ChatSessionWithExecution = ChatSessionRecord & {
  execution: ExecutionRecord | null;
  worktreePath: string | null;
  branchName: string | null;
  baseSha: string | null;
  prNumber: number | null;
  setupError: string | null;
  setupStartedAt: string | null;
  setupScriptStatus: 'running' | 'done' | 'failed' | null;
  setupScriptError: string | null;
  takeoverStartedAt: string | null;
  takeoverBaseSha: string | null;
  takeoverBranch: string | null;
  takeoverToken: string | null;
  takeoverTokenExpiresAt: string | null;
};

// ─── Chat Events ──────────────────────────────────────────────

export type ChatEventRecord = WithCamelAttachments<InferSelectModel<typeof chatEvents>>;

// ─── Chat Refs ────────────────────────────────────────────────

export type ChatRefRecord = InferSelectModel<typeof chatRefs>;
export type CreateChatRefInput = Omit<InferInsertModel<typeof chatRefs>, 'id'> & { id?: string };
export type UpdateChatRefInput = Partial<Omit<CreateChatRefInput, 'createdAt' | 'sessionId'>>;
export type ChatRefEntityType = ChatRefRecord['entityType'];
export type ChatRefCreatedBy = ChatRefRecord['createdBy'];
/**
 * Insert shape for `chat_events`. `id` is optional — `insertChatEvent`
 * mints a UUIDv7 when the caller doesn't provide one. Callers that
 * want client/server id parity (optimistic UI, replay-from-disk) pass
 * the id explicitly so both sides write the same row identity.
 */
export type CreateChatEventInput = WithCamelAttachments<Omit<InferInsertModel<typeof chatEvents>, 'id'>> & { id?: string };

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
export type PermissionMode = NonNullable<ChatSessionRecord['permissionMode']>;

export const PERMISSION_MODES = ['bypass', 'default', 'accept_edits', 'plan'] as const satisfies readonly PermissionMode[];

export type EffortLevel = NonNullable<ChatSessionRecord['effort']>;

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const satisfies readonly EffortLevel[];

// ─── Triggers ─────────────────────────────────────────────────

export type TriggerRecord = InferSelectModel<typeof triggers>;
export type CreateTriggerInput = Omit<InferInsertModel<typeof triggers>, 'id'> & { id?: string };
export type UpdateTriggerInput = Partial<Omit<CreateTriggerInput, 'createdAt'>>;
export type TriggerKind = TriggerRecord['kind'];
export type TriggerTargetKind = TriggerRecord['targetKind'];
export type TriggerConcurrencyPolicy = TriggerRecord['concurrencyPolicy'];
export type TriggerCatchUpPolicy = TriggerRecord['catchUpPolicy'];
export type TriggerLastRunStatus = NonNullable<TriggerRecord['lastRunStatus']>;

// ─── Runs ─────────────────────────────────────────────────────

export type RunRecord = InferSelectModel<typeof runs>;
export type CreateRunInput = Omit<InferInsertModel<typeof runs>, 'id'> & { id?: string };
export type UpdateRunInput = Partial<Omit<CreateRunInput, 'createdAt' | 'queuedAt'>>;
export type RunStatus = RunRecord['status'];
export type RunTrigger = RunRecord['triggerKind'];

/** Trigger + its most recent run state, joined for the triggers list view. */
export type TriggerWithLastRun = TriggerRecord & {
  lastRun: RunRecord | null;
};

// ─── Filters (query params) ──────────────────────────────────

export interface AreaFilter {
  status?: AreaStatus | 'all';
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  areaId?: string | null;
  workspaceId?: string | null;
  parentId?: string | null;
  energy?: Energy;
  q?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
}

export interface NoteFilter {
  areaId?: string | null;
  workspaceId?: string | null;
  taskId?: string | null;
  status?: NoteStatus;
  /** When true, restrict to notes whose title starts with "Decision: " — the
   *  agent-written-decisions convention. See docs/async-agents-v1.md §4.5. */
  decisionsOnly?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: string;
}

export interface StreamFilter {
  status?: StreamStatus;
  limit?: number;
  offset?: number;
}

// ─── Notifications (docs/connectors-email-and-notifier-spec.md §2) ──

export type NotificationChannelRecord = InferSelectModel<typeof notificationChannels>;
export type CreateNotificationChannelInput = Omit<InferInsertModel<typeof notificationChannels>, 'id'> & { id?: string };
export type UpdateNotificationChannelInput = Partial<Omit<CreateNotificationChannelInput, 'createdAt'>>;
export type NotificationChannelKind = NotificationChannelRecord['kind'];

export type WebPushSubscriptionRecord = InferSelectModel<typeof webPushSubscriptions>;
export type CreateWebPushSubscriptionInput = Omit<InferInsertModel<typeof webPushSubscriptions>, 'id'> & { id?: string };

export type NotificationDeliveryRecord = InferSelectModel<typeof notificationDeliveries>;
export type CreateNotificationDeliveryInput = Omit<InferInsertModel<typeof notificationDeliveries>, 'id'> & { id?: string };
export type NotificationDeliveryStatus = NotificationDeliveryRecord['status'];
