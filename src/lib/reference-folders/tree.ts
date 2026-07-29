/**
 * File listing for one reference folder, used by the `@alias` drill-down
 * (docs/reference-folders-spec.md §8).
 *
 * The spec called for reusing `listTree` from `src/lib/workspaces/list-tree.ts`.
 * That does not work here, and the reason is worth recording:
 *
 *   - `listTree` needs an agentex `Workspace` handle, and `workspace.open()`
 *     on a git repo *throws* unless the repo carries agentex worktree metadata
 *     (`.git/info/agentex.json`) or the caller supplies a `baseBranch`. A
 *     reference folder is somebody else's checkout, so it has neither, and
 *     inventing a base branch for it would be fabricating state.
 *   - `listTreeGit` then layers `git status` and stats every changed file to
 *     attach M/A/D flags. Reference folders explicitly do not get status flags
 *     (they are not worktrees), so that is work we would throw away.
 *
 * So this is a deliberately smaller read: `git ls-files` when the folder is a
 * repo, a pruned directory walk when it is not. Both are strictly read-only,
 * which matters more here than code reuse — this module points at folders the
 * user has told us never to modify.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';
import type { TreeEntry } from '@/lib/api/sessions';

const execFileAsync = promisify(execFile);

/**
 * Directories skipped by the non-git walk. Matches `list-tree.ts` so the two
 * surfaces feel the same. In a git reference these never appear anyway,
 * because `--exclude-standard` honours the repo's own `.gitignore`.
 */
const HEAVY_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  '.cache',
  '.turbo',
  'coverage',
]);

/**
 * Upper bound on entries returned for one reference. A reference can be an
 * enormous monorepo nobody on this end controls, and the whole list is sent to
 * the composer for client-side filtering. Truncation is reported rather than
 * silent so a short list is never mistaken for a small repo.
 */
export const REFERENCE_TREE_LIMIT = 20_000;

export interface ReferenceTreeResult {
  entries: TreeEntry[];
  truncated: boolean;
}

/** Tracked + untracked files, honouring the reference's own `.gitignore`. */
async function listViaGit(absolutePath: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: absolutePath,
        env: sanitizeChildEnv(),
        timeout: 10_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return stdout.split('\0').filter((p) => p.length > 0);
  } catch {
    // Not a repo, git missing, or the listing blew the buffer. Fall back to
    // the plain walk rather than returning nothing.
    return null;
  }
}

async function walk(
  root: string,
  rel: string,
  out: string[],
  budget: { remaining: number },
): Promise<void> {
  if (budget.remaining <= 0) return;
  let dirents;
  try {
    dirents = await fs.readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return; // Unreadable subtree (permissions, a broken symlink) is not fatal.
  }
  for (const dirent of dirents) {
    if (budget.remaining <= 0) return;
    const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      if (HEAVY_DIRS.has(dirent.name)) continue;
      await walk(root, childRel, out, budget);
    } else if (dirent.isFile()) {
      out.push(childRel);
      budget.remaining -= 1;
    }
    // Symlinks are skipped: following them into a reference folder risks
    // cycles and escaping the folder the user actually pointed at.
  }
}

/**
 * Flat file list for a reference folder, relative to its root. Directories are
 * not emitted, matching how the worktree tree behaves — the picker matches on
 * path substrings, so `@backend/src/routes` still narrows correctly.
 */
export async function listReferenceTree(absolutePath: string): Promise<ReferenceTreeResult> {
  const fromGit = await listViaGit(absolutePath);
  let paths: string[];
  let truncated = false;

  if (fromGit) {
    truncated = fromGit.length > REFERENCE_TREE_LIMIT;
    paths = truncated ? fromGit.slice(0, REFERENCE_TREE_LIMIT) : fromGit;
  } else {
    const collected: string[] = [];
    // One over the limit, so "stopped exactly at the cap" is distinguishable
    // from "there was one more". Otherwise a folder holding exactly the limit
    // reports itself truncated.
    const budget = { remaining: REFERENCE_TREE_LIMIT + 1 };
    await walk(absolutePath, '', collected, budget);
    truncated = collected.length > REFERENCE_TREE_LIMIT;
    paths = truncated ? collected.slice(0, REFERENCE_TREE_LIMIT) : collected;
  }

  if (truncated) {
    console.warn(
      `[reference-folders] tree for ${absolutePath} truncated at ${REFERENCE_TREE_LIMIT} entries`,
    );
  }

  const entries: TreeEntry[] = paths.sort().map((p) => ({
    path: p,
    name: path.posix.basename(p),
    kind: 'file' as const,
  }));

  return { entries, truncated };
}
