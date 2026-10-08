import type {
	CreateWorkspaceInput,
	EffortLevel,
	UpdateWorkspaceInput,
	WorkspaceStatus
} from '@/db/types';
import type { SetupAgentInput } from '@/lib/setups/set-up-agent';
import { trpcClient } from '@/lib/trpc/client';
import { rpcOptions, rpcQuery } from '@/lib/trpc/request-options';
import type { RouterOutputs } from '@/lib/trpc/router';

export type AgentFolders = RouterOutputs['workspaces']['foldersGet'];

export const workspacesApi = {
  list(filter?: { status?: WorkspaceStatus }, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.workspaces.list.query({query: rpcQuery(filter as Record<string, string>)}, rpcOptions({ signal: opts.signal }));
  },

  get(id: string) {
    return trpcClient.workspaces.get.query({params: {id: id}});
  },

  create(input: Partial<CreateWorkspaceInput> & { name: string; cwd: string }) {
    return trpcClient.workspaces.create.mutate({body: input});
  },

  update(id: string, input: UpdateWorkspaceInput) {
    return trpcClient.workspaces.update.mutate({params: {id: id}, body: input});
  },

  archive(id: string) {
    return trpcClient.workspaces.archivePost.mutate({params: {id: id}});
  },

  reorder(ids: string[]) {
    return trpcClient.workspaces.reorderPost.mutate({body: { ids }});
  },

  /** One row per execution. `includeArchived` adds finished work (launcher only). */
  sessions(id: string, opts: { includeArchived?: boolean } = {}) {
    return trpcClient.workspaces.sessionsGet.query({params: {id: id}, query: rpcQuery(opts.includeArchived ? { includeArchived: true } : undefined)});
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
  ) {
    return trpcClient.workspaces.sessionsPost.mutate({params: {id: id}, body: {
      sessionId: options.sessionId ?? undefined,
      label: options.label ?? undefined,
      baseBranch: options.baseBranch ?? undefined,
      prNumber: options.prNumber ?? null,
      liveMode: options.liveMode ?? false,
      harness: options.harness ?? undefined,
      model: options.model ?? null,
      modelVariant: options.modelVariant ?? null,
      effort: options.effort ?? null,
      taskId: options.taskId ?? null,
      deviceId: options.deviceId ?? undefined,
    }});
  },

  /** Where the agent's new executions can run, and where they run by default (P3.1). */
  runOn(id: string) {
    return trpcClient.workspaces.runOnGet.query({params: {id: id}});
  },

  /** "Make this the default", or null to go back to the automatic choice. */
  setDefaultDevice(id: string, deviceId: string | null) {
    return trpcClient.workspaces.runOnPut.mutate({params: {id: id}, body: { defaultDeviceId: deviceId }});
  },

  /** What setting the agent up on that device would do (docs/homes-model.md). */
  setupPlan(id: string, deviceId: string, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.workspaces.setupsGet.query({params: {id: id}, query: rpcQuery({ deviceId })}, rpcOptions({ signal: opts.signal }));
  },

  /** Set the agent up on that device: its project copied down, or a folder already there. */
  setUp(id: string, body: SetupAgentInput & { deviceId: string }) {
    return trpcClient.workspaces.setupsPost.mutate({params: {id: id}, body: body});
  },

  /** The agent's folders on each of the person's devices (docs/homes-spec.md §4.1). */
  folders(id: string, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.workspaces.foldersGet.query({params: {id: id}}, rpcOptions({ signal: opts.signal }));
  },

  /** The agent's project folder on a device. */
  setProjectFolder(id: string, deviceId: string, folder: string) {
    return trpcClient.workspaces.foldersDeviceIdPut.mutate({params: {id: id, deviceId: deviceId}, body: { folder }});
  },

  /** Where a linked folder is on a device, or null to go without it there. */
  setLinkedFolder(id: string, deviceId: string, referenceFolderId: string, folder: string | null) {
    return trpcClient.workspaces.foldersLinkedDeviceIdReferenceFolderIdPut.mutate({params: {id: id, deviceId: deviceId, referenceFolderId: referenceFolderId}, body: { folder }});
  },

  /** A new linked folder, placed on the device it's added from. */
  addLinkedFolder(id: string, body: { alias: string; description: string | null; forEveryAgent: boolean; readOnly: boolean; deviceId: string; folder: string }) {
    return trpcClient.workspaces.foldersPost.mutate({params: {id: id}, body: body});
  },

  /** Take the agent off a device. Nothing there is deleted. */
  removeFromDevice(id: string, deviceId: string) {
    return trpcClient.workspaces.foldersDeviceIdDelete.mutate({params: {id: id, deviceId: deviceId}});
  },

  /** A folder's folders on a device, for choosing one. */
  deviceFolders(deviceId: string, at: string | null, opts: { signal?: AbortSignal } = {}) {
    return trpcClient.devices.foldersGet.query({params: {id: deviceId}, query: rpcQuery(at ? { path: at } : undefined)}, rpcOptions({ signal: opts.signal }));
  },

  listPRs(id: string) {
    return trpcClient.workspaces.githubPrsGet.query({params: {id: id}});
  },

  listIssues(id: string) {
    return trpcClient.workspaces.githubIssuesGet.query({params: {id: id}});
  },

  listBranches(id: string) {
    return trpcClient.workspaces.branchesGet.query({params: {id: id}});
  },

  /** How far the workspace's own checkout is behind its base. Fetches first. */
  baseStatus(id: string) {
    return trpcClient.workspaces.baseStatusGet.query({params: {id: id}}, rpcOptions({
      timeoutMs: 30_000,
    }));
  },

  /** Merge the base branch into the workspace's own checkout (Live mode). */
  pullBase(id: string, strategy: 'merge' | 'rebase' = 'merge') {
    return trpcClient.workspaces.pullBasePost.mutate({params: {id: id}, body: { strategy }}, rpcOptions({
      timeoutMs: 60_000,
    }));
  },

  /** Full PR detail including `body`. Fetched on demand by the launcher. */
  getPR(id: string, number: number) {
    return trpcClient.workspaces.githubPrsNumberGet.query({params: {id: id, number: String(number)}});
  },

  /** Full issue detail including `body`. Fetched on demand by the launcher. */
  getIssue(id: string, number: number) {
    return trpcClient.workspaces.githubIssuesNumberGet.query({params: {id: id, number: String(number)}});
  },

  previewFilesToCopy(cwd: string, globs: string[]) {
    return trpcClient.workspaces.previewFilesPost.mutate({body: {
      cwd,
      globs,
    }});
  },

  /** Suggest setup/start commands from the files in a checkout (placeholders only). */
  detectStack(cwd: string) {
    return trpcClient.workspaces.detectStackPost.mutate({body: { cwd }});
  },

  // NOTE: the app preview pane (iframe) is per-execution now — see
  // `src/lib/api/preview.ts` (`previewApi`). This `workspacesApi` only keeps
  // the unrelated `previewFilesToCopy` (worktree seed-file preview).
};

export type PreviewFilesToCopyResponse = RouterOutputs['workspaces']['previewFilesPost'];

export type StackSuggestion = RouterOutputs['workspaces']['detectStackPost'];

/** Subset of @agentex/github's PRSummary — kept inline so the client
 *  bundle doesn't pull the full library. */
export type PRSummary = RouterOutputs['workspaces']['githubPrsGet'][number];

export type IssueSummary = RouterOutputs['workspaces']['githubIssuesGet'][number];

/** List rows omit `body` (it would bloat every row); the per-item routes add it. */
export type WorkspaceBaseStatus = RouterOutputs['workspaces']['baseStatusGet'];

export type PRDetail = RouterOutputs['workspaces']['githubPrsNumberGet'];

export type IssueDetail = RouterOutputs['workspaces']['githubIssuesNumberGet'];
