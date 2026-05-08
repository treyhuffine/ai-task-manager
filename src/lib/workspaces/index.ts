/**
 * Composition layer over `@agentex/workspace`. The library handles every
 * git-level primitive (worktree add/remove, structured diff, checkpoints,
 * fromSource); these helpers just encode our naming rules + DB persistence
 * around the library calls.
 *
 * The library is loaded via dynamic `import()` because its package.json
 * exports only the ESM `"import"` condition. Static imports fail in CJS
 * resolution paths (the orchestrator CLI dispatched via tsx). Same trick
 * `src/cli/commands/skills.ts` uses for `@agentex/agent`.
 */

import path from 'node:path';
import slugify from '@sindresorhus/slugify';
import { getAppRoot } from '@/lib/config/paths';
import { expandFilesToCopyPatterns } from '@/lib/workspaces/files-to-copy';
import type { WorkspaceRecord, ChatSessionRecord } from '@/db/types';

// Cached lazy-loaded module. The library has no side effects on import,
// so caching the resolved namespace avoids repeated dynamic-import overhead.
type AgentexWorkspace = typeof import('@agentex/workspace');
let cached: AgentexWorkspace | null = null;
async function loadLib(): Promise<AgentexWorkspace> {
  if (cached) return cached;
  cached = await import('@agentex/workspace');
  return cached;
}

/**
 * Default worktree-root layout: `<app-root>/worktrees/<slug>/`. Stored on
 * the workspace row so the user can override per workspace, but every
 * workspace defaults here so the tree is predictable.
 */
export function defaultWorktreeRoot(slug: string): string {
  return path.join(getAppRoot(), 'worktrees', slug);
}

export async function detectIsGit(absolutePath: string): Promise<boolean> {
  try {
    const lib = await loadLib();
    const kind = await lib.workspace.detectKind(absolutePath);
    return kind === 'git';
  } catch {
    return false;
  }
}

/**
 * Try to detect the default branch via `<remote>/HEAD`, falling back to
 * `main` then `master`. Returns null if the path isn't a git repo or none
 * of the candidates resolve.
 */
export async function detectBaseBranch(absolutePath: string, remote = 'origin'): Promise<string | null> {
  try {
    const lib = await loadLib();
    return await lib.workspace.detectDefaultBranch(absolutePath, remote);
  } catch {
    return null;
  }
}

/**
 * Slug for the session-label half of a branch name. Prefixed with the
 * workspace slug at call time: `<workspace.slug>/<session-slug>`.
 */
export function deriveSessionLabelSlug(label: string | null | undefined, sessionId: string): string {
  const slug = label ? slugify(label) : '';
  if (slug) return slug;
  return `session-${sessionId.slice(0, 8)}`;
}

export interface CreateWorktreeForSessionResult {
  path: string;
  branch: string;
  baseSha: string;
}

/**
 * Create a git worktree for a new execution session. Branch name is
 * `<workspace.slug>/<session-slug>` with `-2`, `-3`, ... suffixes when the
 * branch already exists. Worktree path uses the session id (not the slug)
 * so two sessions sharing a label can't collide on disk.
 */
export async function createWorktreeForSession(args: {
  ws: WorkspaceRecord;
  sessionId: string;
  sessionLabel: string | null | undefined;
  /** Override the workspace's default base branch — used by "Create from"
   *  flows where the user picks an existing PR head, branch, or issue
   *  base. Falls back to `ws.base_branch` when omitted. */
  baseBranchOverride?: string | null;
}): Promise<CreateWorktreeForSessionResult> {
  const { ws, sessionId, sessionLabel, baseBranchOverride } = args;
  if (!ws.is_git) {
    throw new Error('createWorktreeForSession called on non-git workspace');
  }
  const baseBranch = baseBranchOverride?.trim() || ws.base_branch;
  if (!baseBranch) {
    throw new Error(`Workspace ${ws.slug} has no base_branch`);
  }
  const lib = await loadLib();
  const root = ws.worktree_root ?? defaultWorktreeRoot(ws.slug);
  // Use the full session id for the worktree dirname. uuidv7's first 8
  // chars are only the upper 32 bits of the millisecond timestamp, which
  // means two sessions created within ~65 seconds collide on the prefix.
  // The full uuid is unambiguous; the dirname is for git, not humans.
  const worktreePath = path.join(root, sessionId);
  const labelSlug = deriveSessionLabelSlug(sessionLabel, sessionId);
  const baseBranchName = `${ws.slug}/${labelSlug}`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const branch = attempt === 1 ? baseBranchName : `${baseBranchName}-${attempt}`;
    try {
      const handle = await lib.workspace.create({
        kind: 'git',
        source: ws.cwd,
        baseBranch,
        path: worktreePath,
        branch,
      });
      if (handle.kind !== 'git') {
        throw new Error('Expected git workspace handle');
      }
      // Copy user-configured files (default `.env*`) into the new worktree
      // so secrets / local configs travel with the session. Failures here
      // shouldn't kill the worktree — log and continue; the user can re-
      // run a copy from settings later.
      const expanded = expandFilesToCopyPatterns(ws.files_to_copy ?? []);
      if (expanded.length > 0) {
        try {
          await handle.copyFromSource(expanded);
        } catch (copyErr) {
          console.error(
            `[workspaces] copyFromSource failed for session ${sessionId}:`,
            copyErr,
          );
        }
      }
      return {
        path: handle.path,
        branch: handle.git.branch,
        baseSha: handle.git.baseSha,
      };
    } catch (err) {
      if (err instanceof lib.BranchExistsError) continue;
      throw err;
    }
  }
  throw new Error(`Could not allocate a unique branch from ${baseBranchName}`);
}

/**
 * List remote-tracking branches in a workspace. Used by the "Create
 * from → Branch" flow. Strips the `origin/HEAD -> origin/main` symbolic
 * ref entry that's noise in a picker.
 */
export async function listWorkspaceBranches(ws: WorkspaceRecord): Promise<string[]> {
  if (!ws.is_git) return [];
  const lib = await loadLib();
  try {
    const result = await lib.workspace.open(ws.cwd);
    if (result.kind !== 'git') return [];
    const raw = await result.git.raw([
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/remotes/',
    ]);
    return raw.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // Drop the symbolic HEAD pointer (e.g., "origin/HEAD") — a duplicate
      // of whatever main is.
      .filter((line) => !line.endsWith('/HEAD'));
  } catch (err) {
    console.error('[workspaces] listWorkspaceBranches failed:', err);
    return [];
  }
}

/**
 * Re-open an existing worktree for diff stats / status. Returns null if
 * the worktree path no longer exists on disk (multi-device, user deleted).
 */
export async function openWorktreeHandle(
  session: ChatSessionRecord,
  sourceCwd: string,
): Promise<import('@agentex/workspace').Workspace | null> {
  if (!session.worktree_path) return null;
  const lib = await loadLib();
  try {
    return await lib.workspace.open(session.worktree_path, { source: sourceCwd });
  } catch (err) {
    if (err instanceof lib.WorkspaceNotFoundError) return null;
    throw err;
  }
}

/**
 * Tear down a session's worktree. Idempotent — if the path is already gone
 * we treat that as success. Throws on dirty/unpushed unless `force` is set.
 */
export async function archiveSessionWorktree(args: {
  session: ChatSessionRecord;
  force?: boolean;
}): Promise<void> {
  if (!args.session.worktree_path) return;
  const lib = await loadLib();
  try {
    await lib.workspace.archive(args.session.worktree_path, { force: args.force ?? false });
  } catch (err) {
    if (err instanceof lib.WorkspaceNotFoundError) return;
    throw err;
  }
}
