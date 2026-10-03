import type {
	Attachment,
	EffortLevel,
	PermissionMode
} from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';
import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions, rpcQuery } from '@/lib/trpc/request-options';
import type { RouterInputs, RouterOutputs } from '@/lib/trpc/router';
import { fetchDiffStatsBatched } from './diff-stats-batch';
import { clientIsHost, type OpenTarget } from './fs';

/** A review checkout on the viewer's device (P4.1). */
export type ReviewState = RouterOutputs['sessions']['reviewGet'];

/** The home's own browser says so, as it does to open apps: the review is then on the home. */
function hostHeaders(): Record<string, string> | undefined {
  return clientIsHost() ? { 'x-ri-host': '1' } : undefined;
}

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

export type PendingPermission = Extract<RouterOutputs['sessions']['pendingInputGet'][number], { kind: 'permission' }>;

export type PendingQuestion = Extract<RouterOutputs['sessions']['pendingInputGet'][number], { kind: 'question' }>;

export type PendingInput = RouterOutputs['sessions']['pendingInputGet'][number];

export type DiffStats = NonNullable<RouterOutputs['sessions']['diffStatsGet']>;

/** Mirrors `WorkspaceStatus` from `@agentex/workspace`, plus `sync`. */
export type WorktreeStatus = RouterOutputs['sessions']['statusGet'];

export type StructuredDiffLine = NonNullable<RouterOutputs['sessions']['diffGet']>['files'][number]['hunks'][number]['lines'][number];
export type StructuredDiffHunk = NonNullable<RouterOutputs['sessions']['diffGet']>['files'][number]['hunks'][number];
export type StructuredDiffFile = NonNullable<RouterOutputs['sessions']['diffGet']>['files'][number];
export type StructuredDiff = NonNullable<RouterOutputs['sessions']['diffGet']>;

// ─── File tree wire types ─────────────────────────────────
//
// Mirrored from `src/lib/workspaces/list-tree.ts` — that module imports
// `node:fs` and `@agentex/workspace`, so we keep the wire shape local
// to the client API barrel instead of re-exporting.

export type TreeEntryStatus = NonNullable<RouterOutputs['sessions']['treeGet']['entries'][number]['status']>;

export type TreeEntry = RouterOutputs['sessions']['treeGet']['entries'][number];

export type TreeResponse = RouterOutputs['sessions']['treeGet'];

// ─── File read wire types ─────────────────────────────────
//
// Mirrored from `src/lib/workspaces/read-file.ts`. Server-only module —
// imports `node:fs` and `@agentex/workspace`. The client never sees
// `FileReadError` directly; the route maps it to HTTP status.

export type FileResponse = RouterOutputs['sessions']['fileGet'];

// ─── PR wire types ─────────────────────────────────
//
// Mirrored from `@agentex/github`'s PRSummary. We map the library's
// shape into a flatter wire type so the route stays the source of
// truth for "what the action bar sees about a PR."

export type PrState = NonNullable<RouterOutputs['sessions']['prGet']['pr']>['state'];

/** GitHub-reported mergeability for an open PR. */
export type PrMergeable = NonNullable<NonNullable<RouterOutputs['sessions']['prGet']['pr']>['mergeable']>;

export type PrInfo = NonNullable<RouterOutputs['sessions']['prGet']['pr']>;

export type PrResponse = RouterOutputs['sessions']['prGet'];

/** A linked PR's number and GitHub address, known without asking GitHub (`GET /sessions/:id/pr-link`). */
export type LinkedPr = NonNullable<RouterOutputs['sessions']['prLinkGet']['linked']>;

export type PrLinkResponse = RouterOutputs['sessions']['prLinkGet'];

export type MergeRequestBody = RouterInputs['sessions']['mergePost']['body'];

export type MergeResponse = RouterOutputs['sessions']['mergePost'];

export type AutoMergeRequestBody = RouterInputs['sessions']['autoMergePost']['body'];

