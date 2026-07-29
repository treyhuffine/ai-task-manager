import { api } from './client';
import { fetchDiffStatsBatched } from './diff-stats-batch';
import type {
  ChatSessionRecord, ChatSessionWithExecution, ChatEventRecord,
  PermissionMode, EffortLevel, Attachment,
} from '@/db/types';
import type { PrChecks, PrReviewDecision } from '@/lib/github/pr-status-types';
import type { HarnessId } from '@/lib/agents/registry';
import type { SessionRuntimeStatus } from '@/lib/executor/runtime-status';

// ─── Pending-input wire types ─────────────────────────────────
//
// Mirrored manually from `src/lib/executor/pending-input.ts` (server-only
// module — pulls in @agentex/agent). Re-exporting from there would drag
// node-only deps into the client bundle.

export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface PendingPermission {
  kind: 'permission';
  requestId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  title: string | null;
  description: string | null;
  createdAt: string;
}

export interface PendingQuestion {
  kind: 'question';
  requestId: string;
  sessionId: string;
  toolUseId: string;
  questions: AskUserQuestionItem[];
  originalInput: Record<string, unknown>;
  createdAt: string;
}

export type PendingInput = PendingPermission | PendingQuestion;

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

/** Mirrors `WorkspaceStatus` from `@agentex/workspace`. */
export interface WorktreeStatus {
  dirty: boolean;
  untracked: string[];
  modified: string[];
  staged: string[];
  ahead: number;
  behind: number;
}

export interface StructuredDiffLine { kind: 'add' | 'del' | 'ctx'; text: string }
export interface StructuredDiffHunk {
  oldStart: number; oldLines: number;
  newStart: number; newLines: number;
  lines: StructuredDiffLine[];
}
export interface StructuredDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
  hunks: StructuredDiffHunk[];
}
export interface StructuredDiff { files: StructuredDiffFile[] }

// ─── File tree wire types ─────────────────────────────────
//
// Mirrored from `src/lib/workspaces/list-tree.ts` — that module imports
// `node:fs` and `@agentex/workspace`, so we keep the wire shape local
// to the client API barrel instead of re-exporting.

export type TreeEntryStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'staged'
  | 'untracked'
  /** Unmerged: the working-tree file carries git conflict markers
   *  (mid-merge/rebase/pull, or from a `git ls-files -u` unmerged index
   *  entry). Renders in the tree's "Conflicts" section and opens the
   *  conflict resolver instead of the plain diff. */
  | 'conflict';

export interface TreeEntry {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size?: number;
  status?: TreeEntryStatus;
  mtime?: string;
  /** A `dir` shown but not expandable — its contents are intentionally not
   *  listed (e.g. `node_modules`: present, but too big to browse here). */
  collapsed?: boolean;
}

export interface TreeResponse {
  entries: TreeEntry[];
}

// ─── File read wire types ─────────────────────────────────
//
// Mirrored from `src/lib/workspaces/read-file.ts`. Server-only module —
// imports `node:fs` and `@agentex/workspace`. The client never sees
// `FileReadError` directly; the route maps it to HTTP status.

export interface FileResponse {
  path: string;
  /** Null when binary or oversize. */
  content: string | null;
  encoding: 'utf8' | 'base64';
  mime: string;
  size: number;
  isBinary: boolean;
  /** Set when the file exceeds the server's preview cap (1 MiB). */
  tooLarge?: boolean;
}

// ─── PR wire types ─────────────────────────────────
//
// Mirrored from `@agentex/github`'s PRSummary. We map the library's
// shape into a flatter wire type so the route stays the source of
// truth for "what the action bar sees about a PR."

export type PrState = 'OPEN' | 'CLOSED' | 'MERGED';

/** GitHub-reported mergeability for an open PR. */
export type PrMergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export interface PrInfo {
  number: number;
  url: string;
  state: PrState;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  title: string;
  updatedAt: string;
  /** Populated only for OPEN PRs; closed/merged carry `null`. */
  mergeable: PrMergeable | null;
  /** Rolled-up CI check state for an OPEN PR; `null` when none / closed / merged. */
  checks: PrChecks | null;
  /** GitHub review decision for an OPEN PR; `null` when none / closed / merged. */
  reviewDecision: PrReviewDecision | null;
  /** Whether auto-merge ("merge when ready") is enabled on the PR. */
  autoMergeEnabled: boolean;
}

