// Shared types derived from Drizzle schema — imported by both client and server.
// Source of truth: src/lib/db/schema.ts

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import type { HarnessId } from '@/lib/agents/registry';
import type {
  userState, agentHarnessSettings, agentHarnessOperations, areas, stream, tasks, taskCompletions, taskStatusChanges, notes, decks, apiKeys,
  workspaces, referenceFolders, executions, executionTasks, executionReviews, chatSessions, externalSessionImports, chatEvents, chatRefs,
  triggers, runs, previewTargets, entityVersions,
  notificationChannels, webPushSubscriptions, notificationDeliveries,
  triagePasses, triageDecisions, streamLinks, skillUsage,
  Attachment,
} from '@/lib/db/schema';
export type { DeckItem, DeckAlternative, DeckChange, DeckOrigin, CalendarBlock, Attachment, StoredAttachment, RunArtifactRef, PreviewUrl, EntityVersionSnapshot, StoredNotificationEvent, StoredRenderedNotification, TriageDraft, StreamAutonomyConfig, StreamAutonomyLevel, TriageDisposition, LifecycleCommandResult } from '@/lib/db/schema';

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

// The schema carries no policy defaults (initial status, modes, routing
// policy), so InferInsertModel marks those columns required. The query-layer
// creators own the values (`input.x ?? POLICY`), so the Create inputs make
// them optional again. Authorship columns (actorSource/source/createdBy) are
// deliberately NOT here: callers must always say who acted.
type PolicyOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// ─── User State ────────────────────────────────────────────────

export type UserStateRecord = InferSelectModel<typeof userState>;
export type UpdateUserStateInput = Partial<Omit<InferInsertModel<typeof userState>, 'id'>>;

export type AgentHarnessSettingsRecord = InferSelectModel<typeof agentHarnessSettings>;
export type UpsertAgentHarnessSettingsInput = Omit<InferInsertModel<typeof agentHarnessSettings>, 'id'> & { id?: string };
export type AgentHarnessOperationRecord = InferSelectModel<typeof agentHarnessOperations>;

// ─── Areas ────────────────────────────────────────────────────

export type AreaRecord = WithCamelAttachments<InferSelectModel<typeof areas>>;
export type CreateAreaInput = WithCamelAttachments<PolicyOptional<Omit<InferInsertModel<typeof areas>, 'id'>, 'status'>>;
export type UpdateAreaInput = Partial<CreateAreaInput>;
export type AreaStatus = AreaRecord['status'];

// ─── Stream ───────────────────────────────────────────────────

export type StreamRecord = WithCamelAttachments<InferSelectModel<typeof stream>>;
export type CreateStreamInput = WithCamelAttachments<PolicyOptional<Omit<InferInsertModel<typeof stream>, 'id'>, 'status' | 'source' | 'media' | 'origin'>>;
export type UpdateStreamInput = Partial<CreateStreamInput>;
export type StreamSource = StreamRecord['source'];
export type StreamStatus = StreamRecord['status'];

// ─── Stream Triage ────────────────────────────────────────────

export type TriagePassRecord = InferSelectModel<typeof triagePasses>;
export type CreateTriagePassInput = PolicyOptional<Omit<InferInsertModel<typeof triagePasses>, 'id'>, 'status'>;
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
export type CreateTaskInput = WithCamelAttachments<PolicyOptional<Omit<InferInsertModel<typeof tasks>, 'id'>, 'status'>>;
export type UpdateTaskInput = Partial<CreateTaskInput>;
export type TaskStatus = NonNullable<TaskRecord['status']>;
/**
 * Status accepted by read filters. Includes the legacy `active` alias, which
 * the query layer expands to the derived current union `todo | in_progress`
 * (and matches un-backfilled `active` bytes) during the compatibility window.
 */
export type TaskStatusFilter = TaskStatus | 'active';
export type Energy = NonNullable<TaskRecord['energy']>;
export type Effort = NonNullable<TaskRecord['effort']>;

/**
 * A live task carrying a REAL hard deadline in the attention window. Produced by
 * `getDeadlineTasks` — a deterministic status+deadline query with no model call,
 * so an overdue or imminent deadline stays findable even when Deck generation is
 * unavailable. `blocked`/`status` are carried so the deadline surface can show
 * lifecycle and blocked context honestly; a task with no `hardDeadline` never
 * becomes one of these (deadlines are never invented).
 */
