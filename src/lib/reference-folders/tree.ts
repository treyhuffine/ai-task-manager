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

import { sanitizeChildEnv } from '@/lib/utils/sanitize-child-env';
import type { TreeEntry } from '@/lib/workspaces/file-contracts';
import { FOLDER_LIST_LIMIT, walkFolder } from '@/lib/workspaces/walk-folder';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

/**
 * Flat file list for a reference folder, relative to its root. Directories are
 * not emitted, matching how the worktree tree behaves — the picker matches on
 * path substrings, so `@backend/src/routes` still narrows correctly.
 *
 * A reference can be an enormous monorepo nobody on this end controls, so it
 * stops at `FOLDER_LIST_LIMIT`. Truncation is reported rather than silent so a
 * short list is never mistaken for a small repo. Symlinks aren't listed:
 * they could lead out of the folder the user actually pointed at.
 */
export async function listReferenceTree(absolutePath: string): Promise<ReferenceTreeResult> {
  const fromGit = await listViaGit(absolutePath);
  let paths: string[];
  let truncated = false;

  if (fromGit) {
    truncated = fromGit.length > FOLDER_LIST_LIMIT;
    paths = truncated ? fromGit.slice(0, FOLDER_LIST_LIMIT) : fromGit;
  } else {
    ({ paths, truncated } = await walkFolder(absolutePath));
  }

  if (truncated) {
    console.warn(
      `[reference-folders] tree for ${absolutePath} truncated at ${FOLDER_LIST_LIMIT} entries`,
    );
  }

  const entries: TreeEntry[] = paths.sort().map((p) => ({
    path: p,
    name: path.posix.basename(p),
    kind: 'file' as const,
  }));

  return { entries, truncated };
}
