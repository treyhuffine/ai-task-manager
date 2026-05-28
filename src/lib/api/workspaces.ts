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
       *  `refs/pull/<N>/head` and stamps `pr_number` on the row. Takes
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

  // ── App preview pane (the iframe / proxy feature) ───────────
  // Distinct from `previewFilesToCopy` above, which is unrelated to
  // the preview pane and only previews which files would be copied
  // into a new worktree at session creation time.
  appPreview: {
    status(id: string): Promise<AppPreviewStatusResponse> {
      return api.get<AppPreviewStatusResponse>(`/workspaces/${id}/preview/status`);
    },
    start(id: string): Promise<AppPreviewStartResponse> {
      return api.post<AppPreviewStartResponse>(`/workspaces/${id}/preview/start`);
    },
    stop(id: string): Promise<{ ok: true }> {
      return api.post<{ ok: true }>(`/workspaces/${id}/preview/stop`);
    },
    logs(id: string, cursor = 0): Promise<AppPreviewLogsResponse> {
      return api.get<AppPreviewLogsResponse>(`/workspaces/${id}/preview/logs`, {
        query: { cursor },
      });
    },
    refreshToken(id: string): Promise<{ preview_token: string }> {
      return api.post<{ preview_token: string }>(`/workspaces/${id}/preview/refresh-token`);
    },
  },
};

export type AppPreviewMode = 'command' | 'portless';
export type AppPreviewStatus = 'idle' | 'starting' | 'running' | 'crashed' | 'stopped';

export interface AppPreviewStatusResponse {
  mode: AppPreviewMode;
  status: AppPreviewStatus;
  port: number | null;
  /** Present for both modes. Iframe attaches it as `?_pt=` on first load. */
  preview_token: string | null;
  /** Portless only — the hostname Flow expects the route under. */
  hostname?: string | null;
  /** Portless only — Tailscale URL surfaced into the execution header. */
  tailscale_url?: string | null;
  /** Tailscale funnel public URL (Portless only, if enabled). */
  tailscale_funnel_url?: string | null;
  /** Command mode only. */
  started_at?: string | null;
  exited_at?: string | null;
  exit_code?: number | null;
  /** When the supervisor / portless route is unhealthy, an explanation. */
  message?: string | null;
}

export interface AppPreviewStartResponse extends AppPreviewStatusResponse {
  preview_token: string;
}

export interface AppPreviewLogLine {
  seq: number;
  at: string;
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface AppPreviewLogsResponse {
  cursor: number;
  lines: AppPreviewLogLine[];
}

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