export interface DeadlineTask {
  id: string;
  title: string;
  status: TaskStatus;
  areaId: string | null;
  parentId: string | null;
  /** Bare calendar date, `YYYY-MM-DD`. */
  hardDeadline: string;
  /** Whole calendar days from local today. Negative = overdue, 0 = due today. */
  daysUntil: number;
  overdue: boolean;
  dueToday: boolean;
  /** An unresolved blocker (a blocker that is not Done) sits on this task. */
  blocked: boolean;
  blockedOn: string | null;
}

// ─── Task Completions ─────────────────────────────────────────

export type TaskCompletionRecord = InferSelectModel<typeof taskCompletions>;
export type CreateTaskCompletionInput = Omit<InferInsertModel<typeof taskCompletions>, 'id'>;

// ─── Task Status Changes ──────────────────────────────────────

export type TaskStatusChangeRecord = InferSelectModel<typeof taskStatusChanges>;
export type CreateTaskStatusChangeInput = Omit<InferInsertModel<typeof taskStatusChanges>, 'id'>;

// ─── Notes ────────────────────────────────────────────────────

export type NoteRecord = WithCamelAttachments<InferSelectModel<typeof notes>>;
export type CreateNoteInput = WithCamelAttachments<PolicyOptional<Omit<InferInsertModel<typeof notes>, 'id'>, 'status'>>;
export type UpdateNoteInput = Partial<CreateNoteInput>;
export type NoteStatus = NonNullable<NoteRecord['status']>;

// ─── Entity Versions ──────────────────────────────────────────

export type EntityVersionRecord = InferSelectModel<typeof entityVersions>;
export type CreateEntityVersionInput = Omit<InferInsertModel<typeof entityVersions>, 'id' | 'createdAt'>;
export type EntityVersionSource = NonNullable<EntityVersionRecord['source']>;
export type EntityVersionEntityType = EntityVersionRecord['entityType'];

// ─── Decks ───────────────────────────────────────────────────

export type DeckRecord = InferSelectModel<typeof decks>;
export type CreateDeckInput = PolicyOptional<Omit<InferInsertModel<typeof decks>, 'id'>, 'origin'>;
export type UpdateDeckInput = Partial<Omit<CreateDeckInput, 'createdAt'>>;

// ─── API Keys ─────────────────────────────────────────────────

export type ApiKeyRecord = InferSelectModel<typeof apiKeys>;
export type CreateApiKeyInput = PolicyOptional<Omit<InferInsertModel<typeof apiKeys>, 'id' | 'prefix' | 'suffix' | 'hash'>, 'deviceType' | 'env'>;
// Only user-editable metadata is exposed — secret material and audit timestamps
// stay internal and cannot be mutated via the API.
export type UpdateApiKeyInput = Partial<Pick<CreateApiKeyInput, 'name' | 'description' | 'deviceType'>>;
export type DeviceType = NonNullable<ApiKeyRecord['deviceType']>;

// ─── Workspaces ───────────────────────────────────────────────

export type WorkspaceRecord = WithCamelAttachments<InferSelectModel<typeof workspaces>>;
export type CreateWorkspaceInput = WithCamelAttachments<PolicyOptional<Omit<InferInsertModel<typeof workspaces>, 'id'>, 'status' | 'filesToCopy' | 'collapsed' | 'skipLiveConfirm' | 'browserEnabled'>>;
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

// ─── Reference folders ────────────────────────────────────────

export type ReferenceFolderRecord = InferSelectModel<typeof referenceFolders>;
export type CreateReferenceFolderInput = PolicyOptional<Omit<InferInsertModel<typeof referenceFolders>, 'id'>, 'status'> & {
  id?: string;
};
export type UpdateReferenceFolderInput = Partial<
  Omit<CreateReferenceFolderInput, 'id' | 'createdAt'>
>;
export type ReferenceFolderStatus = ReferenceFolderRecord['status'];

/** Git state of a reference folder, when it happens to be a repo. */
export interface ReferenceFolderGitState {
  branch: string | null;
  dirty: boolean;
  /** Commits ahead of the tracking branch. Null when there is no upstream. */
  ahead: number | null;
  behind: number | null;
}

/**
 * A reference folder with its target resolved to a real path, plus whatever
 * the filesystem says about it right now. `exists: false` rows still render in
 * settings (so the user can fix or remove them) but are kept out of the
 * agent's prompt, since a path that isn't there is worse than silence.
 */
