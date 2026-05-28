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

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import slugify from '@sindresorhus/slugify';
import { getAppRoot } from '@/lib/config/paths';
import { expandFilesToCopyPatterns } from '@/lib/workspaces/files-to-copy';
import type { WorkspaceRecord } from '@/db/types';

const execFileAsync = promisify(execFile);

/**
 * Minimal structural shape for "something that points at a worktree on
 * disk." Worktree path lives on the execution now, surfaced flattened by
 * `getChatSessionWithExecution`; these helpers only need that one field,
 * so we accept it structurally rather than coupling to a full row type.
 */
export interface WorktreePointer {
  worktreePath: string | null;
}

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

/**
 * 6 hex chars from the UUIDv7's random `rand_b` portion (chars 24–29 in
 * the canonical 8-4-4-4-12 layout). Skipping the timestamp prefix means
 * sessions created in the same millisecond don't share a suffix; 24 bits
 * of entropy is plenty for collision avoidance across one workspace's
 * worktree set, and the retry loop in createWorktreeForSession catches
 * the astronomically rare collision anyway.
 */
export function worktreeIdSuffix(sessionId: string): string {
  return sessionId.slice(24, 30);
}

/**
 * Worktree directory leaf: `<workspace-slug>-<6hex>`. The workspace prefix
 * makes the leaf self-describing in surfaces that only show the dirname
 * (IDE tabs, Finder, terminal prompt) without depending on the parent
 * directory for context.
 */
export function buildWorktreeLeaf(slug: string, sessionId: string): string {
  return `${slug}-${worktreeIdSuffix(sessionId)}`;
}

export interface CreateWorktreeForSessionResult {
  path: string;
  branch: string;
  baseSha: string;
}

export interface FetchPrHeadResult {
  /** Local ref the PR head was written to (deterministic: `refs/agentex/pr/<N>`). */
  ref: string;
  /** SHA the PR head resolved to at fetch time. */
  sha: string;
}

/**
 * Fetch a GitHub PR's head into a stable local ref and return the SHA.
 *
 * Uses GitHub's `refs/pull/<N>/head` mirror, which exists on the upstream
 * remote for every PR — same-repo, fork, open, closed, merged. That's the
 * one universal handle for "the current head of PR #N" that doesn't depend
 * on the user having checked the branch out locally.
 *
 * The fetch writes into `refs/agentex/pr/<N>` (not `FETCH_HEAD`) so it's
 * atomic across concurrent calls and safe to pass as a commit-ish to
 * downstream worktree operations.
 */
export async function fetchPrHead(args: {
  ws: WorkspaceRecord;
  prNumber: number;
}): Promise<FetchPrHeadResult> {
  const { ws, prNumber } = args;
  if (!ws.isGit) throw new Error('fetchPrHead called on non-git workspace');
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`fetchPrHead: invalid prNumber ${prNumber}`);
  }
  const remote = ws.remoteName ?? 'origin';
  const localRef = `refs/agentex/pr/${prNumber}`;
  // `+` is the force-fetch prefix — overwrites the local ref even if the PR
  // history was rewritten. Without it, a force-push to the PR would make
  // subsequent fetches fail with "non-fast-forward."
  const refspec = `+refs/pull/${prNumber}/head:${localRef}`;
  await execFileAsync('git', ['fetch', remote, refspec], { cwd: ws.cwd });
  const { stdout } = await execFileAsync('git', ['rev-parse', localRef], { cwd: ws.cwd });
  return { ref: localRef, sha: stdout.trim() };
}

/**
 * Refresh the remote-tracking ref for `baseBranch` and return the ref
 * to base the new worktree on. Touches only `refs/remotes/<remote>/...`
 * — never the user's local branch or working tree — so inflight work
 * in the source repo is unaffected.
 *
 * On fetch failure (offline, no remote configured, network error) we
 * fall back to the local branch name so worktree creation still
 * succeeds. The caller logs a warning; the worktree may end up behind.
 */
