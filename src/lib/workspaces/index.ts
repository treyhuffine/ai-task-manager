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
import { getWorkDir } from '@/lib/config/paths';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';
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

/** Last N lines of a script's output — enough to surface the real error. */
export function tailLines(text: string, n = 20): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

export interface WorktreeScriptResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
}

/**
 * Run a worktree lifecycle script (setup / teardown) as `sh -lc` in the
 * worktree. Flow stays strategy-agnostic — the project's command decides what
 * happens (install deps, clone caches, migrate, codegen, …). The source
 * checkout and worktree context are exported so scripts can reach the original
 * repo (e.g. `cp -c "$FLOW_SOURCE_CHECKOUT_PATH/node_modules" node_modules`).
 *
 * Returns the result rather than throwing — callers decide whether a failure
 * is fatal (setup) or best-effort (teardown).
 */
export async function runWorktreeScript(opts: {
  command: string;
  worktreePath: string;
  sourceCheckoutPath: string;
  branch?: string;
  /** Generous default — installs can be slow. */
  timeoutMs?: number;
}): Promise<WorktreeScriptResult> {
  // Sanitize like supervised dev servers do — drop Flow's Next worker plumbing
  // (TURBOPACK, PORT, …) and NODE_ENV so the setup command (e.g. `yarn install`)
  // runs in a clean, dev-appropriate env instead of inheriting Flow's server
  // env. The FLOW_* context vars are re-added explicitly (sanitize strips the
  // FLOW_ prefix, then applies these).
  const env = sanitizeChildEnv({
    FLOW_SOURCE_CHECKOUT_PATH: opts.sourceCheckoutPath,
    FLOW_WORKTREE_PATH: opts.worktreePath,
    ...(opts.branch ? { FLOW_BRANCH_NAME: opts.branch } : {}),
  });
  try {
    const { stdout, stderr } = await execFileAsync('sh', ['-lc', opts.command], {
      cwd: opts.worktreePath,
      env,
      timeout: opts.timeoutMs ?? 15 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, exitCode: 0, output: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message || 'script failed';
    return { ok: false, exitCode: typeof e.code === 'number' ? e.code : null, output };
  }
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
 * Default worktree-root layout: `<work-dir>/worktrees/<slug>/`. Worktrees are
 * machine-local git working copies (disposable scratch), so they live in
 * `.work` alongside their sibling `clones`. Stored on the workspace row so the
 * user can override per workspace, but every workspace defaults here so the
 * tree is predictable. Existing worktrees at the legacy `<app-root>/worktrees`
 * stay put (DB references them by absolute path); only new ones land here.
 */
export function defaultWorktreeRoot(slug: string): string {
  return path.join(getWorkDir(), 'worktrees', slug);
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
      // The worktree is "ready" the instant its tracked files are checked out.
      // `filesToCopy` (.env etc.) AND the `setupCommand` (deps) both run in the
      // BACKGROUND afterwards (see `provisionWorktreeForSession`) so chat + the
      // file tree come up immediately; those files appear lazily as they land.
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
 * `ws.baseBranch`, this reuses the branch that survived archive (the lib
 * removes the worktree but, by default, not the branch ref). Preserves
 * git state exactly AND keeps the cwd stable so downstream tools that
 * key off cwd — notably Claude Code, whose transcript dir is
 * `~/.claude/projects/<escape(cwd)>/<sid>.jsonl` — find their existing
 * state without a migration step.
 *
 * Returns `null` to signal "fall back to `createWorktreeForSession`":
 *   - the workspace isn't git,
 *   - the original path is somehow still occupied,
 *   - the `workspace.create` call failed (branch deleted, branch already
 *     checked out elsewhere, etc).
 *
 * Implemented via `lib.workspace.create({ reuseBranch: true })` (added in
 * `@agentex/workspace@0.0.4`): if the branch exists, the lib does
 * `git worktree add <path> <branch>` and re-runs the `fromSource` copy
 * automatically; if it doesn't, the lib falls through to its normal
 * create-new path, which produces a fresh branch at the same path off
 * `ws.baseBranch`. Either outcome lands at the same cwd, which is what
 * matters for Claude transcript discovery.
 */
export async function resumeWorktreeForSession(args: {
  ws: WorkspaceRecord;
  worktreePath: string;
  branch: string;
  baseSha: string;
  sessionId: string;
}): Promise<CreateWorktreeForSessionResult | null> {
  const { ws, worktreePath, branch, sessionId } = args;
  if (!ws.isGit) return null;
  if (existsSync(worktreePath)) return null;
  if (!ws.baseBranch) return null;

  const lib = await loadLib();
  try {
    const handle = await lib.workspace.create({
      kind: 'git',
      source: ws.cwd,
      baseBranch: ws.baseBranch,
      path: worktreePath,
      branch,
      reuseBranch: true,
      // `applyFromSource` defaults true → the lib copies the workspace's
      // configured `fromSource` block automatically. We still drive the
      // app-specific `filesToCopy` (env files) explicitly below for parity
      // with `createWorktreeForSession`.
    });
    if (handle.kind !== 'git') return null;

    // filesToCopy (.env etc.) + the setupCommand both run in the background
    // after the worktree is marked ready (see `provisionWorktreeForSession`) —
    // a recreated worktree is just as fresh as a brand-new one, and we don't
    // block on either.

    return {
      path: handle.path,
      branch: handle.git.branch,
      baseSha: handle.git.baseSha,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[resumeWorktreeForSession] workspace.create failed for session ${sessionId}:`, msg);
    return null;
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
  let handle: import('@agentex/workspace').Workspace;
  try {
    handle = await lib.workspace.open(session.worktreePath, { source: sourceCwd });
  } catch (err) {
    if (err instanceof lib.WorkspaceNotFoundError) return null;
    throw err;
  }

  // Re-anchor the diff base to the LIVE merge-base of HEAD and the base branch,
  // instead of the `baseSha` frozen in the worktree metadata at create time.
  //
  // The frozen value is correct and stable for an isolated feature-branch
  // worktree — its fork point never moves. But a session that runs in-place on
  // a shared branch (e.g. `main`, where the "worktree" IS the source checkout)
  // keeps that same frozen base while HEAD marches forward with every commit
  // that lands on the branch afterward. `diff("base")` / `shortstat("base")`
  // then attribute all of that unrelated history to the session — the phantom
  // "+211k / -8.4k" diff. merge-base(HEAD, base) is the true divergence point:
  // identical to the frozen value for a feature branch, and self-correcting to
  // "just this session's own changes" for an in-place branch. Every consumer
  // (rail stats, in-session diff view, per-file original content) reads
  // `ws.git.baseSha`, so fixing it here fixes all of them at once.
  if (handle.kind === 'git') {
    const liveBase = await resolveLiveBaseSha(session.worktreePath, handle.git.base);
    if (liveBase && liveBase !== handle.git.baseSha) {
      try {
        return await lib.workspace.open(session.worktreePath, {
          source: sourceCwd,
          baseSha: liveBase,
        });
      } catch {
        // Re-open failed unexpectedly — fall back to the handle we already hold
        // (frozen base). Refining the base must never break opening a worktree.
      }
    }
  }
  return handle;
}

/**
 * Live divergence point (merge-base) of the worktree's HEAD and its base
 * branch. Returns null when it can't be computed (no base branch, unresolvable
 * ref, detached HEAD) so the caller keeps the frozen base. Best-effort and
 * read-only — never throws.
 */
async function resolveLiveBaseSha(
  worktreePath: string,
  base: string,
): Promise<string | null> {
  const baseRef = base.trim();
  if (!baseRef) return null;
  try {
    const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', baseRef], {
      cwd: worktreePath,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Tear down a session's worktree. Idempotent — if the path is already gone
 * we treat that as success. Throws on dirty/unpushed unless `force` is set.
 */
export async function archiveSessionWorktree(args: {
  session: WorktreePointer;
  /** Workspace teardown script, run in the worktree before removal (optional). */
  teardownCommand?: string | null;
  /** Source checkout path, exported to the teardown script as $FLOW_SOURCE_CHECKOUT_PATH. */
  sourceCheckoutPath?: string;
  force?: boolean;
}): Promise<void> {
  if (!args.session.worktreePath) return;
  const worktreePath = args.session.worktreePath;

  // Teardown runs while the worktree still exists, and is best-effort: a failing
  // teardown must not block archive (you should always be able to clean up).
  if (args.teardownCommand?.trim()) {
    const res = await runWorktreeScript({
      command: args.teardownCommand,
      worktreePath,
      sourceCheckoutPath: args.sourceCheckoutPath ?? worktreePath,
    });
    if (!res.ok) {
      console.warn(`[workspaces] teardown failed (exit ${res.exitCode ?? 'unknown'}):\n${tailLines(res.output)}`);
    }
  }

  const lib = await loadLib();
  try {
    await lib.workspace.archive(worktreePath, { force: args.force ?? false });
  } catch (err) {
    if (err instanceof lib.WorkspaceNotFoundError) return;
    throw err;
  }
}