export interface ResolvedReferenceFolder extends ReferenceFolderRecord {
  absolutePath: string;
  exists: boolean;
  git: ReferenceFolderGitState | null;
  /** True when this row is global (`workspaceId === null`). */
  global: boolean;
  /** Set when the resolved path sits inside the consuming workspace's cwd. */
  redundantWithCwd?: boolean;
}

// ─── Executions ───────────────────────────────────────────────

export type ExecutionRecord = InferSelectModel<typeof executions>;
export type CreateExecutionInput = PolicyOptional<Omit<InferInsertModel<typeof executions>, 'id'>, 'status'> & { id?: string };
export type UpdateExecutionInput = Partial<Omit<CreateExecutionInput, 'createdAt'>>;
export type ExecutionStatus = ExecutionRecord['status'];

export type ExecutionReviewRecord = InferSelectModel<typeof executionReviews>;
export type CreateExecutionReviewInput = Omit<InferInsertModel<typeof executionReviews>, 'id' | 'createdAt' | 'updatedAt'>;
export type ReviewDisposition = ExecutionReviewRecord['disposition'];

/** What the review affordance needs to render: the exact output to disposition,
 * the sole associated task (for Accept-and-complete), and the current state. */
export interface ExecutionReviewContext {
  latestOutputEventId: string | null;
  /** The sole associated task, or null when zero or many tasks are associated
   * (Accept-and-complete is only unambiguous for exactly one). */
  soleTaskId: string | null;
  soleTaskTitle: string | null;
  /** How many tasks this workstream is associated with. The review bar shows
   * whenever this is >= 1 (a shared workstream still needs review); only
   * Accept-and-complete is gated on soleTaskId being a single task. */
  associatedTaskCount: number;
  latestDisposition: ReviewDisposition | null;
  hasUnreviewedOutput: boolean;
}

export type ExecutionTaskRecord = InferSelectModel<typeof executionTasks>;

/** Derived attention badges for a task (from its associated workstreams + blocker).
 * See getTaskAttentionSignals. */
export interface TaskAttentionSignals {
  blocked: boolean;
  stalled: boolean;
  review: boolean;
  working: boolean;
  hasLiveExecution: boolean;
  executionCount: number;
}

// ─── Preview Targets ──────────────────────────────────────────

export type PreviewTargetRecord = InferSelectModel<typeof previewTargets>;
export type CreatePreviewTargetInput = PolicyOptional<Omit<InferInsertModel<typeof previewTargets>, 'id'>, 'pinned'> & { id?: string };
export type UpdatePreviewTargetInput = Partial<Omit<CreatePreviewTargetInput, 'createdAt' | 'executionId'>>;

// ─── Chat Sessions ────────────────────────────────────────────

export type ChatSessionRecord = InferSelectModel<typeof chatSessions>;
export type CreateChatSessionInput = PolicyOptional<Omit<InferInsertModel<typeof chatSessions>, 'id'>, 'status' | 'permissionMode'>;
export type UpdateChatSessionInput = Partial<Omit<CreateChatSessionInput, 'startedAt'>>;
export type ChatSessionType = ChatSessionRecord['type'];
export type ChatSessionStatus = ChatSessionRecord['status'];

export type ExternalSessionImportRecord = InferSelectModel<typeof externalSessionImports>;
export type CreateExternalSessionImportInput = PolicyOptional<Omit<InferInsertModel<typeof externalSessionImports>, 'id'>, 'status'>;
export type UpdateExternalSessionImportInput = Partial<Omit<CreateExternalSessionImportInput, 'createdAt'>>;

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
  setupWarning: string | null;
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
export type CreateChatRefInput = PolicyOptional<Omit<InferInsertModel<typeof chatRefs>, 'id'>, 'hydrate'> & { id?: string };
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
  | 'background_task'
  | 'permission_request' | 'permission_response'
  | 'question_request' | 'question_response'
  | 'auth_required'
  | 'cron' | 'unknown';

/** Outcome events bump `chat_sessions.last_outcome_event_at`. */
export const OUTCOME_SOURCES: ReadonlySet<ChatEventSource> = new Set([
  'agent',
  'result',
  'background_task',
]);

