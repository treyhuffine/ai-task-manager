/**
 * Execution session lifecycle: create + archive.
 *
 * Two responsibilities, both spanning DB and filesystem:
 *
 *   1. dispatchExecutionSession — when the user "starts" an execution in a
 *      workspace, we want one atomic outcome: a chat_sessions row that
 *      either reflects a real worktree on disk or doesn't exist. We
 *      generate the id up front so the worktree path can be computed,
 *      attempt the worktree, then insert the row. If the worktree fails
 *      we never insert — the user sees the error and the DB stays clean.
 *
 *   2. archiveExecutionSession — flip status='archived' on the row and,
 *      for git workspaces, tear down the worktree via @agentex/workspace.
 *      DirtyWorktreeError surfaces upward so the API can return 409 and
 *      the client can prompt for force confirmation.
 *
 * The DB layer (queries.ts) stays sync + pure-DB. This module is the
 * async orchestration layer that combines DB writes with filesystem ops.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { uuidv7 } from 'uuidv7';
import {
  getWorkspace,
  archiveChatSession,
  getChatSessionWithExecution,
  createExecutionWithChat,
  markExecutionSetupStarted,
  markExecutionSetupComplete,
  recordExecutionSetupError,
  archiveExecution,
  getOrCreateDefaultExecutor,
} from '@/lib/db/queries';
import {
  createWorktreeForSession,
  archiveSessionWorktree,
  fetchPrHead,
} from '@/lib/workspaces';
import type { ChatSessionWithExecution, WorkspaceRecord } from '@/db/types';

const execFileAsync = promisify(execFile);

/**
 * Snapshot the current branch + HEAD of a workspace's checked-out
 * directory. Used by Live mode (`liveMode: true` dispatch) to record
 * what state the agent inherited. Best-effort — null fields surface
 * to the UI as "(unknown)" but don't block session creation.
 */
async function snapshotLiveBranchAndSha(cwd: string): Promise<{ branch: string | null; sha: string | null }> {
  try {
    const branchResult = await execFileAsync('git', ['branch', '--show-current'], { cwd });
    const shaResult = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return {
      branch: branchResult.stdout.trim() || null,
      sha: shaResult.stdout.trim() || null,
    };
  } catch (err) {
    console.warn('[dispatch] snapshotLiveBranchAndSha failed:', err);
    return { branch: null, sha: null };
  }
}

export interface DispatchExecutionSessionArgs {
  workspaceId: string;
  /** Optional. If null/empty, the row is created with `label = null` and
   *  the branch falls back to `<workspace>/session-<short-id>`. The
   *  label is later derived from the first user message. */
  label?: string | null;
  harness?: string;
  /** Override the workspace's default base branch. Used by "Create
   *  from → Branch" (e.g. `origin/feat-foo`) and "Create from → Issue"
   *  (workspace default). Falls back to `workspace.baseBranch` when
   *  null/empty. Ignored when `prNumber` is set — that path resolves
   *  the base via a deterministic PR head fetch. */
  baseBranch?: string | null;
  /** When set, this session was started from a GitHub PR. Server fetches
   *  `refs/pull/<N>/head` from the workspace remote and uses that SHA as
   *  the worktree base, and stamps `prNumber` on the row so the PR
   *  link is wired up front. */
  prNumber?: number | null;
  /** "Live mode" — skip worktree creation entirely. The agent runs in
   *  `workspace.cwd` on whatever branch is currently checked out. No
   *  isolation; the user is opting into shooting themselves in the foot
   *  for speed. Ignored for non-git workspaces (they already work this
   *  way by default). */
  liveMode?: boolean;
}

export class WorkspaceNotFoundForDispatch extends Error {
  constructor(public workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = 'WorkspaceNotFoundForDispatch';
  }
}

