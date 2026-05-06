import { api } from './client';
import type { ChatSessionRecord, ChatEventRecord } from '@/db/types';

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

export const sessionsApi = {
  get(id: string): Promise<ChatSessionRecord> {
    return api.get<ChatSessionRecord>(`/sessions/${id}`);
  },

  update(id: string, input: { label?: string | null }): Promise<ChatSessionRecord> {
    return api.patch<ChatSessionRecord>(`/sessions/${id}`, input);
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

  sendMessage(id: string, content: string): Promise<ChatEventRecord> {
    return api.post<ChatEventRecord>(`/sessions/${id}/messages`, { content });
  },

  runtimeStatus(id: string): Promise<{ running: boolean }> {
    return api.get<{ running: boolean }>(`/sessions/${id}/runtime-status`);
  },

  interrupt(id: string): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/sessions/${id}/interrupt`);
  },
};