export type AutoMergeResponse = RouterOutputs['sessions']['autoMergePost'];

export interface ResolvePendingBody {
  allow: boolean;
  message?: string;
  answers?: Record<string, string>;
}

export type ReconcileResult = RouterOutputs['sessions']['reconcilePost'];

export type ResyncResult = RouterOutputs['sessions']['resyncPost'];

export type RestartResult = RouterOutputs['sessions']['restartPost'];

export type TakeOverImportResult = RouterOutputs['sessions']['takeOverImportPost'];

export type WipDetection = NonNullable<RouterOutputs['sessions']['wipGet']>;

export type WipCopyResult = Extract<RouterOutputs['sessions']['wipPost'], { action: 'copy' }>;

export type WipMoveResult = Extract<RouterOutputs['sessions']['wipPost'], { action: 'move' }>;

export type WipApplyResult = RouterOutputs['sessions']['wipPost'];


/**
 * Wire shape of a rail session row — flattened chat_session + execution
 * state plus the workspace columns the row needs (name, emoji, cover
 * image, area link). `attachments` carries through unchanged so the
 * renderer can resolve cover images via the existing `coverAttachmentUrl`
 * helper.
 */
export type RailSession = RouterOutputs['sessions']['railGet']['sessions'][number];
export type RailResponse = RouterOutputs['sessions']['railGet'];

/** An agent's main chat on the rail, with what it's waiting on when it's blocked on you. */
export type RailMainChat = RouterOutputs['sessions']['railGet']['mainChats'][number];

export type HistoryResponse = RouterOutputs['sessions']['historyList'];

// ─── Chat / session search ────────────────────────────────────

/** Native vs. imported (and which importer) filter for chat search. */
export type ChatSearchSource = 'native' | 'imported' | 'claude' | 'codex' | 'opencode';

/**
 * One chat-search hit: a rail session row plus the matched snippet + score.
 * Wire mirror of the server's `ChatSearchResult` (src/lib/db/queries.ts). The
 * snippet's matched terms are wrapped in the sentinels from
 * `@/lib/search/highlight` — render with `splitHighlight`.
 */
export type ChatSearchResult = RouterOutputs['sessions']['searchGet'][number];

export interface SessionSearchFilters {
  status?: 'active' | 'archived';
  workspaceId?: string;
  source?: ChatSearchSource;
  limit?: number;
}

// ─── Picker / References / Scratchpad wire types ─────────────

export type PickerTaskItem = RouterOutputs['sessions']['pickerGet']['tasks'][number];

export type PickerNoteItem = RouterOutputs['sessions']['pickerGet']['notes'][number];

export type PickerResponse = RouterOutputs['sessions']['pickerGet'];

/**
 * Lookup payload for the transcript's chip rendering — every task/note
 * the session's chat_refs point at, indexed by id. One fetch per
 * session beats per-chip lookups.
 */
export type EntitiesResponse = RouterOutputs['sessions']['entitiesGet'];

/**
 * Wire shape for the references slide-over. `inChat` is the
 * `[[task|note|scratchpad]]`-mentioned set for this session; `workspace`
 * is everything with `workspaceId === current` not already in chat;
 * `all` is everything else when the scope filter widens.
 */
export type ReferenceRow = RouterOutputs['sessions']['referencesGet']['inChat'][number];

export type ReferencesResponse = RouterOutputs['sessions']['referencesGet'];

export type ExecutionChatHistoryEntry = RouterOutputs['sessions']['historyGet']['sessions'][number];