/**
 * Create an execution session. The row is inserted immediately so the
 * client can navigate into the new ExecutionView and render its
 * SetupCard right away. For git workspaces, the worktree is created in
 * the background; the row's `worktreePath`, `branchName`, and
 * `baseSha` start null and update once `git worktree add` completes.
 * The UI polls the session and renders a "setting up" state until those
 * fields populate (~2-5s for fast machines, longer for big repos).
 *
 * For non-git workspaces, no worktree is provisioned — the agent runs
 * in `workspace.cwd` directly. The row is "ready" immediately.
 *
 * Failure mode: if worktree provisioning throws, we log and leave the
 * row in its pending state. The user can archive and retry. (We could
 * persist a setupError column for richer UX; deferred until this
 * actually bites.)
 */
export async function dispatchExecutionSession(
  args: DispatchExecutionSessionArgs,
): Promise<ChatSessionWithExecution> {
  const ws = getWorkspace(args.workspaceId);
  if (!ws) throw new WorkspaceNotFoundForDispatch(args.workspaceId);

  const agent = getOrCreateDefaultExecutor(args.harness ?? 'claude_code');
  const sessionId = uuidv7();
  const label = args.label?.trim() || null;
  const prNumber = normalizePrNumber(args.prNumber);
  const liveMode = !!args.liveMode && ws.isGit;

  // Live mode: snapshot the current branch + HEAD of the workspace's
  // actual folder, set worktreePath = ws.cwd, skip provisioning. The
  // session lands fully populated; no SetupCard, no async wait.
  let liveBranch: string | null = null;
  let liveBaseSha: string | null = null;
  if (liveMode) {
    const snap = await snapshotLiveBranchAndSha(ws.cwd);
    liveBranch = snap.branch;
    liveBaseSha = snap.sha;
  }

  // Create the execution artifact + its first chat atomically. For
  // worktree dispatches the execution starts with null worktree fields
  // and the background provisioner populates them ~2-5s later. For Live
  // mode (or non-git workspaces) the path/branch/sha are populated up
  // front. The durable state lives on the execution; the chat just points
  // at it via executionId.
  const { execution } = createExecutionWithChat({
    workspaceId: args.workspaceId,
    agentId: agent.id,
    chatSessionId: sessionId,
    label,
    worktreePath: liveMode ? ws.cwd : null,
    branchName: liveBranch,
    baseSha: liveBaseSha,
    prNumber: prNumber,
    setupStartedAt: ws.isGit && !liveMode ? new Date().toISOString() : null,
  });

  if (ws.isGit && !liveMode) {
    // Fire-and-forget. The promise resolves into the void; we record
    // setupError on the execution when it fails so the UI can surface a
    // retry affordance instead of spinning forever.
    void provisionWorktreeForSession({
      ws,
      executionId: execution.id,
      sessionId,
      label,
      baseBranchOverride: args.baseBranch ?? null,
      prNumber,
    });
  }

  // Return the flattened session so the POST response carries the
  // execution's worktree/branch/PR state — matters for live mode, where
  // those are populated up front and the client renders the running state
  // immediately instead of waiting for a refetch.
  return getChatSessionWithExecution(sessionId)!;
}

/**
 * Re-run worktree provisioning for an existing pending session — used by
 * `POST /api/sessions/:id/retry-setup` after the user fixes the cause of a
 * prior failure (e.g. authenticated gh, brought the network back).
 *
 * Clears `setupError` up front so the UI flips out of the failed chip the
 * moment the user clicks Pull; the column is repopulated if the retry
 * itself fails.
 */
export async function retryProvisionWorktree(
  sessionId: string,
): Promise<ChatSessionWithExecution | null> {
  const session = getChatSessionWithExecution(sessionId);
  if (!session) return null;
  if (session.worktreePath) return session;
  if (!session.workspaceId || !session.executionId) return session;
  const ws = getWorkspace(session.workspaceId);
  if (!ws) return session;
  if (!ws.isGit) return session;

  // Reset the per-attempt timer (and clear any prior error) so the UI's
  // "creating worktree… Ns" anchors to this retry instead of the original
  // creation timestamp.
  markExecutionSetupStarted(session.executionId);
  await provisionWorktreeForSession({
    ws,
    executionId: session.executionId,
    sessionId,
    label: session.label,
    baseBranchOverride: null,
    prNumber: session.prNumber ?? null,
  });
  return getChatSessionWithExecution(sessionId);
}