async function refreshBaseFromRemote(args: {
  ws: WorkspaceRecord;
  baseBranch: string;
}): Promise<{ ref: string; fetched: boolean; warning: string | null }> {
  const { ws, baseBranch } = args;
  const remote = ws.remoteName ?? 'origin';
  // Strip an existing `<remote>/` prefix so we send a clean upstream
  // branch name to `git fetch`.
  const remoteSlashed = `${remote}/`;
  const branchName = baseBranch.startsWith(remoteSlashed)
    ? baseBranch.slice(remoteSlashed.length)
    : baseBranch;
  // `+src:dst` force-updates the remote-tracking ref so a force-push
  // upstream doesn't make subsequent fetches fail with "non-fast-forward."
  const refspec = `+refs/heads/${branchName}:refs/remotes/${remote}/${branchName}`;
  try {
    await execFileAsync('git', ['fetch', remote, refspec], { cwd: ws.cwd });
    return { ref: `${remote}/${branchName}`, fetched: true, warning: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ref: branchName,
      fetched: false,
      warning: `Could not fetch ${remote}/${branchName}; using local branch (may be behind): ${msg}`,
    };
  }
}

/**
 * Create a git worktree for a new execution session. Branch name is
 * `<workspace.slug>/<session-slug>` with `-2`, `-3`, ... suffixes when the
 * branch already exists. Worktree path uses the session id (not the slug)
 * so two sessions sharing a label can't collide on disk.
 *
 * When no `baseBranchOverride` is provided (the default "+" flow), we
 * first fetch the workspace's base branch from the configured remote and
 * root the worktree at the remote-tracking ref, so it always starts at
 * the latest upstream commit regardless of how stale the user's local
 * branch is. The override path (PR head, picked remote branch) skips the
 * fetch — the caller already resolved the exact ref they want.
 */