export interface PrResponse {
  pr: PrInfo | null;
  /** Set when `gh` is missing or unauthenticated. */
  ghStatus?: 'not_installed' | 'not_authenticated';
}

export interface MergeRequestBody {
  method?: 'merge' | 'squash' | 'rebase';
  deleteBranch?: boolean;
}

export interface MergeResponse {
  ok: true;
  prNumber: number;
  url: string;
}

export interface AutoMergeRequestBody {
  /** `true` enables "merge when ready"; `false` disables it. */
  enable: boolean;
  method?: 'merge' | 'squash' | 'rebase';
}

export interface AutoMergeResponse {
  ok: true;
  enabled: boolean;
  prNumber: number;
  url: string;
}

export interface ResolvePendingBody {
  allow: boolean;
  message?: string;
  answers?: Record<string, string>;
}

export interface ReconcileResult {
  drift: boolean;
  replayed: number;
  skipped?: 'no_transcript' | 'unsupported_provider' | 'no_cwd' | 'no_external_session';
}

export interface ResyncResult {
  ok: true;
  classification: 'healthy' | 'dead' | 'ambiguous';
  replayed: number;
  redispatched: boolean;
  fixes: string[];
}

export interface RestartResult {
  ok: true;
}

export interface WipDetection {
  modified: string[];
  untracked: string[];
}

export interface WipCopyResult {
  action: 'copy';
  empty?: true;
  copied?: string[];
  skipped?: { path: string; reason: string }[];
}

export interface WipMoveResult {
  action: 'move';
  empty?: true;
  moved?: boolean;
  conflict?: boolean;
  stashMessage?: string | null;
}

export type WipApplyResult = WipCopyResult | WipMoveResult;

// ─── Takeover wire types ─────────────────────────────────
//
// Mirrors the route response shapes. Server source of truth:
// `src/app/api/sessions/[id]/takeover/route.ts` and
// `src/app/api/takeover/[token]/resume/route.ts`.

export interface TakeoverResponse {
  token: string;
  expiresAt: string;
  cliCommand: string;
  fallbackCommand: string;
  branch: string;
  baseSha: string;
  remoteUrl: string;
  workspaceId: string;
  startedAt: string;
}

export interface ResumeFromTakeoverResponse {
  ok: true;
  filesChanged: number;
  shortstat: string;
  sessionId: string;
}

/**
 * `chat_sessions` row plus a sidecar `agentHarness` field that the GET
 * endpoint joins in. Used by the composer to pick the right model
 * catalog without a second fetch.
 *
 * Extends `ChatSessionWithExecution` (not the bare row) because the GET
 * endpoint flattens the execution's worktree/branch/PR/setup/takeover
 * state onto the response. Reads of `worktreePath` etc. on this type are
 * execution-sourced.
 */
export interface ChatSessionWithAgent extends ChatSessionWithExecution {
  agentHarness: string | null;
}

/**
 * Wire shape of a rail session row — flattened chat_session + execution
 * state plus the workspace columns the row needs (name, emoji, cover
 * image, area link). `attachments` carries through unchanged so the
 * renderer can resolve cover images via the existing `coverAttachmentUrl`
 * helper.
 */
export interface RailSession extends ChatSessionWithExecution {
  workspaceName: string | null;
  workspaceEmoji: string | null;
  workspaceAttachments: Attachment[] | null;
  workspaceAreaId: string | null;
  workspaceIsGit: boolean | null;
}

export interface RailResponse {
  sessions: RailSession[];
  pendingSessionIds: string[];
  runningSessionIds: string[];
  backgroundSessionIds: string[];
}

export interface HistoryResponse {
  sessions: RailSession[];
}

// ─── Chat / session search ────────────────────────────────────