/**
 * Permission modes for execution sessions. App-native vocabulary, decoupled
 * from any single harness. Each adapter translates a mode into native flags in
 * `src/lib/executor/permission-map.ts`.
 *
 * - `auto_all`   — auto-allow every tool, no prompts. Default for new sessions.
 * - `auto_edits` — auto-allow workspace edits; prompt for shell/network/other.
 * - `ask`        — prompt before every mutating tool. Reads run free.
 * - `plan`       — read-only: propose a plan, make no changes.
 *
 * AskUserQuestion always surfaces to the user regardless of mode.
 *
 * The values live in `src/lib/permissions/modes.ts` (a leaf module the schema
 * imports); `PermissionMode` stays derived from the schema column per the
 * types-from-schema rule, and `PERMISSION_MODES` is re-exported here so callers
 * keep importing both from `@/db/types`.
 */
export type PermissionMode = NonNullable<ChatSessionRecord['permissionMode']>;

export { PERMISSION_MODES } from '@/lib/permissions/modes';

export type EffortLevel = NonNullable<ChatSessionRecord['effort']>;

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const satisfies readonly EffortLevel[];

// ─── Triggers ─────────────────────────────────────────────────

export type TriggerRecord = InferSelectModel<typeof triggers>;
export type CreateTriggerInput = PolicyOptional<Omit<InferInsertModel<typeof triggers>, 'id'>, 'concurrencyPolicy' | 'catchUpPolicy' | 'maxCatchUpRuns' | 'enabled'> & { id?: string };
export type UpdateTriggerInput = Partial<Omit<CreateTriggerInput, 'createdAt'>>;
export type TriggerKind = TriggerRecord['kind'];
export type TriggerTargetKind = TriggerRecord['targetKind'];
export type TriggerConcurrencyPolicy = TriggerRecord['concurrencyPolicy'];
export type TriggerCatchUpPolicy = TriggerRecord['catchUpPolicy'];
export type TriggerLastRunStatus = NonNullable<TriggerRecord['lastRunStatus']>;

// ─── Runs ─────────────────────────────────────────────────────

export type RunRecord = InferSelectModel<typeof runs>;
export type CreateRunInput = PolicyOptional<Omit<InferInsertModel<typeof runs>, 'id'>, 'status'> & { id?: string };
export type UpdateRunInput = Partial<Omit<CreateRunInput, 'createdAt' | 'queuedAt'>>;
export type RunStatus = RunRecord['status'];
export type RunTrigger = RunRecord['triggerKind'];

/** Trigger + its most recent run state, joined for the triggers list view. */
/**
 * A trigger as the action layer returns it: the row plus `provider`, its
 * `harness` under the name the create/update actions take it by.
 */
export type TriggerView = TriggerRecord & {
  provider: HarnessId;
};

// The schema's harness columns and `HarnessId` must name the same engines.
// Adding one without the other fails typecheck here instead of at a runtime
// boundary.
type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;
export type HarnessColumnMatchesHarnessId = Expect<SameMembers<ChatSessionRecord['harness'], HarnessId>>;

export type TriggerWithLastRun = TriggerView & {
  lastRun: RunRecord | null;
};

// ─── Filters (query params) ──────────────────────────────────

export interface AreaFilter {
  status?: AreaStatus | 'all';
}

export interface TaskFilter {
  status?: TaskStatusFilter | TaskStatusFilter[];
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
export type CreateNotificationChannelInput = PolicyOptional<Omit<InferInsertModel<typeof notificationChannels>, 'id'>, 'enabled'> & { id?: string };
export type UpdateNotificationChannelInput = Partial<Omit<CreateNotificationChannelInput, 'createdAt'>>;
export type NotificationChannelKind = NotificationChannelRecord['kind'];

export type WebPushSubscriptionRecord = InferSelectModel<typeof webPushSubscriptions>;
export type CreateWebPushSubscriptionInput = Omit<InferInsertModel<typeof webPushSubscriptions>, 'id'> & { id?: string };

export type NotificationDeliveryRecord = InferSelectModel<typeof notificationDeliveries>;
export type CreateNotificationDeliveryInput = PolicyOptional<Omit<InferInsertModel<typeof notificationDeliveries>, 'id'>, 'status'> & { id?: string };
export type NotificationDeliveryStatus = NotificationDeliveryRecord['status'];

// ─── Skill Usage ──────────────────────────────────────────────

export type SkillUsageRecord = InferSelectModel<typeof skillUsage>;
