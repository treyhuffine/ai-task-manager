import { api } from './client';
import type {
  ChatSessionRecord, ChatEventRecord,
  PermissionMode, EffortLevel, Attachment,
} from '@/db/types';

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
  | 'untracked';

export interface TreeEntry {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size?: number;
  status?: TreeEntryStatus;
  mtime?: string;
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
  expires_at: string;
  cli_command: string;
  fallback_command: string;
  branch: string;
  base_sha: string;
  remote_url: string;
  workspace_id: string;
  started_at: string;
}

export interface ResumeFromTakeoverResponse {
  ok: true;
  files_changed: number;
  shortstat: string;
  session_id: string;
}

/**
 * `chat_sessions` row plus a sidecar `agent_harness` field that the GET
 * endpoint joins in. Used by the composer to pick the right model
 * catalog without a second fetch.
 */
export interface ChatSessionWithAgent extends ChatSessionRecord {
  agent_harness: string | null;
}

/**
 * Wire shape of a rail session row — chat_session columns plus the
 * workspace columns the row needs (name, emoji, cover image, area link).
 * `attachments` carries through unchanged so the renderer can resolve
 * cover images via the existing `coverAttachmentUrl` helper.
 */
export interface RailSession extends ChatSessionRecord {
  workspace_name: string | null;
  workspace_emoji: string | null;
  workspace_attachments: Attachment[] | null;
  workspace_area_id: string | null;
  workspace_is_git: boolean | null;
}

export interface RailResponse {
  sessions: RailSession[];
  pendingSessionIds: string[];
  runningSessionIds: string[];
}

export const sessionsApi = {
  get(id: string): Promise<ChatSessionWithAgent> {
    return api.get<ChatSessionWithAgent>(`/sessions/${id}`);
  },

  update(
    id: string,
    input: {
      label?: string | null;
      permission_mode?: PermissionMode;
      model?: string | null;
      effort?: EffortLevel | null;
      pr_number?: number | null;
    },
  ): Promise<ChatSessionRecord> {
    return api.patch<ChatSessionRecord>(`/sessions/${id}`, input);
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

  events(id: string): Promise<ChatEventRecord[]> {
    return api.get<ChatEventRecord[]>(`/sessions/${id}/events`);
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

  needsReview(): Promise<ChatSessionRecord[]> {
    return api.get<ChatSessionRecord[]>('/sessions/needs-review');
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

  pendingInputGlobal(): Promise<{ sessionIds: string[] }> {
    return api.get<{ sessionIds: string[] }>('/sessions/pending-input');
  },

  diffStats(id: string): Promise<DiffStats | null> {
    return api.get<DiffStats | null>(`/sessions/${id}/diff-stats`);
  },

  archive(id: string, opts?: { force?: boolean }): Promise<ChatSessionRecord> {
    return api.post<ChatSessionRecord>(`/sessions/${id}/archive`, { force: opts?.force ?? false });
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

  retrySetup(id: string): Promise<ChatSessionRecord> {
    return api.post<ChatSessionRecord>(`/sessions/${id}/retry-setup`);
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

  runtimeStatus(id: string): Promise<{ running: boolean }> {
    return api.get<{ running: boolean }>(`/sessions/${id}/runtime-status`);
  },

  interrupt(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/interrupt`);
  },

  reconcile(id: string): Promise<ReconcileResult> {
    return api.post<ReconcileResult>(`/sessions/${id}/reconcile`);
  },

  resync(id: string): Promise<ResyncResult> {
    return api.post<ResyncResult>(`/sessions/${id}/resync`);
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
