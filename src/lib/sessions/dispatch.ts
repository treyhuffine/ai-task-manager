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

import { uuidv7 } from 'uuidv7';
import {
  getWorkspace,
  createChatSession,
  archiveChatSession,
  getChatSession,
  updateChatSession,
  getOrCreateDefaultExecutor,
} from '@/lib/db/queries';
import { createWorktreeForSession, archiveSessionWorktree } from '@/lib/workspaces';
import type { ChatSessionRecord, WorkspaceRecord } from '@/db/types';

export interface DispatchExecutionSessionArgs {
  workspaceId: string;
  /** Optional. If null/empty, the row is created with `label = null` and
   *  the branch falls back to `<workspace>/session-<short-id>`. The
   *  label is later derived from the first user message. */
  label?: string | null;
  harness?: string;
  /** Override the workspace's default base branch. Used by "Create
   *  from" — pass the head ref of a PR, the name of a branch the user
   *  picked, or the workspace's default branch for an issue-based
   *  session. Falls back to `workspace.base_branch` when null/empty. */
  baseBranch?: string | null;
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
 * the background; the row's `worktree_path`, `branch_name`, and
 * `base_sha` start null and update once `git worktree add` completes.
 * The UI polls the session and renders a "setting up" state until those
 * fields populate (~2-5s for fast machines, longer for big repos).
 *
 * For non-git workspaces, no worktree is provisioned — the agent runs
 * in `workspace.cwd` directly. The row is "ready" immediately.
 *
 * Failure mode: if worktree provisioning throws, we log and leave the
 * row in its pending state. The user can archive and retry. (We could
 * persist a setup_error column for richer UX; deferred until this
 * actually bites.)
 */
export async function dispatchExecutionSession(
  args: DispatchExecutionSessionArgs,
): Promise<ChatSessionRecord> {
  const ws = getWorkspace(args.workspaceId);
  if (!ws) throw new WorkspaceNotFoundForDispatch(args.workspaceId);

  const agent = getOrCreateDefaultExecutor(args.harness ?? 'claude_code');
  const sessionId = uuidv7();
  const label = args.label?.trim() || null;

  // Insert immediately — null worktree fields. Caller's API responds to
  // the client in ~10ms and the rail can navigate. Setup runs async.
  // `label` may be null at this point; the first user message will
  // derive it (see /api/sessions/[id]/messages).
  const session = createChatSession({
    id: sessionId,
    agent_id: agent.id,
    type: 'execution',
    workspace_id: args.workspaceId,
    label,
    refs: {},
    worktree_path: null,
    branch_name: null,
    base_sha: null,
  });

  if (ws.is_git) {
    // Fire-and-forget. The promise resolves into the void; we log on
    // rejection so the failure isn't fully silent. The UI's polling
    // catches the row update on success.
    void provisionWorktreeForSession(ws, sessionId, label, args.baseBranch ?? null);
  }

  return session;
}

/**
 * Background worktree creation for a freshly-inserted session row.
 * Updates `chat_sessions` with the worktree's path, branch, and base
 * SHA when the library finishes. Errors are logged; the row stays in
 * its pending state and the UI keeps showing "setting up" until the
 * user archives or the next process restart.
 */
async function provisionWorktreeForSession(
  ws: WorkspaceRecord,
  sessionId: string,
  label: string | null,
  baseBranchOverride: string | null,
): Promise<void> {
  try {
    const worktree = await createWorktreeForSession({
      ws,
      sessionId,
      sessionLabel: label,
      baseBranchOverride,
    });
    updateChatSession(sessionId, {
      worktree_path: worktree.path,
      branch_name: worktree.branch,
      base_sha: worktree.baseSha,
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[dispatch] worktree provisioning failed for ${sessionId}:`, msg);
  }
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
): Promise<ChatSessionRecord | null> {
  const session = getChatSession(args.sessionId);
  if (!session) return null;

  // Workspace lookup is best-effort — a workspace can be deleted out from
  // under sessions, but we still want to be able to archive the row.
  if (session.worktree_path) {
    await archiveSessionWorktree({ session, force: args.force ?? false });
  }

  return archiveChatSession(args.sessionId);
}