export async function createWorktreeForSession(args: {
  ws: WorkspaceRecord;
  sessionId: string;
  sessionLabel: string | null | undefined;
  /** Override the workspace's default base branch — used by "Create from"
   *  flows where the user picks an existing PR head, branch, or issue
   *  base. Falls back to `ws.baseBranch` when omitted. */
  baseBranchOverride?: string | null;
}): Promise<CreateWorktreeForSessionResult> {
  const { ws, sessionId, sessionLabel, baseBranchOverride } = args;
  if (!ws.isGit) {
    throw new Error('createWorktreeForSession called on non-git workspace');
  }
  const trimmedOverride = baseBranchOverride?.trim();
  const requestedBase = trimmedOverride || ws.baseBranch;
  if (!requestedBase) {
    throw new Error(`Workspace ${ws.slug} has no baseBranch`);
  }
  // Only refresh from remote on the default "+" path. When the caller
  // passed an explicit override we trust it as-is — for PRs that's the
  // already-fetched `refs/agentex/pr/<N>` ref, for "Create from branch"
  // it's a remote-tracking branch the user explicitly picked.
  let baseBranch = requestedBase;
  if (!trimmedOverride) {
    const refreshed = await refreshBaseFromRemote({ ws, baseBranch: requestedBase });
    baseBranch = refreshed.ref;
    if (refreshed.warning) {
      console.warn(`[workspaces] ${refreshed.warning}`);
    }
  }
  const lib = await loadLib();
  const root = ws.worktreeRoot ?? defaultWorktreeRoot(ws.slug);
  // Worktree leaf is `<workspace-slug>-<6hex>` so the dirname carries
  // context in IDE tabs / Finder where you only see the leaf. The 6 hex
  // chars come from the UUIDv7's random portion (not the timestamp
  // prefix) so burst-created sessions don't share a suffix. The full
  // session id remains the DB primary key — this is purely a handle.
  const worktreeLeafBase = buildWorktreeLeaf(ws.slug, sessionId);
  const labelSlug = deriveSessionLabelSlug(sessionLabel, sessionId);
  const baseBranchName = `${ws.slug}/${labelSlug}`;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const branch = attempt === 1 ? baseBranchName : `${baseBranchName}-${attempt}`;
    const worktreeLeaf = attempt === 1 ? worktreeLeafBase : `${worktreeLeafBase}-${attempt}`;
    const worktreePath = path.join(root, worktreeLeaf);
    if (existsSync(worktreePath)) continue;
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
      const expanded = expandFilesToCopyPatterns(ws.filesToCopy ?? []);
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
 * Resume an archived session by recreating its worktree at the *original*
 * path with the *original* branch checked out. Companion to
 * `createWorktreeForSession`: rather than spawning a fresh branch off
 * `ws.baseBranch`, this checks out the branch that survived archive (the
 * lib removes the worktree but not the branch ref). Preserves git state
 * exactly AND keeps the cwd stable so downstream tools that key off it —
 * notably Claude Code, whose transcript dir is
 * `~/.claude/projects/<escape(cwd)>/<sid>.jsonl` — find their existing
 * state without a migration step.
 *
 * Returns `null` to signal "fall back to `createWorktreeForSession`":
 *   - the workspace isn't git,
 *   - the worktree path is somehow still occupied (no clean reuse),
 *   - the branch ref was deleted out-of-band,
 *   - the `git worktree add` itself failed.
 *
 * Why shell `git worktree add` directly: `@agentex/workspace.create`
 * always uses `-b <branch>` so it can only *create* branches, never check
 * out existing ones. Adding a `reuseBranch?: boolean` option upstream is
 * the right cleanup; this is the bridge until then.
 */
export async function resumeWorktreeForSession(args: {
  ws: WorkspaceRecord;
  worktreePath: string;
  branch: string;
  baseSha: string;
  sessionId: string;
}): Promise<CreateWorktreeForSessionResult | null> {
  const { ws, worktreePath, branch, baseSha, sessionId } = args;
  if (!ws.isGit) return null;
  if (existsSync(worktreePath)) return null;

  if (!(await branchExistsLocally(ws.cwd, branch))) return null;

  try {
    await execFileAsync('git', ['worktree', 'add', worktreePath, branch], { cwd: ws.cwd });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[resumeWorktreeForSession] git worktree add failed for session ${sessionId}:`, msg);
    return null;
  }

  // Hydrate a handle so we can re-copy env files via the lib's
  // `copyFromSource` (parity with the initial-create path). `open()` needs
  // either the metadata file the lib's `create()` wrote (which still
  // exists from the original session — it lives in the worktree itself,
  // gone now) or explicit baseBranch / baseSha. We pass the latter.
  const lib = await loadLib();
  try {
    const handle = await lib.workspace.open(worktreePath, {
      source: ws.cwd,
      baseBranch: ws.baseBranch ?? branch,
      baseSha,
    });
    const expanded = expandFilesToCopyPatterns(ws.filesToCopy ?? []);
    if (expanded.length > 0) {
      try {
        await handle.copyFromSource(expanded);
      } catch (copyErr) {
        console.error(
          `[resumeWorktreeForSession] copyFromSource failed for session ${sessionId}:`,
          copyErr,
        );
      }
    }
  } catch (err) {
    // Env-file copy is best-effort. If open / copyFromSource fail, the
    // worktree still exists with the checked-out branch — the agent can
    // still operate. Log and move on.
    console.warn(`[resumeWorktreeForSession] handle hydration failed for session ${sessionId}:`, err);
  }

  return { path: worktreePath, branch, baseSha };
}

/**
 * `git show-ref --verify --quiet refs/heads/<branch>` — returns true if a
 * local branch by that name exists in `repoCwd`, false otherwise.
 */
async function branchExistsLocally(repoCwd: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      { cwd: repoCwd },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * List remote-tracking branches in a workspace. Used by the "Create
 * from → Branch" flow. Strips the `origin/HEAD -> origin/main` symbolic
 * ref entry that's noise in a picker.
 */
export async function listWorkspaceBranches(ws: WorkspaceRecord): Promise<string[]> {
  if (!ws.isGit) return [];
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
  session: WorktreePointer,
  sourceCwd: string,
): Promise<import('@agentex/workspace').Workspace | null> {
  if (!session.worktreePath) return null;
  const lib = await loadLib();
  try {
    return await lib.workspace.open(session.worktreePath, { source: sourceCwd });
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
  session: WorktreePointer;
  force?: boolean;
}): Promise<void> {
  if (!args.session.worktreePath) return;
  const lib = await loadLib();
  try {
    await lib.workspace.archive(args.session.worktreePath, { force: args.force ?? false });
  } catch (err) {
    if (err instanceof lib.WorkspaceNotFoundError) return;
    throw err;
  }
}