/** Native vs. imported (and which importer) filter for chat search. */
export type ChatSearchSource = 'native' | 'imported' | 'claude' | 'codex' | 'opencode';

/**
 * One chat-search hit: a rail session row plus the matched snippet + score.
 * Wire mirror of the server's `ChatSearchResult` (src/lib/db/queries.ts). The
 * snippet's matched terms are wrapped in the sentinels from
 * `@/lib/search/highlight` — render with `splitHighlight`.
 */
export interface ChatSearchResult extends RailSession {
  snippet: string;
  matchedEventId: string;
  score: number;
}

export interface SessionSearchFilters {
  status?: 'active' | 'archived';
  workspaceId?: string;
  source?: ChatSearchSource;
  limit?: number;
}

// ─── Picker / References / Scratchpad wire types ─────────────

export interface PickerTaskItem {
  id: string;
  title: string;
  status: 'active' | 'done' | 'archived';
  areaId: string | null;
  workspaceId: string | null;
  updatedAt: string;
}

export interface PickerNoteItem {
  id: string;
  title: string | null;
  areaId: string | null;
  workspaceId: string | null;
  updatedAt: string;
}

export interface PickerResponse {
  tasks: PickerTaskItem[];
  notes: PickerNoteItem[];
}

/**
 * Lookup payload for the transcript's chip rendering — every task/note
 * the session's chat_refs point at, indexed by id. One fetch per
 * session beats per-chip lookups.
 */
export interface EntitiesResponse {
  tasks: Array<{ id: string; title: string; status: string }>;
  notes: Array<{ id: string; title: string | null }>;
}

/**
 * Wire shape for the references slide-over. `inChat` is the
 * `[[task|note|scratchpad]]`-mentioned set for this session; `workspace`
 * is everything with `workspaceId === current` not already in chat;
 * `all` is everything else when the scope filter widens.
 */
export interface ReferenceRow {
  kind: 'task' | 'note';
  id: string;
  title: string;
  status?: string;
  areaId: string | null;
  workspaceId: string | null;
  updatedAt: string;
  /** Truthy when this row appears in chat_refs for the session. */
  referencedAt?: string | null;
  /** Number of child tasks. Tasks only — undefined for notes or when not computed. */
  subtaskCount?: number;
}

export interface ReferencesResponse {
  inChat: ReferenceRow[];
  workspace: ReferenceRow[];
  all: ReferenceRow[];
  scope: 'session' | 'workspace' | 'all';
}

export interface ExecutionChatHistoryEntry {
  id: string;
  label: string | null;
  status: 'active' | 'archived';
  startedAt: string;
  lastOutcomeEventAt: string | null;
  unreadMarkerAt: string | null;
  lastViewedAt: string | null;
  /** The chat currently being viewed. */
  isCurrent: boolean;
  /** Executor in-memory turn state — an agent is actively working this chat. */
  running: boolean;
  /** Manual chat-tab order (fractional index); null = fall back to creation order. */
  tabSortKey: string | null;
}

