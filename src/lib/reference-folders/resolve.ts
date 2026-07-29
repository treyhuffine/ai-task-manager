/**
 * Resolution for reference folders (docs/reference-folders-spec.md §5).
 *
 * A reference row stores either a bare path or a target workspace. This layer
 * turns that into a real absolute path plus whatever the filesystem says about
 * it right now: does it exist, and if it's a git repo, what branch is it on and
 * how stale is it.
 *
 * The git line matters more than it looks. The quiet failure mode of this whole
 * feature is pointing at a checkout that has been sitting on a three-week-old
 * feature branch, where the agent reads the wrong code with total confidence.
 * Surfacing branch and drift lets it notice instead of trusting.
 *
 * Nothing here resolves dynamically to a live worktree or branch. A reference
 * points at a folder and the agent gets whatever is in that folder. If you want
 * an in-progress worktree, add that worktree's path as its own reference.
 */

import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getWorkspace, listReferenceFoldersForWorkspace } from '@/lib/db/queries';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';
import type {
  ReferenceFolderRecord,
  ReferenceFolderGitState,
  ResolvedReferenceFolder,
} from '@/db/types';

const execFileAsync = promisify(execFile);

/**
 * Git probes shell out, and a session build resolves every reference at once,
 * so the same folder can be asked about several times in a few milliseconds.
 * A short TTL collapses that without ever holding state long enough to show a
 * stale branch in the UI.
 */
const GIT_CACHE_TTL_MS = 5_000;
const gitCache = new Map<string, { at: number; state: ReferenceFolderGitState | null }>();

/** Bounded so a hung or enormous repo can't stall a session spawn. */
const GIT_TIMEOUT_MS = 2_000;

/** Test seam — resolution is filesystem-dependent and caching hides edits. */
export function clearReferenceFolderGitCache(): void {
  gitCache.clear();
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      env: sanitizeChildEnv(),
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Best-effort git state. Returns null for anything that isn't a git work tree,
 * which is a perfectly normal reference (a docs folder, a notes vault).
 */
export async function probeGitState(absolutePath: string): Promise<ReferenceFolderGitState | null> {
  const cached = gitCache.get(absolutePath);
  if (cached && Date.now() - cached.at < GIT_CACHE_TTL_MS) return cached.state;

  const state = await probeGitStateUncached(absolutePath);
  gitCache.set(absolutePath, { at: Date.now(), state });
  return state;
}

async function probeGitStateUncached(
  absolutePath: string,
): Promise<ReferenceFolderGitState | null> {
  const inWorkTree = await git(absolutePath, ['rev-parse', '--is-inside-work-tree']);
  if (inWorkTree !== 'true') return null;

  // Detached HEAD returns "HEAD" from --abbrev-ref, which is not a branch name.
  const rawBranch = await git(absolutePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = !rawBranch || rawBranch === 'HEAD' ? null : rawBranch;

  const porcelain = await git(absolutePath, ['status', '--porcelain']);
  const dirty = porcelain != null && porcelain.length > 0;

  // No upstream is common for reference folders (a shallow clone, a local-only
  // vault). Leave ahead/behind null rather than implying zero drift.
  let ahead: number | null = null;
  let behind: number | null = null;
  const counts = await git(absolutePath, [
    'rev-list',
    '--left-right',
    '--count',
    '@{upstream}...HEAD',
  ]);
  if (counts) {
    const [behindRaw, aheadRaw] = counts.split(/\s+/);
    const b = Number.parseInt(behindRaw ?? '', 10);
    const a = Number.parseInt(aheadRaw ?? '', 10);
    if (Number.isFinite(b)) behind = b;
    if (Number.isFinite(a)) ahead = a;
  }

  return { branch, dirty, ahead, behind };
}

/**
 * Absolute path for a reference row, or null when the target workspace has
 * vanished. Pure: no filesystem or git access, so callers that only need the
 * path (the `@` picker, the settings list) don't pay for a probe.
 */
export function referenceFolderPath(ref: ReferenceFolderRecord): string | null {
  if (ref.path) return path.resolve(ref.path);
  if (!ref.targetWorkspaceId) return null;
  // Archived target workspaces still resolve. Archiving a workspace is a
  // statement about the rail, not about whether its folder is readable.
  const ws = getWorkspace(ref.targetWorkspaceId);
  return ws?.cwd ? path.resolve(ws.cwd) : null;
}

function isDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

/** True when `child` sits at or inside `parent`. */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve one reference. `exists` is false for a missing path *and* for a path
 * that turned out to be a file rather than a folder, since neither is
 * something the agent can be pointed at.
 */
export async function resolveReferenceFolder(
  ref: ReferenceFolderRecord,
  options: { consumerCwd?: string | null; probeGit?: boolean } = {},
): Promise<ResolvedReferenceFolder | null> {
  const absolutePath = referenceFolderPath(ref);
  if (!absolutePath) return null;

  const exists = existsSync(absolutePath) && isDirectory(absolutePath);
  const git =
    exists && options.probeGit !== false ? await probeGitState(absolutePath) : null;

  return {
    ...ref,
    absolutePath,
    exists,
    git,
    global: ref.workspaceId === null,
    redundantWithCwd: options.consumerCwd
      ? isWithin(path.resolve(options.consumerCwd), absolutePath)
      : false,
  };
}

/**
 * Every reference a workspace's agents can see, resolved. Global rows are
 * included, with the workspace's own row winning on alias collision (handled
 * in `listReferenceFoldersForWorkspace`).
 *
 * Rows whose target workspace has been deleted resolve to null and are dropped
 * entirely — there is nothing to show or point at.
 */
export async function listResolvedReferenceFolders(
  workspaceId: string | null,
  options: { consumerCwd?: string | null; probeGit?: boolean } = {},
): Promise<ResolvedReferenceFolder[]> {
  const rows = listReferenceFoldersForWorkspace(workspaceId);
  const resolved = await Promise.all(rows.map((r) => resolveReferenceFolder(r, options)));
  return resolved.filter((r): r is ResolvedReferenceFolder => r !== null);
}

/**
 * The subset an agent should actually be told about: resolvable and present on
 * disk. A broken reference stays visible in settings so the user can fix it,
 * but pointing an agent at a path that isn't there is worse than silence.
 */
export async function listUsableReferenceFolders(
  workspaceId: string | null,
  options: { consumerCwd?: string | null } = {},
): Promise<ResolvedReferenceFolder[]> {
  const all = await listResolvedReferenceFolders(workspaceId, options);
  return all.filter((r) => r.exists);
}
