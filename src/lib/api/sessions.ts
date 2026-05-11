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

export interface ResolvePendingBody {
  allow: boolean;
  message?: string;
  answers?: Record<string, string>;
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

/**
 * `chat_sessions` row plus a sidecar `agent_harness` field that the GET
 * endpoint joins in. Used by the composer to pick the right model
 * catalog without a second fetch.
 */
export interface ChatSessionWithAgent extends ChatSessionRecord {
  agent_harness: string | null;
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

  needsReview(): Promise<ChatSessionRecord[]> {
    return api.get<ChatSessionRecord[]>('/sessions/needs-review');
  },

  markViewed(id: string): Promise<ChatSessionRecord> {
    return api.post<ChatSessionRecord>(`/sessions/${id}/view`);
  },

  diffStats(id: string): Promise<DiffStats | null> {
    return api.get<DiffStats | null>(`/sessions/${id}/diff-stats`);
  },

  archive(id: string, opts?: { force?: boolean }): Promise<ChatSessionRecord> {
    return api.post<ChatSessionRecord>(`/sessions/${id}/archive`, { force: opts?.force ?? false });
  },

  commit(id: string, message: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/commit`, { message });
  },

  push(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/push`);
  },

  pullBase(id: string, strategy: 'merge' | 'rebase' = 'merge'): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/pull-base`, { strategy });
  },

  sendMessage(
    id: string,
    content: string,
    opts?: { attachments?: Attachment[] },
  ): Promise<ChatEventRecord> {
    return api.post<ChatEventRecord>(`/sessions/${id}/messages`, {
      content,
      attachments: opts?.attachments,
    });
  },

  runtimeStatus(id: string): Promise<{ running: boolean }> {
    return api.get<{ running: boolean }>(`/sessions/${id}/runtime-status`);
  },

  interrupt(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/interrupt`);
  },

  wip(id: string): Promise<WipDetection | null> {
    return api.get<WipDetection | null>(`/sessions/${id}/wip`);
  },

  applyWip(id: string, action: 'copy' | 'move'): Promise<WipApplyResult> {
    return api.post<WipApplyResult>(`/sessions/${id}/wip`, { action });
  },
};
