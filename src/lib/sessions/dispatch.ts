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
  listChatSessions,
  createExecutionWithChat,
  markExecutionSetupStarted,
  markExecutionSetupComplete,
  recordExecutionSetupError,
  resetExecutionForReprovision,
  archiveExecution,
  unarchiveExecution,
  getOrCreateDefaultExecutor,
} from '@/lib/db/queries';
import {
  createWorktreeForSession,
  resumeWorktreeForSession,
  archiveSessionWorktree,
  fetchPrHead,
} from '@/lib/workspaces';
import { killAllForSession } from '@/lib/terminal/pty-manager';
import { invalidateAgentSession } from '@/lib/executor/adapter';
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

export interface ProvisionArgs {
  ws: WorkspaceRecord;
  /** The execution whose worktree state these results are written to. */
  executionId: string;
  /** The initiating chat's id — still used to derive the worktree leaf /
   *  branch suffix. Cosmetic; the artifact is recorded on the execution. */
  sessionId: string;
  label: string | null;
  baseBranchOverride: string | null;
  prNumber: number | null;
  /**
   * Resume context. When present and the original branch still exists, we
   * recreate the worktree at the *original* path with the *original*
   * branch checked out — preserves git state and keeps Claude's
   * cwd-derived transcript dir valid so `--resume <sid>` finds the
   * existing JSONL. Falls through to fresh `createWorktreeForSession` if
   * the resume path isn't usable (branch deleted out-of-band, etc).
   */
  resume?: {
    worktreePath: string;
    branch: string;
    baseSha: string;
  };
}

/**
 * Background worktree creation for an execution. Two modes:
 *
 * 1. Fresh (default): `createWorktreeForSession` provisions a new worktree
 *    off `ws.baseBranch` with a new branch. Used by initial dispatch and
 *    `retryProvisionWorktree`.
 *
 * 2. Resume (`args.resume` set): `resumeWorktreeForSession` checks out
 *    the original branch at the original path. Used by
 *    `continueExecutionSession`. If the branch was deleted out-of-band,
 *    falls through to fresh-create automatically.
 *
 * Either way, writes the worktree's path / branch / baseSha onto the
 * execution when finished (via `markExecutionSetupComplete`). On failure,
 * records the message on the execution's `setupError` so the UI can
 * render the failure and offer a Pull/retry button.
 *
 * When `prNumber` is set (fresh mode only), fetches `refs/pull/<N>/head`
 * first and passes that ref as the base — works for same-repo and fork
 * PRs alike. Resume mode ignores `prNumber` since we're checking out an
 * existing branch.
 */
