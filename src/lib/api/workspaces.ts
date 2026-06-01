import { api } from './client';
import type {
  WorkspaceRecord,
  WorkspaceWithCounts,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  ChatSessionWithExecution,
  WorkspaceStatus,
} from '@/db/types';

export const workspacesApi = {
  list(filter?: { status?: WorkspaceStatus }): Promise<WorkspaceWithCounts[]> {
    return api.get<WorkspaceWithCounts[]>('/workspaces', {
      query: filter as Record<string, string>,
    });
  },

  get(id: string): Promise<WorkspaceRecord> {
    return api.get<WorkspaceRecord>(`/workspaces/${id}`);
  },

  create(input: Partial<CreateWorkspaceInput> & { name: string; cwd: string }): Promise<WorkspaceRecord> {
    return api.post<WorkspaceRecord>('/workspaces', input);
  },

  update(id: string, input: UpdateWorkspaceInput): Promise<WorkspaceRecord> {
    return api.patch<WorkspaceRecord>(`/workspaces/${id}`, input);
  },

  archive(id: string): Promise<WorkspaceRecord> {
    return api.post<WorkspaceRecord>(`/workspaces/${id}/archive`);
  },

  reorder(ids: string[]): Promise<{ ok: true }> {
    return api.post<{ ok: true }>('/workspaces/reorder', { ids });
  },

  sessions(id: string): Promise<ChatSessionWithExecution[]> {
    return api.get<ChatSessionWithExecution[]>(`/workspaces/${id}/sessions`);
  },

  createSession(
    id: string,
    options: {
      label?: string | null;
      baseBranch?: string | null;
      /** GitHub PR number — when set, server resolves the head via
       *  `refs/pull/<N>/head` and stamps `prNumber` on the row. Takes
       *  precedence over `baseBranch`. */
      prNumber?: number | null;
      /** "Live mode" — skip worktree creation. The agent runs in the
       *  workspace's actual folder on whatever branch is checked out.
       *  Caller is opting into shared mutable state. */
      liveMode?: boolean;
    } = {},
  ): Promise<ChatSessionWithExecution> {
    return api.post<ChatSessionWithExecution>(`/workspaces/${id}/sessions`, {
      label: options.label ?? null,
      baseBranch: options.baseBranch ?? null,
      prNumber: options.prNumber ?? null,
      liveMode: options.liveMode ?? false,
    });
  },

  listPRs(id: string): Promise<PRSummary[]> {
    return api.get<PRSummary[]>(`/workspaces/${id}/github/prs`);
  },

  listIssues(id: string): Promise<IssueSummary[]> {
    return api.get<IssueSummary[]>(`/workspaces/${id}/github/issues`);
  },

  listBranches(id: string): Promise<string[]> {
    return api.get<string[]>(`/workspaces/${id}/branches`);
  },

  previewFilesToCopy(cwd: string, globs: string[]): Promise<PreviewFilesToCopyResponse> {
    return api.post<PreviewFilesToCopyResponse>('/workspaces/preview-files', {
      cwd,
      globs,
    });
  },

  // NOTE: the app preview pane (iframe) is per-execution now — see
  // `src/lib/api/preview.ts` (`previewApi`). This `workspacesApi` only keeps
  // the unrelated `previewFilesToCopy` (worktree seed-file preview).
};

export interface PreviewFilesToCopyResponse {
  files: string[];
  truncated: boolean;
  root: string;
}

/** Subset of @agentex/github's PRSummary — kept inline so the client
 *  bundle doesn't pull the full library. */
export interface PRSummary {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  author: { login: string };
  createdAt: string;
  updatedAt: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  url: string;
  author: { login: string };
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  createdAt: string;
  updatedAt: string;
}