interface ProvisionArgs {
  ws: WorkspaceRecord;
  /** The execution whose worktree state these results are written to. */
  executionId: string;
  /** The initiating chat's id — still used to derive the worktree leaf /
   *  branch suffix. Cosmetic; the artifact is recorded on the execution. */
  sessionId: string;
  label: string | null;
  baseBranchOverride: string | null;
  prNumber: number | null;
}

/**
 * Background worktree creation for a freshly-created execution. Writes the
 * worktree's path, branch, and base SHA onto the execution when the library
 * finishes (via `markExecutionSetupComplete`). On failure, records the
 * message on the execution's `setupError` so the UI can render the failure
 * and offer a Pull/retry button.
 *
 * When `prNumber` is set, fetches `refs/pull/<N>/head` first and passes
 * that ref as the base — works for same-repo and fork PRs alike.
 */
async function provisionWorktreeForSession(args: ProvisionArgs): Promise<void> {
  const { ws, executionId, sessionId, label, baseBranchOverride, prNumber } = args;
  try {
    let baseRef = baseBranchOverride;
    if (prNumber !== null) {
      const fetched = await fetchPrHead({ ws, prNumber });
      baseRef = fetched.ref;
    }
    const worktree = await createWorktreeForSession({
      ws,
      sessionId,
      sessionLabel: label,
      baseBranchOverride: baseRef,
    });
    markExecutionSetupComplete(executionId, {
      worktreePath: worktree.path,
      branchName: worktree.branch,
      baseSha: worktree.baseSha,
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[dispatch] worktree provisioning failed for execution ${executionId}:`, msg);
    recordExecutionSetupError(executionId, msg);
  }
}

function normalizePrNumber(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  if (!Number.isInteger(raw) || raw <= 0) return null;
  return raw;
}

export interface ArchiveExecutionSessionArgs {
  sessionId: string;
  /**
   * If `false` (default), worktrees with uncommitted/unpushed changes
   * cause `DirtyWorktreeError` to propagate so the caller can prompt the
   * user. If `true`, force-archive — `git worktree remove --force` runs
   * regardless of dirty state and uncommitted work is lost.
   */
  force?: boolean;
}

/**
 * Archive an execution session: flip status='archived' on the row and
 * tear down its worktree (git workspaces only).
 *
 * Important: we tear down the worktree BEFORE flipping status. If the
 * worktree teardown fails (e.g. dirty), the row stays active and the
 * user can resolve. Flipping first would leave a stale "archived" row
 * with a live worktree on disk, which is confusing to recover from.
 */
export async function archiveExecutionSession(
  args: ArchiveExecutionSessionArgs,
): Promise<ChatSessionWithExecution | null> {
  const session = getChatSessionWithExecution(args.sessionId);
  if (!session) return null;

  // Workspace lookup is best-effort — a workspace can be deleted out from
  // under sessions, but we still want to be able to archive the row.
  if (session.worktreePath) {
    // Live-mode sessions point at the workspace's actual cwd. Removing
    // that "worktree" would wipe the user's project. Detect the match
    // and skip teardown — just flip status.
    const ws = session.workspaceId ? getWorkspace(session.workspaceId) : null;
    const isLive = !!ws && session.worktreePath === ws.cwd;
    if (!isLive) {
      await archiveSessionWorktree({ session, force: args.force ?? false });
    }
  }

  // Archiving the execution cascades to all its chats (docs/executions-spec
  // §5). The worktree lives on the execution, so this is the right unit to
  // archive. Orphaned chats (execution hard-deleted by a workspace delete)
  // have no execution to archive — fall back to archiving the chat itself.
  if (session.executionId) {
    archiveExecution(session.executionId);
  } else {
    archiveChatSession(args.sessionId);
  }

  return getChatSessionWithExecution(args.sessionId);
}