export const sessionsApi = {
  get(id: string, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.sessions.get.query({params: {id: id}}, rpcOptions({ signal: opts.signal }));
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
  ) {
    return trpcClient.sessions.update.mutate({params: {id: id}, body: input});
  },

  pendingInput(id: string) {
    return trpcClient.sessions.pendingInputGet.query({params: {id: id}});
  },

  resolvePendingInput(
    id: string,
    requestId: string,
    body: ResolvePendingBody,
  ) {
    return trpcClient.sessions.pendingInputRequestIdPost.mutate({params: {id: id, requestId: requestId}, body: body});
  },

  events(
    id: string,
    opts?: { limit?: number; before?: string },
  ) {
    // `before` (an event id) requests the page of events strictly older
    // than that anchor — the transcript's scroll-up pager. Omitting it
    // returns the most-recent `limit` events.
    return trpcClient.sessions.eventsGet.query({params: {id: id}, query: rpcQuery({ limit: opts?.limit, before: opts?.before })});
  },

  /**
   * The events behind specific background tasks (lifecycle, launching call,
   * output), for tasks that started before the loaded transcript page.
   */
  backgroundTaskEvents(id: string, taskIds: readonly string[]) {
    return trpcClient.sessions.backgroundTasksGet.query({params: {id: id}, query: rpcQuery({ ids: taskIds.join(',') })});
  },

  status(id: string) {
    return trpcClient.sessions.statusGet.query({params: {id: id}});
  },

  diff(id: string, file?: string) {
    return trpcClient.sessions.diffGet.query({params: {id: id}, query: rpcQuery(file ? { file } : undefined)});
  },

  tree(id: string) {
    return trpcClient.sessions.treeGet.query({params: {id: id}});
  },

  picker(id: string, opts?: { all?: boolean }) {
    return trpcClient.sessions.pickerGet.query({params: {id: id}, query: rpcQuery(opts?.all ? { all: '1' } : undefined)});
  },

  entities(id: string) {
    return trpcClient.sessions.entitiesGet.query({params: {id: id}});
  },

  references(id: string, opts?: { scope?: 'session' | 'workspace' | 'all' }) {
    return trpcClient.sessions.referencesGet.query({params: {id: id}, query: rpcQuery(opts?.scope ? { scope: opts.scope } : undefined)});
  },

  pinRef(id: string, body: { entityType: 'task' | 'note' | 'area'; entityId: string }) {
    return trpcClient.sessions.referencesPost.mutate({params: {id: id}, body: body});
  },

  unpinRef(id: string, body: { entityType: 'task' | 'note' | 'area'; entityId: string }) {
    return trpcClient.sessions.referencesDelete.mutate({params: {id: id}, query: rpcQuery({ entityType: body.entityType, entityId: body.entityId })});
  },

  scratchpad(id: string) {
    return trpcClient.sessions.scratchpadGet.query({params: {id: id}});
  },

  setScratchpad(id: string, scratchPad: string | null) {
    return trpcClient.sessions.scratchpadPut.mutate({params: {id: id}, body: { scratchPad }});
  },

  file(id: string, path: string, opts?: { base?: boolean }) {
    return trpcClient.sessions.fileGet.query({params: {id: id}, query: rpcQuery(opts?.base ? { path, base: '1' } : { path })});
  },

  pr(id: string) {
    return trpcClient.sessions.prGet.query({params: {id: id}});
  },

  prLink(id: string) {
    return trpcClient.sessions.prLinkGet.query({params: {id: id}});
  },

  openPr(id: string) {
    return trpcClient.sessions.prPost.mutate({params: {id: id}});
  },

  mergePr(id: string, body?: MergeRequestBody) {
    return trpcClient.sessions.mergePost.mutate({params: {id: id}, body: body ?? {}});
  },

  setAutoMerge(id: string, body: AutoMergeRequestBody) {
    return trpcClient.sessions.autoMergePost.mutate({params: {id: id}, body: body});
  },

  /** Where each message sent to a device elsewhere stands, by chat event id (P3.2). */
  deliveries(id: string, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.sessions.deliveriesGet.query({params: {id: id}}, rpcOptions({ signal: opts.signal }));
  },

  /** Withdraw a message still waiting in its device's queue. */
  cancelDelivery(id: string, eventId: string) {
    return trpcClient.sessions.deliveriesCancelEventIdPost.mutate({params: {id: id, eventId: eventId}});
  },

  /** The execution's latest move between devices (P4.2). */
  transfer(id: string, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.sessions.transferGet.query({params: {id: id}}, rpcOptions({ signal: opts.signal }));
  },
  /** What a move would take from its worktree, read where it runs. */
  workingState(id: string, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.sessions.transferWorkingStateGet.query({params: {id: id}}, rpcOptions({ signal: opts.signal }));
  },
  startTransfer(id: string, body: { toDeviceId: string; includeUntracked: string[] }) {
    return trpcClient.sessions.transferPost.mutate({params: {id: id}, body: body});
  },
  resumeTransfer(id: string) {
    return trpcClient.sessions.transferResumePost.mutate({params: {id: id}});
  },
  finishTransfer(id: string) {
    return trpcClient.sessions.transferFinishPost.mutate({params: {id: id}});
  },
  /** Send them again: held messages whose delivery stopped short. */
  deliverHeld(id: string) {
    return trpcClient.sessions.transferDeliverPost.mutate({params: {id: id}});
  },

  /** Open code here (P4.1): this device's review checkout of the execution, if any. */
  review(id: string, opts: { signal?: AbortSignal; deviceId?: string } = {}) {
    return trpcClient.sessions.reviewGet.query({ params: { id }, query: { device: opts.deviceId } }, rpcOptions({ signal: opts.signal, headers: hostHeaders() }));
  },
  /** Make or refresh it: refreshed only while it has no edits. */
  openCodeHere(id: string) {
    return trpcClient.sessions.reviewPost.mutate({params: {id: id}, body: {}}, rpcOptions({ headers: hostHeaders() }));
  },
  /** Open it in an app on this device, through its worker. */
  openReview(id: string, target: OpenTarget) {
    return trpcClient.sessions.reviewOpenPost.mutate({params: {id: id}, body: { path: null, target }});
  },

  needsReview(opts: { signal?: AbortSignal } = {}) {
    return trpcClient.sessions.needsReviewGet.query({}, rpcOptions({ signal: opts.signal }));
  },

  /**
   * @deprecated use markRead — `view` is the legacy endpoint, kept so
   *   older callers compile until they migrate.
   */
  markViewed(id: string) {
    return trpcClient.sessions.viewPost.mutate({params: {id: id}});
  },

  markRead(id: string) {
    return trpcClient.sessions.readPost.mutate({params: {id: id}});
  },

  markUnread(id: string) {
    return trpcClient.sessions.unreadPost.mutate({params: {id: id}});
  },

  /** Pin this session's execution to the rail's "Pinned" group. Returns the
   *  session flattened with the updated `execution.pinnedAt`. */
  pin(id: string) {
    return trpcClient.sessions.pinPost.mutate({params: {id: id}});
  },

  /** Unpin this session's execution (clears `execution.pinnedAt`). */
  unpin(id: string) {
    return trpcClient.sessions.unpinPost.mutate({params: {id: id}});
  },

  rail(opts: { signal?: AbortSignal } = {}) {
    return trpcClient.sessions.railGet.query({}, rpcOptions({ signal: opts.signal }));
  },

  history() {
    return trpcClient.sessions.historyList.query({});
  },

  /**
   * Full-text search across chat/execution transcripts. Ranked, one result
   * per session, with a highlighted snippet. Blank query returns [].
   */
  search(query: string, filters?: SessionSearchFilters) {
    return trpcClient.sessions.searchGet.query({query: rpcQuery({
        q: query,
        status: filters?.status,
        workspaceId: filters?.workspaceId,
        source: filters?.source,
        limit: filters?.limit,
      })});
  },

  pendingInputGlobal() {
    return trpcClient.sessions.pendingInputList.query({});
  },

  /**
   * Diff stats for one session. Coalesced with every other row's request in
   * the same tick into a single `POST /sessions/diff-stats` — the rail asks
   * per row, the network carries one call. See `diff-stats-batch.ts`.
   */
  diffStats(id: string): Promise<DiffStats | null> {
    return fetchDiffStatsBatched(id);
  },

  archive(id: string, opts?: { force?: boolean }) {
    return trpcClient.sessions.archivePost.mutate({params: {id: id}, body: { force: opts?.force ?? false }});
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
  ) {
    return trpcClient.sessions.newChatPost.mutate({params: {id: id}, body: opts ?? {}});
  },

  /** Past + current chats for this execution, newest first. */
  chatHistory(id: string) {
    return trpcClient.sessions.historyGet.query({params: {id: id}});
  },

  /**
   * Close (archive) one chat of an execution without touching the
   * execution, its worktree, or sibling chats. Powers the X on the chat
   * tab strip. 409s when it's the execution's last open chat.
   */
  closeChat(id: string) {
    return trpcClient.sessions.closeChatPost.mutate({params: {id: id}, body: {}});
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
  ) {
    return trpcClient.sessions.continuePost.mutate({params: {id: id}, body: opts ?? {}});
  },

  commit(id: string, opts?: { andPush?: boolean }) {
    return trpcClient.sessions.commitPost.mutate({params: {id: id}, body: opts ?? {}});
  },

  push(id: string) {
    return trpcClient.sessions.pushPost.mutate({params: {id: id}});
  },

  pullBase(id: string, strategy: 'merge' | 'rebase' = 'merge') {
    return trpcClient.sessions.pullBasePost.mutate({params: {id: id}, body: { strategy }});
  },

  /** Bring in what was pushed to the branch's own remote copy from elsewhere. */
  pullUpstream(id: string, strategy: 'merge' | 'rebase' = 'merge') {
    return trpcClient.sessions.pullUpstreamPost.mutate({params: {id: id}, body: { strategy }});
  },

  resolveConflicts(
    id: string,
    scenario: 'pr_vs_base' | 'local_vs_remote',
  ) {
    return trpcClient.sessions.resolveConflictsPost.mutate({params: {id: id}, body: { scenario }});
  },

  helpWithError(
    id: string,
    input: {
      action: string;
      error: string;
      context?: ReadonlyArray<{ label: string; value: string }>;
    },
  ) {
    return trpcClient.sessions.helpWithErrorPost.mutate({params: {id: id}, body: { ...input, context: input.context ? [...input.context] : undefined }});
  },

  retrySetup(id: string) {
    return trpcClient.sessions.retrySetupPost.mutate({params: {id: id}});
  },

  retrySetupScript(id: string) {
    return trpcClient.sessions.retrySetupScriptPost.mutate({params: {id: id}});
  },

  sendMessage(
    id: string,
    content: string,
    opts?: { attachments?: Attachment[]; eventId?: string },
  ) {
    return trpcClient.sessions.messagesPost.mutate({params: {id: id}, body: {
      content,
      attachments: opts?.attachments,
      id: opts?.eventId,
    }});
  },

  runtimeStatus(id: string, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.sessions.runtimeStatusGet.query({params: {id: id}}, rpcOptions({ signal: opts.signal }));
  },

  interrupt(id: string) {
    return trpcClient.sessions.interruptPost.mutate({params: {id: id}});
  },

  stopTask(id: string, taskId: string) {
    return trpcClient.sessions.tasksStopTaskIdPost.mutate({params: {id: id, taskId: taskId}});
  },

  reconcile(id: string) {
    return trpcClient.sessions.reconcilePost.mutate({params: {id: id}});
  },

  resync(id: string) {
    return trpcClient.sessions.resyncPost.mutate({params: {id: id}});
  },

  restart(id: string) {
    return trpcClient.sessions.restartPost.mutate({params: {id: id}});
  },

  takeOverImport(id: string) {
    return trpcClient.sessions.takeOverImportPost.mutate({params: {id: id}});
  },

  wip(id: string) {
    return trpcClient.sessions.wipGet.query({params: {id: id}});
  },

  applyWip(id: string, action: 'copy' | 'move') {
    return trpcClient.sessions.wipPost.mutate({params: {id: id}, body: { action }});
  },
};
