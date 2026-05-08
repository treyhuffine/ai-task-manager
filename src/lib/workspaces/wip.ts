/**
 * WIP handoff: detect uncommitted changes in a workspace's source repo and
 * move/copy them into a freshly-created worktree.
 *
 * Worktrees check out from a commit, so any in-progress edits or new files
 * the user hadn't yet committed stay behind in the source repo. This module
 * is the bridge: detect the WIP, then either *move* it (git stash + pop) so
 * it lives in the new worktree, or *copy* it so both repos retain it.
 *
 * Files already covered by the workspace's `files_to_copy` patterns are
 * filtered out — `@agentex/workspace`'s `copyFromSource` already handled
 * those at worktree-create time.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import picomatch from 'picomatch';
import { expandFilesToCopyPatterns } from './files-to-copy';

const execFileAsync = promisify(execFile);

const GIT_EXEC_OPTS = {
  maxBuffer: 8 * 1024 * 1024, // 8 MB — 1000s of porcelain entries fit comfortably
} as const;

export interface WipDetection {
  /** Tracked files with staged or unstaged modifications. */
  modified: string[];
  /** Untracked files git would willingly add (gitignored excluded by git itself). */
  untracked: string[];
}

/**
 * Run `git status --porcelain=v1 -z` in `sourceCwd`, then strip out any
 * paths the workspace's `files_to_copy` patterns already cover. Empty
 * result on a clean tree or a non-git path.
 */
export async function detectSourceWip(
  sourceCwd: string,
  filesToCopy: readonly string[],
): Promise<WipDetection> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '-z'],
      { cwd: sourceCwd, ...GIT_EXEC_OPTS },
    );
    stdout = result.stdout;
  } catch {
    return { modified: [], untracked: [] };
  }

  const modified: string[] = [];
  const untracked: string[] = [];

  // -z format: NUL-terminated records of `XY <space> path`. Renames/copies
  // are followed by a second NUL-terminated record holding the old path
  // ("R  new\0old\0"), so we advance the cursor by two for those.
  const records = stdout.split('\0');
  let i = 0;
  while (i < records.length) {
    const rec = records[i];
    if (!rec || rec.length < 3) {
      i++;
      continue;
    }
    const x = rec[0];
    const y = rec[1];
    const filePath = rec.slice(3);

    if (x === '?' && y === '?') {
      untracked.push(filePath);
      i++;
    } else if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      modified.push(filePath);
      i += 2;
    } else {
      modified.push(filePath);
      i++;
    }
  }

  const expanded = expandFilesToCopyPatterns(filesToCopy);
  if (expanded.length === 0) return { modified, untracked };

  const matchers = expanded.map((p) => picomatch(p, { dot: true }));
  const matches = (file: string) => matchers.some((m) => m(file));
  return {
    modified: modified.filter((f) => !matches(f)),
    untracked: untracked.filter((f) => !matches(f)),
  };
}

export interface CopyWipResult {
  copied: string[];
  skipped: { path: string; reason: string }[];
}

/**
 * Copy each WIP file from source to worktree. Deleted-in-source paths
 * propagate as deletes in the worktree (so a `D` status carries over).
 * Best-effort: per-file failures are recorded in `skipped` but don't
 * abort the run — the user can re-do anything that didn't land.
 */
export async function copyWipToWorktree(args: {
  sourceCwd: string;
  worktreePath: string;
  files: readonly string[];
}): Promise<CopyWipResult> {
  const { sourceCwd, worktreePath, files } = args;
  const copied: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const rel of files) {
    const src = path.join(sourceCwd, rel);
    const dst = path.join(worktreePath, rel);
    try {
      const srcStat = await fs.stat(src).catch(() => null);
      if (srcStat && srcStat.isFile()) {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(src, dst);
        copied.push(rel);
      } else if (!srcStat) {
        // Source path is gone — this was a "D" entry. Mirror the delete.
        await fs.unlink(dst).catch(() => {});
        copied.push(rel);
      } else {
        skipped.push({ path: rel, reason: 'not a regular file' });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ path: rel, reason });
    }
  }

  return { copied, skipped };
}

export interface MoveWipResult {
  /** True if the stash landed in the worktree (even with conflicts). */
  moved: boolean;
  /** True if `git stash pop` reported merge conflicts. The stash entry
   *  is retained in this case so the user can recover. */
  conflict: boolean;
  /** Stash message if a stash was created — surfaced to the UI so the
   *  user can `git stash list` if anything went sideways. */
  stashMessage: string | null;
}

/**
 * Stash the listed files in `sourceCwd` and pop the stash in
 * `worktreePath`. Stashes live on `refs/stash`, which is a single ref
 * shared across all worktrees of the repo, so push-here / pop-there is
 * the natural handoff.
 *
 * Conflict mode: pop reports CONFLICT and exits non-zero, but the
 * working tree of the worktree has the changes applied with conflict
 * markers and the stash is *retained*. We surface that to the UI so the
 * user can resolve.
 */
export async function moveWipToWorktree(args: {
  sourceCwd: string;
  worktreePath: string;
  files: readonly string[];
}): Promise<MoveWipResult> {
  const { sourceCwd, worktreePath, files } = args;
  if (files.length === 0) {
    return { moved: true, conflict: false, stashMessage: null };
  }

  const stashMessage = `flow-wip-handoff-${Date.now()}`;

  try {
    await execFileAsync(
      'git',
      ['stash', 'push', '--include-untracked', '-m', stashMessage, '--', ...files],
      { cwd: sourceCwd, ...GIT_EXEC_OPTS },
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    throw new Error(`git stash push failed: ${e.stderr ?? e.message}`);
  }

  try {
    await execFileAsync('git', ['stash', 'pop'], {
      cwd: worktreePath,
      ...GIT_EXEC_OPTS,
    });
    return { moved: true, conflict: false, stashMessage };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const combined = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    if (combined.includes('CONFLICT') || combined.includes('Merge conflict')) {
      return { moved: true, conflict: true, stashMessage };
    }
    throw new Error(
      `git stash pop failed: ${e.stderr ?? e.message}. The stash "${stashMessage}" is preserved for recovery.`,
    );
  }
}