export async function provisionWorktreeForSession(args: ProvisionArgs): Promise<void> {
  const { ws, executionId, sessionId, label, baseBranchOverride, prNumber, resume } = args;
  try {
    let worktree: { path: string; branch: string; baseSha: string } | null = null;

    if (resume) {
      worktree = await resumeWorktreeForSession({
        ws,
        worktreePath: resume.worktreePath,
        branch: resume.branch,
        baseSha: resume.baseSha,
        sessionId,
      });
      // `resumeWorktreeForSession` returns null when the resume path isn't
      // usable (branch was deleted, path was somehow taken, etc.). In that
      // case we fall through to the fresh-create path below — the user
      // still gets a working worktree, just not at the original path /
      // branch. Claude's transcript will be invisible to the fresh CLI
      // session in that case (different cwd → different project dir).
    }

    if (!worktree) {
      let baseRef = baseBranchOverride;
      if (prNumber !== null) {
        const fetched = await fetchPrHead({ ws, prNumber });
        baseRef = fetched.ref;
      }
      worktree = await createWorktreeForSession({
        ws,
        sessionId,
        sessionLabel: label,
        baseBranchOverride: baseRef,
      });
    }

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

  // Reap any PTYs that belonged to this execution's chats. Terminals are
  // keyed by chat-session id, and archiving an execution cascades to every
  // chat under it (takeover chats included) — so enumerate the execution's
  // chats and kill each one's terminals. Without this, node-pty processes
  // leak until the server restarts. killAllForSession is a no-op for ids
  // with no live terminals, so the orphan-chat fallback is safe too.
  const reapSessionIds = session.executionId
    ? listChatSessions({ executionId: session.executionId }).map((s) => s.id)
    : [args.sessionId];
  for (const sessionId of reapSessionIds) killAllForSession(sessionId);

  return getChatSessionWithExecution(args.sessionId);
}

export interface ContinueExecutionSessionArgs {
  sessionId: string;
  /**
   * Override the base for the fresh worktree. Defaults to `ws.baseBranch`
   * — i.e. branch off the current workspace base (usually `main`), which
   * is the right behavior for the "PR was merged, original branch was
   * deleted" case. Pass an explicit ref to resurrect a different starting
   * point (e.g. an unmerged feature branch the user is still iterating on).
   */
  baseBranchOverride?: string | null;
}

/**
 * Re-engage an archived execution on disk: unarchive the row and recreate
 * the worktree at the *original* path with the *original* branch checked
 * out. Fire-and-forget on the worktree side; the UI's existing setting-up
 * state covers the wait until provisioning finishes.
 *
 * Why same-path + same-branch: Claude Code's transcript dir is
 * `~/.claude/projects/<escape(cwd)>/<sid>.jsonl`. If the new worktree
 * lands at a different path (because the branch ref survived archive and
 * collided with the create-fresh attempt), Claude's resume looks in the
 * wrong project dir and the existing JSONL is invisible. Reusing the
 * branch in-place keeps everything coherent: same cwd → same project dir
 * → `claude --resume <sid>` finds the existing transcript → conversation
 * continues without loss.
 *
 * If the original branch was deleted out-of-band (manual `git branch -D`
 * or similar), `resumeWorktreeForSession` returns null and we fall back
 * to creating a fresh worktree off `ws.baseBranch`. The chat history is
 * preserved in the DB transcript either way; only Claude's working memory
 * is lost in the fallback case.
 */
export async function continueExecutionSession(
  args: ContinueExecutionSessionArgs,
): Promise<ChatSessionWithExecution | null> {
  const session = getChatSessionWithExecution(args.sessionId);
  if (!session) return null;
  // No execution = chat-only (orchestration/content) — nothing to provision.
  if (!session.executionId) return session;
  const ws = session.workspaceId ? getWorkspace(session.workspaceId) : null;
  // Non-git workspaces never had a worktree to recreate; just unarchive.
  if (!ws || !ws.isGit) {
    if (session.status === 'archived') unarchiveExecution(session.executionId);
    return getChatSessionWithExecution(args.sessionId);
  }
  // Live-mode sessions never tore down their "worktree" (it's ws.cwd) so
  // there's nothing to re-provision. Treat Continue as a plain unarchive.
  const isLive = session.worktreePath != null && session.worktreePath === ws.cwd;

  if (session.status === 'archived') {
    unarchiveExecution(session.executionId);
  }

  if (!isLive) {
    // Capture the worktree identity BEFORE we null it on the row — the
    // provisioner uses this to recreate at the same path with the same
    // branch (same-path resume is what makes Claude's `--resume` work).
    const resumeContext =
      session.worktreePath && session.branchName && session.baseSha
        ? {
            worktreePath: session.worktreePath,
            branch: session.branchName,
            baseSha: session.baseSha,
          }
        : undefined;

    // Stale `worktreePath` survives archive (we deleted the directory but
    // kept the column for the archived view to show "this session was on
    // branch X"). Null it now so the row reads as "setting up" and the
    // background provisioner doesn't early-return thinking it's already
    // done.
    resetExecutionForReprovision(session.executionId);
    // Drop any in-process executor handle for this chat. The cached
    // `AgentSession` is keyed by chat id and may still hold a reference to
    // a subprocess that died (or worse, is hanging) when its worktree was
    // pulled out from under it. `invalidateAgentSession` is cheap and
    // guarantees the next dispatch goes through the fresh-spawn path.
    invalidateAgentSession(args.sessionId);

    void provisionWorktreeForSession({
      ws,
      executionId: session.executionId,
      sessionId: args.sessionId,
      label: session.label,
      baseBranchOverride: args.baseBranchOverride ?? null,
      // `prNumber` intentionally null — Continue defaults to a fresh base.
      // Resurrecting the original PR head is a future-option toggle.
      prNumber: null,
      resume: resumeContext,
    });
  }

  return getChatSessionWithExecution(args.sessionId);
}