export const sessionsApi = {
  get(id: string): Promise<ChatSessionWithAgent> {
    return api.get<ChatSessionWithAgent>(`/sessions/${id}`);
  },

  update(
    id: string,
    input: {
      label?: string | null;
      /** The execution's stable header title (lives on the execution, not the chat). */
      executionLabel?: string | null;
      permissionMode?: PermissionMode;
      model?: string;
      modelVariant?: string | null;
      effort?: EffortLevel | null;
      prNumber?: number | null;
      /** Manual chat-tab order (fractional index). `null` resets to creation order. */
      tabSortKey?: string | null;
    },
  ): Promise<ChatSessionWithExecution> {
    return api.patch<ChatSessionWithExecution>(`/sessions/${id}`, input);
  },

  pendingInput(id: string): Promise<PendingInput[]> {
    return api.get<PendingInput[]>(`/sessions/${id}/pending-input`);
  },

  resolvePendingInput(
    id: string,
    requestId: string,
    body: ResolvePendingBody,
  ): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/pending-input/${requestId}`, body);
  },

  events(
    id: string,
    opts?: { limit?: number; before?: string },
  ): Promise<ChatEventRecord[]> {
    // `before` (an event id) requests the page of events strictly older
    // than that anchor — the transcript's scroll-up pager. Omitting it
    // returns the most-recent `limit` events.
    return api.get<ChatEventRecord[]>(`/sessions/${id}/events`, {
      query: { limit: opts?.limit, before: opts?.before },
    });
  },

  status(id: string): Promise<WorktreeStatus | null> {
    return api.get<WorktreeStatus | null>(`/sessions/${id}/status`);
  },

  diff(id: string, file?: string): Promise<StructuredDiff | null> {
    return api.get<StructuredDiff | null>(
      `/sessions/${id}/diff`,
      { query: file ? { file } : undefined },
    );
  },

  tree(id: string): Promise<TreeResponse> {
    return api.get<TreeResponse>(`/sessions/${id}/tree`);
  },

  picker(id: string, opts?: { all?: boolean }): Promise<PickerResponse> {
    return api.get<PickerResponse>(
      `/sessions/${id}/picker`,
      { query: opts?.all ? { all: '1' } : undefined },
    );
  },

  entities(id: string): Promise<EntitiesResponse> {
    return api.get<EntitiesResponse>(`/sessions/${id}/entities`);
  },

  references(id: string, opts?: { scope?: 'session' | 'workspace' | 'all' }): Promise<ReferencesResponse> {
    return api.get<ReferencesResponse>(
      `/sessions/${id}/references`,
      { query: opts?.scope ? { scope: opts.scope } : undefined },
    );
  },

  pinRef(id: string, body: { entityType: 'task' | 'note' | 'area'; entityId: string }): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/references`, body);
  },

  unpinRef(id: string, body: { entityType: 'task' | 'note' | 'area'; entityId: string }): Promise<{ ok: true }> {
    return api.delete<{ ok: true }>(`/sessions/${id}/references`, {
      query: { entityType: body.entityType, entityId: body.entityId },
    });
  },

  scratchpad(id: string): Promise<{ scratchPad: string | null }> {
    return api.get<{ scratchPad: string | null }>(`/sessions/${id}/scratchpad`);
  },

  setScratchpad(id: string, scratchPad: string | null): Promise<{ scratchPad: string | null }> {
    return api.put<{ scratchPad: string | null }>(`/sessions/${id}/scratchpad`, { scratchPad });
  },

  file(id: string, path: string, opts?: { base?: boolean }): Promise<FileResponse> {
    return api.get<FileResponse>(
      `/sessions/${id}/file`,
      { query: opts?.base ? { path, base: '1' } : { path } },
    );
  },

  writeFile(id: string, path: string, content: string): Promise<{ ok: true; path: string; size: number }> {
    return api.put<{ ok: true; path: string; size: number }>(
      `/sessions/${id}/file`,
      { content },
      { query: { path } },
    );
  },

  /** Write conflict-resolved content AND stage it (`git add`) so git
   *  records the merge conflict as resolved. `content` must have no
   *  remaining conflict markers. */
  resolveFileConflict(
    id: string,
    path: string,
    content: string,
  ): Promise<{ ok: true; path: string; size: number }> {
    return api.post<{ ok: true; path: string; size: number }>(
      `/sessions/${id}/file/resolve-conflict`,
      { path, content },
    );
  },

  deleteFile(id: string, path: string): Promise<{ ok: true; path: string; kind: 'file' | 'dir' }> {
    return api.delete<{ ok: true; path: string; kind: 'file' | 'dir' }>(
      `/sessions/${id}/file`,
      { query: { path } },
    );
  },

  createFile(id: string, path: string): Promise<{ ok: true; path: string }> {
    return api.post<{ ok: true; path: string }>(
      `/sessions/${id}/file/create`,
      { path },
    );
  },

  renamePath(
    id: string,
    from: string,
    to: string,
  ): Promise<{ ok: true; from: string; to: string; kind: 'file' | 'dir' }> {
    return api.post<{ ok: true; from: string; to: string; kind: 'file' | 'dir' }>(
      `/sessions/${id}/file/rename`,
      { from, to },
    );
  },

  createDir(id: string, path: string): Promise<{ ok: true; path: string }> {
    return api.post<{ ok: true; path: string }>(`/sessions/${id}/dir`, { path });
  },

  deleteDir(id: string, path: string): Promise<{ ok: true; path: string; kind: 'file' | 'dir' }> {
    return api.delete<{ ok: true; path: string; kind: 'file' | 'dir' }>(
      `/sessions/${id}/dir`,
      { query: { path } },
    );
  },

  pr(id: string): Promise<PrResponse> {
    return api.get<PrResponse>(`/sessions/${id}/pr`);
  },

  openPr(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/pr`);
  },

  mergePr(id: string, body?: MergeRequestBody): Promise<MergeResponse> {
    return api.post<MergeResponse>(`/sessions/${id}/merge`, body ?? {});
  },

  setAutoMerge(id: string, body: AutoMergeRequestBody): Promise<AutoMergeResponse> {
    return api.post<AutoMergeResponse>(`/sessions/${id}/auto-merge`, body);
  },

  needsReview(): Promise<ChatSessionWithExecution[]> {
    return api.get<ChatSessionWithExecution[]>('/sessions/needs-review');
  },

  /**
   * @deprecated use markRead — `view` is the legacy endpoint, kept so
   *   older callers compile until they migrate.
   */
  markViewed(id: string): Promise<ChatSessionRecord> {
    return api.post<ChatSessionRecord>(`/sessions/${id}/view`);
  },

  markRead(id: string): Promise<ChatSessionRecord> {
    return api.post<ChatSessionRecord>(`/sessions/${id}/read`);
  },

  markUnread(id: string): Promise<ChatSessionRecord> {
    return api.post<ChatSessionRecord>(`/sessions/${id}/unread`);
  },

  rail(): Promise<RailResponse> {
    return api.get<RailResponse>('/sessions/rail');
  },

  history(): Promise<HistoryResponse> {
    return api.get<HistoryResponse>('/sessions/history');
  },

  /**
   * Full-text search across chat/execution transcripts. Ranked, one result
   * per session, with a highlighted snippet. Blank query returns [].
   */
  search(query: string, filters?: SessionSearchFilters): Promise<ChatSearchResult[]> {
    return api.get<ChatSearchResult[]>('/sessions/search', {
      query: {
        q: query,
        status: filters?.status,
        workspaceId: filters?.workspaceId,
        source: filters?.source,
        limit: filters?.limit,
      },
    });
  },

  pendingInputGlobal(): Promise<{ sessionIds: string[] }> {
    return api.get<{ sessionIds: string[] }>('/sessions/pending-input');
  },

  /**
   * Diff stats for one session. Coalesced with every other row's request in
   * the same tick into a single `POST /sessions/diff-stats` — the rail asks
   * per row, the network carries one call. See `diff-stats-batch.ts`.
   */
  diffStats(id: string): Promise<DiffStats | null> {
    return fetchDiffStatsBatched(id);
  },

  archive(id: string, opts?: { force?: boolean }): Promise<ChatSessionWithExecution> {
    return api.post<ChatSessionWithExecution>(`/sessions/${id}/archive`, { force: opts?.force ?? false });
  },

  /**
   * Start a fresh chat against the SAME execution (new conversation on the
   * existing worktree), optionally switching provider. The current chat
   * stays open — parallel chats are the normal mode. Returns the new chat
   * to navigate to.
   */
  newChat(
    id: string,
    opts?: { providerId?: HarnessId; model?: string; variant?: string; effort?: EffortLevel },
  ): Promise<{ session: ChatSessionWithAgent }> {
    return api.post<{ session: ChatSessionWithAgent }>(`/sessions/${id}/new-chat`, opts ?? {});
  },

  /** Past + current chats for this execution, newest first. */
  chatHistory(id: string): Promise<{ sessions: ExecutionChatHistoryEntry[] }> {
    return api.get<{ sessions: ExecutionChatHistoryEntry[] }>(`/sessions/${id}/history`);
  },

  /**
   * Close (archive) one chat of an execution without touching the
   * execution, its worktree, or sibling chats. Powers the X on the chat
   * tab strip. 409s when it's the execution's last open chat.
   */
  closeChat(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/close-chat`, {});
  },

  /**
   * Resume an archived execution AND re-provision its worktree off the
   * workspace base (or `baseBranch` if specified). Returns the row in its
   * setting-up state; the UI's existing setup spinner waits for the new
   * worktreePath to populate. Fired automatically by `ExecutionView` on
   * mount when the session is archived.
   */
  continueWork(
    id: string,
    opts?: { baseBranch?: string | null },
  ): Promise<ChatSessionWithExecution> {
    return api.post<ChatSessionWithExecution>(`/sessions/${id}/continue`, opts ?? {});
  },

  commit(id: string, opts?: { andPush?: boolean }): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/commit`, opts ?? {});
  },

  push(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/push`);
  },

  pullBase(id: string, strategy: 'merge' | 'rebase' = 'merge'): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/pull-base`, { strategy });
  },

  resolveConflicts(
    id: string,
    scenario: 'pr_vs_base' | 'local_vs_remote',
  ): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/resolve-conflicts`, { scenario });
  },

  helpWithError(
    id: string,
    input: {
      action: string;
      error: string;
      context?: ReadonlyArray<{ label: string; value: string }>;
    },
  ): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/help-with-error`, input);
  },

  retrySetup(id: string): Promise<ChatSessionWithExecution> {
    return api.post<ChatSessionWithExecution>(`/sessions/${id}/retry-setup`);
  },

  retrySetupScript(id: string): Promise<ChatSessionWithExecution> {
    return api.post<ChatSessionWithExecution>(`/sessions/${id}/retry-setup-script`);
  },

  sendMessage(
    id: string,
    content: string,
    opts?: { attachments?: Attachment[]; eventId?: string },
  ): Promise<ChatEventRecord> {
    return api.post<ChatEventRecord>(`/sessions/${id}/messages`, {
      content,
      attachments: opts?.attachments,
      id: opts?.eventId,
    });
  },

  runtimeStatus(id: string): Promise<SessionRuntimeStatus> {
    return api.get<SessionRuntimeStatus>(`/sessions/${id}/runtime-status`);
  },

  interrupt(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/interrupt`);
  },

  stopTask(id: string, taskId: string): Promise<{ stopped: boolean }> {
    return api.post<{ stopped: boolean }>(
      `/sessions/${id}/tasks/${encodeURIComponent(taskId)}/stop`,
    );
  },

  reconcile(id: string): Promise<ReconcileResult> {
    return api.post<ReconcileResult>(`/sessions/${id}/reconcile`);
  },

  resync(id: string): Promise<ResyncResult> {
    return api.post<ResyncResult>(`/sessions/${id}/resync`);
  },

  restart(id: string): Promise<RestartResult> {
    return api.post<RestartResult>(`/sessions/${id}/restart`);
  },

  wip(id: string): Promise<WipDetection | null> {
    return api.get<WipDetection | null>(`/sessions/${id}/wip`);
  },

  applyWip(id: string, action: 'copy' | 'move'): Promise<WipApplyResult> {
    return api.post<WipApplyResult>(`/sessions/${id}/wip`, { action });
  },

  takeover(id: string): Promise<TakeoverResponse> {
    return api.post<TakeoverResponse>(`/sessions/${id}/takeover`);
  },

  cancelTakeover(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/takeover-cancel`);
  },

  /**
   * Resume from a browser-initiated "Done — pull my changes" click.
   * The CLI calls the same endpoint (different transport, same token
   * in path), but goes through `/api/takeover/<token>/resume` to bypass
   * bearer-token middleware. The browser sends bearer auth as usual.
   */
  resumeFromTakeover(token: string): Promise<ResumeFromTakeoverResponse> {
    return api.post<ResumeFromTakeoverResponse>(`/takeover/${token}/resume`, undefined, {
      // The api client sets `baseUrl='/api'` so the URL becomes
      // `/api/takeover/<token>/resume`. No special-casing needed.
    });
  },
};
