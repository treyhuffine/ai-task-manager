import { api } from './client';
import type { RunOn } from '@/lib/setups/run-on';
import type { SetupAgentInput, SetupAgentPlan, SetupOutcome } from '@/lib/setups/set-up-agent';
import type { AgentFoldersOn } from '@/lib/setups/folders';
import type { FolderListing } from '@/lib/setups/folders-here';
import type {
  WorkspaceRecord,
  WorkspaceWithCounts,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  ChatSessionWithExecution,
  WorkspaceStatus,
  EffortLevel,
} from '@/db/types';

export type AgentFolders = { devices: AgentFoldersOn[] };

export const workspacesApi = {
  list(filter?: { status?: WorkspaceStatus }, opts: { signal?: AbortSignal } = {}): Promise<WorkspaceWithCounts[]> {
    return api.get<WorkspaceWithCounts[]>('/workspaces', {
      query: filter as Record<string, string>,
      signal: opts.signal,
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

  /** One row per execution. `includeArchived` adds finished work (launcher only). */
  sessions(id: string, opts: { includeArchived?: boolean } = {}): Promise<ChatSessionWithExecution[]> {
    return api.get<ChatSessionWithExecution[]>(`/workspaces/${id}/sessions`, {
      query: opts.includeArchived ? { includeArchived: true } : undefined,
    });
  },

  createSession(
    id: string,
    options: {
      /** Pre-allocated id so the caller can navigate before this resolves. */
      sessionId?: string | null;
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
      /** Explicit agent selection (the launcher's model control). Sent as
       *  a tuple; omitting them falls back to the saved global default. */
      harness?: string | null;
      model?: string | null;
      modelVariant?: string | null;
      effort?: EffortLevel | null;
      /** "Start with agent": the task this workstream is associated with. Server
       *  records the association and atomically Starts the task (Consider/Todo -> In progress). */
      taskId?: string | null;
      /** Run on this device. Omitted: the agent's default (P3.1). */
      deviceId?: string | null;
    } = {},
  ): Promise<ChatSessionWithExecution> {
    return api.post<ChatSessionWithExecution>(`/workspaces/${id}/sessions`, {
      sessionId: options.sessionId ?? undefined,
      label: options.label ?? null,
      baseBranch: options.baseBranch ?? null,
      prNumber: options.prNumber ?? null,
      liveMode: options.liveMode ?? false,
      harness: options.harness ?? undefined,
      model: options.model ?? null,
      modelVariant: options.modelVariant ?? null,
      effort: options.effort ?? null,
      taskId: options.taskId ?? null,
      deviceId: options.deviceId ?? undefined,
    });
  },

  /** Where the agent's new executions can run, and where they run by default (P3.1). */
  runOn(id: string): Promise<RunOn> {
    return api.get<RunOn>(`/workspaces/${id}/run-on`);
  },

  /** "Make this the default", or null to go back to the automatic choice. */
  setDefaultDevice(id: string, deviceId: string | null): Promise<RunOn> {
    return api.put<RunOn>(`/workspaces/${id}/run-on`, { defaultDeviceId: deviceId });
  },

  /** What setting the agent up on that device would do (docs/homes-model.md). */
  setupPlan(id: string, deviceId: string, opts: { signal?: AbortSignal } = {}): Promise<SetupAgentPlan> {
    return api.get<SetupAgentPlan>(`/workspaces/${id}/setups`, { query: { deviceId }, signal: opts.signal });
  },

  /** Set the agent up on that device: its project copied down, or a folder already there. */
  setUp(id: string, body: SetupAgentInput & { deviceId: string }): Promise<SetupOutcome> {
    return api.post<SetupOutcome>(`/workspaces/${id}/setups`, body);
  },

  /** The agent's folders on each of the person's devices (docs/homes-spec.md §4.1). */
  folders(id: string, opts: { signal?: AbortSignal } = {}): Promise<AgentFolders> {
    return api.get<AgentFolders>(`/workspaces/${id}/folders`, { signal: opts.signal });
  },

  /** The agent's project folder on a device. */
  setProjectFolder(id: string, deviceId: string, folder: string): Promise<AgentFolders> {
    return api.put<AgentFolders>(`/workspaces/${id}/folders/${deviceId}`, { folder });
  },

  /** Where a linked folder is on a device, or null to go without it there. */
  setLinkedFolder(id: string, deviceId: string, referenceFolderId: string, folder: string | null): Promise<AgentFolders> {
    return api.put<AgentFolders>(`/workspaces/${id}/folders/${deviceId}/linked/${referenceFolderId}`, { folder });
  },

  /** A new linked folder, placed on the device it's added from. */
  addLinkedFolder(id: string, body: { alias: string; description: string | null; forEveryAgent: boolean; deviceId: string; folder: string }): Promise<AgentFolders> {
    return api.post<AgentFolders>(`/workspaces/${id}/folders`, body);
  },

  /** Take the agent off a device. Nothing there is deleted. */
  removeFromDevice(id: string, deviceId: string): Promise<AgentFolders> {
    return api.delete<AgentFolders>(`/workspaces/${id}/folders/${deviceId}`);
  },

  /** A folder's folders on a device, for choosing one. */
  deviceFolders(deviceId: string, at: string | null, opts: { signal?: AbortSignal } = {}): Promise<FolderListing> {
    return api.get<FolderListing>(`/devices/${deviceId}/folders`, { query: at ? { path: at } : undefined, signal: opts.signal });
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

  /** How far the workspace's own checkout is behind its base. Fetches first. */
  baseStatus(id: string): Promise<WorkspaceBaseStatus | null> {
    return api.get<WorkspaceBaseStatus | null>(`/workspaces/${id}/base-status`, {
      timeoutMs: 30_000,
    });
  },

  /** Merge the base branch into the workspace's own checkout (Live mode). */
  pullBase(id: string, strategy: 'merge' | 'rebase' = 'merge'): Promise<{ ok: true; behind: number }> {
    return api.post<{ ok: true; behind: number }>(`/workspaces/${id}/pull-base`, { strategy }, {
      timeoutMs: 60_000,
    });
  },

  /** Full PR detail including `body`. Fetched on demand by the launcher. */
  getPR(id: string, number: number): Promise<PRDetail> {
    return api.get<PRDetail>(`/workspaces/${id}/github/prs/${number}`);
  },

  /** Full issue detail including `body`. Fetched on demand by the launcher. */
  getIssue(id: string, number: number): Promise<IssueDetail> {
    return api.get<IssueDetail>(`/workspaces/${id}/github/issues/${number}`);
  },

  previewFilesToCopy(cwd: string, globs: string[]): Promise<PreviewFilesToCopyResponse> {
    return api.post<PreviewFilesToCopyResponse>('/workspaces/preview-files', {
      cwd,
      globs,
    });
  },

  /** Suggest setup/start commands from the files in a checkout (placeholders only). */
  detectStack(cwd: string): Promise<StackSuggestion> {
    return api.post<StackSuggestion>('/workspaces/detect-stack', { cwd });
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

export interface StackSuggestion {
  setup: string;
  start: string;
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

/** List rows omit `body` (it would bloat every row); the per-item routes add it. */
export interface WorkspaceBaseStatus {
  branch: string | null;
  base: string;
  behind: number;
  dirty: boolean;
  warning: string | null;
}

export interface PRDetail extends PRSummary {
  body: string;
}

export interface IssueDetail extends IssueSummary {
  body: string;
}
